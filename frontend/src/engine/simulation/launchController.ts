/**
 * Controle de lançamento: verificações pré-lançamento derivadas do estado, contagem regressiva,
 * holds, ignição, ascensão física (relógio próprio com passo fixo) e abortos.
 * Independente do React: a interface assina a telemetria; a cena 3D lê o estado a cada quadro.
 */
import type { LaunchVehicle, MissionSpec } from '../../types/catalog';
import type { FlightEventRecord, FlightOutcome, MissionPlan, OrbitInsertion, SpacecraftConfig, ValidationReport } from '../../types/campaign';
import { simulationConfig } from '../catalog';
import { createRng, hashSeed } from '../core/rng';
import { analyzeSpacecraft, type SpacecraftSummary } from '../entities/spacecraft';
import { rollPhase, vibrationClass, vibrationLevel, type FailureProbability } from '../failures/failures';
import { AscentSimulator, type AscentTelemetry } from '../physics/ascent';
import { atmosphere } from '../atmosphere/us76';
import type { MissionProfile } from '../rules/mission-profile';

export type LaunchState = 'checks' | 'ready' | 'hold' | 'countdown' | 'ignition' | 'flight' | 'orbit' | 'aborted' | 'failed' | 'scrubbed';

export interface SystemCheck { id: string; label: string; status: 'pendente' | 'ok' | 'aviso' | 'falha'; detail: string }

export interface ActiveIssue { id: string; label: string; severity: string; blocking: boolean; resolvable: boolean; recovery: string; probability: number }

export interface LaunchSnapshot {
  state: LaunchState;
  countdownS: number;
  checks: SystemCheck[];
  issues: ActiveIssue[];
  telemetry: AscentTelemetry;
  vibrationG: number;
  vibrationLabel: string;
  tankPressureBar: number;
  valves: string;
  busVoltage: number;
  navigation: string;
  events: FlightEventRecord[];
  timeWarp: number;
  outcome: FlightOutcome;
  holdRemainingS: number;
  stageSeparatedCount: number;
  perfDegraded: boolean;
}

export interface LaunchSetup {
  mission: MissionSpec;
  config: SpacecraftConfig;
  vehicle: LaunchVehicle;
  plan: MissionPlan;
  profile: MissionProfile;
  validation: ValidationReport;
  seed: number;
  attempt: number;
}

type Listener = (s: LaunchSnapshot) => void;

const CHECK_DEFS: { id: string; label: string }[] = [
  { id: 'comm', label: 'Comunicação solo–veículo–sonda' },
  { id: 'software', label: 'Software de voo' },
  { id: 'electrical', label: 'Sistemas elétricos' },
  { id: 'sensors', label: 'Sensores' },
  { id: 'pressurization', label: 'Pressurização dos tanques' },
  { id: 'propulsion', label: 'Sistemas de propulsão / ignição' },
  { id: 'thermal', label: 'Temperaturas' },
  { id: 'vibration', label: 'Vibração' },
  { id: 'structure', label: 'Integridade estrutural' },
  { id: 'ground', label: 'Sistemas de solo' },
  { id: 'weather', label: 'Condições ambientais' },
  { id: 'countdown', label: 'Estado da contagem regressiva' },
];

export class LaunchController {
  readonly setup: LaunchSetup;
  readonly summary: SpacecraftSummary;
  sim: AscentSimulator;
  private listeners = new Set<Listener>();
  private state: LaunchState = 'checks';
  private checks: SystemCheck[] = CHECK_DEFS.map((c) => ({ ...c, status: 'pendente', detail: '' }));
  private checkIndex = 0;
  private checkTimer = 0;
  private issues: ActiveIssue[] = [];
  private countdown = 10;
  private holdRemaining = 0;
  private events: FlightEventRecord[] = [];
  private accumulator = 0;
  private timeWarp = 1;
  private outcome: FlightOutcome = 'pending';
  private weatherAdverse = false;
  private sensorDegraded = false;
  private engineOutTime: number | null = null;
  private vibrationRolled = false;
  private lastEmit = 0;
  private lastSimEventCount = 0;
  private perfDegraded = false;
  private paused = false;
  readonly activeEffects: string[] = [];

  constructor(setup: LaunchSetup) {
    this.setup = setup;
    this.summary = analyzeSpacecraft(setup.config, setup.mission, setup.plan);
    const ctx = { mission: setup.mission, config: setup.config, summary: this.summary, vehicleId: setup.vehicle.id };
    const pad = rollPhase('pad', ctx, setup.seed, setup.attempt);
    for (const f of pad) this.issues.push(this.issueFrom(f));
    this.weatherAdverse = this.issues.some((i) => i.id === 'pad-weather');
    const ign = rollPhase('ignition', { ...ctx, weatherAdverse: this.weatherAdverse }, setup.seed, setup.attempt);
    const ascent = rollPhase('ascent', { ...ctx, weatherAdverse: this.weatherAdverse }, setup.seed, setup.attempt);
    const staging = rollPhase('staging', ctx, setup.seed, setup.attempt);
    const rng = createRng(hashSeed(setup.seed, setup.attempt, 'timing'));
    if (ascent.some((f) => f.spec.id === 'engine-out')) this.engineOutTime = 30 + rng() * 90;
    this.ignitionFailure = ign.some((f) => f.spec.id === 'ignition-failure');
    this.sim = this.createSim(staging.some((f) => f.spec.id === 'stage-separation') ? 0 : null);
    this.log(0, 'pad', 'setup', `Veículo ${setup.vehicle.name} na plataforma. Carga útil ${this.summary.wetMassKg.toFixed(0)} kg. Probabilidades de falha calculadas a partir de testes, veículo e ambiente.`, 'info');
  }

  private ignitionFailure: boolean;

  private createSim(separationFailureStage: number | null): AscentSimulator {
    return new AscentSimulator({
      vehicle: this.setup.vehicle,
      payloadKg: this.summary.wetMassKg,
      targetAltitudeKm: this.setup.profile.targetAltitudeKm,
      inclinationDeg: this.setup.profile.launchInclinationDeg,
      dt: simulationConfig.physics.ascentTimeStepS,
      dragCoefficient: simulationConfig.physics.dragCoefficient,
      separationFailureStage,
      engineOutTime: this.engineOutTime,
    });
  }

  private issueFrom(f: FailureProbability): ActiveIssue {
    const blocking = f.spec.severity === 'bloqueante';
    return { id: f.spec.id, label: `${f.spec.category}`, severity: f.spec.severity, blocking, resolvable: f.spec.responses.includes('hold'), recovery: f.spec.recovery, probability: f.probability };
  }

  private log(t: number, phase: string, id: string, label: string, severity: FlightEventRecord['severity']): void {
    this.events.push({ t, phase, id, label, severity });
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot());
    return () => this.listeners.delete(l);
  }

  get currentState(): LaunchState { return this.state; }
  get flightEvents(): FlightEventRecord[] { return this.events; }
  get flightOutcome(): FlightOutcome { return this.outcome; }
  /** Estado no fim da subida (altitude, velocidade inercial, ângulo de trajetória), base da órbita nas operações. */
  get insertion(): OrbitInsertion | null {
    if (this.outcome !== 'orbit') return null;
    const tel = this.sim.telemetry();
    return {
      altitudeM: tel.altitudeM, speedMS: tel.speedMS, downrangeM: tel.downrangeM,
      flightPathDeg: (Math.asin(Math.max(-1, Math.min(1, tel.verticalSpeedMS / Math.max(1, tel.speedMS)))) * 180) / Math.PI,
      inclinationDeg: this.setup.profile.launchInclinationDeg,
    };
  }

  /** Ações disponíveis variam com o estado operacional. */
  get actions() {
    const blocking = this.issues.some((i) => i.blocking);
    return {
      startProcedures: this.state === 'checks' && this.checkIndex === 0 && this.checkTimer === 0,
      hold: ['ready', 'countdown'].includes(this.state) || (this.state === 'checks' && this.checkIndex >= CHECK_DEFS.length),
      confirmLaunch: this.state === 'ready' && !blocking,
      abort: ['countdown', 'ignition', 'flight', 'hold', 'ready'].includes(this.state),
      pause: ['flight'].includes(this.state),
      scrub: ['ready', 'hold'].includes(this.state),
      blocking,
    };
  }

  private started = false;
  startProcedures(): void {
    if (this.state !== 'checks' || this.started) return;
    this.started = true;
    this.log(0, 'pad', 'procedures', 'Início dos procedimentos de lançamento: verificações de sistemas', 'info');
  }

  hold(): void {
    if (!this.actions.hold && this.state !== 'checks') return;
    const resolvable = this.issues.filter((i) => i.resolvable);
    this.state = 'hold';
    this.countdown = 10;
    this.holdRemaining = resolvable.length > 0 ? 6 : 3;
    this.log(0, 'pad', 'hold', resolvable.length ? `HOLD: reciclagem da contagem para tratar ${resolvable.map((r) => r.label).join(', ')}` : 'HOLD solicitado pelo diretor de voo', 'aviso');
  }

  scrub(): void {
    this.state = 'scrubbed';
    this.outcome = 'pad-abort';
    this.log(0, 'pad', 'scrub', 'Lançamento cancelado (scrub). A campanha retorna à plataforma em nova tentativa.', 'aviso');
    this.emit(true);
  }

  confirmLaunch(): void {
    if (!this.actions.confirmLaunch) return;
    // Prosseguir com alertas não bloqueantes é uma decisão operacional arriscada, registrada no relatório
    for (const i of this.issues) {
      if (i.id === 'pad-weather') this.activeEffects.push('weather-adverse');
      if (i.id === 'pad-sensor') { this.sensorDegraded = true; this.activeEffects.push('sensor-degraded'); }
      this.log(0, 'pad', `accept-${i.id}`, `Decisão: prosseguir apesar de "${i.label}" (${i.recovery})`, 'aviso');
    }
    this.state = 'countdown';
    this.countdown = 10;
    this.log(0, 'pad', 'go', 'GO para lançamento. Contagem final iniciada (T−10 s, comprimida)', 'info');
  }

  abort(mode?: 'engine-cutoff' | 'flight-termination'): void {
    if (this.state === 'countdown' || this.state === 'ready' || this.state === 'hold') {
      this.state = 'aborted';
      this.outcome = 'pad-abort';
      this.log(this.sim.t, 'pad', 'abort', 'Aborto antes da ignição: contagem interrompida, sistemas em configuração segura', 'aviso');
    } else if (this.state === 'ignition') {
      this.sim.abort('pad-shutdown');
      this.state = 'aborted';
      this.outcome = 'pad-abort';
      this.log(this.sim.t, 'ignition', 'abort', 'Aborto na plataforma: sequência de desligamento dos motores, válvulas fechadas, veículo permanece preso', 'aviso');
    } else if (this.state === 'flight') {
      const m = mode ?? 'engine-cutoff';
      this.sim.abort(m);
      this.state = 'aborted';
      this.outcome = m === 'flight-termination' ? 'flight-terminated' : 'flight-abort';
      this.log(this.sim.t, 'ascent', 'abort', m === 'flight-termination'
        ? 'Terminação de voo: destruição controlada do veículo dentro da área de segurança (veículo não tripulado)'
        : 'Corte de motores em voo: o veículo segue trajetória balística e cai na área de segurança; a carga útil não é separada', 'critica');
    }
    this.emit(true);
  }

  setTimeWarp(w: number): void { this.timeWarp = Math.max(1, Math.min(20, w)); }
  togglePause(): void { this.paused = !this.paused; }

  /** Avança o relógio da simulação (dt de relógio real em s). Física em passo fixo, desacoplada da taxa de quadros. */
  tick(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    switch (this.state) {
      case 'checks': {
        if (!this.started) break;
        this.checkTimer += dt;
        if (this.checkTimer > 0.45 && this.checkIndex < CHECK_DEFS.length) {
          this.checkTimer = 0;
          this.evaluateCheck(this.checkIndex++);
          if (this.checkIndex >= CHECK_DEFS.length) {
            this.state = 'ready';
            this.log(0, 'pad', 'checks-done', this.issues.some((i) => i.blocking) ? 'Verificações concluídas com condição BLOQUEANTE: lançamento impedido até a resolução' : 'Verificações concluídas: veículo pronto (aguardando GO)', this.issues.some((i) => i.blocking) ? 'grave' : 'info');
          }
        }
        break;
      }
      case 'hold': {
        this.holdRemaining -= dt;
        if (this.holdRemaining <= 0) {
          const rng = createRng(hashSeed(this.setup.seed, this.setup.attempt, 'hold', this.events.length));
          const before = this.issues.length;
          this.issues = this.issues.filter((i) => {
            if (!i.resolvable) return true;
            // O clima melhora com probabilidade; falhas técnicas são corrigidas na reciclagem
            return i.id === 'pad-weather' ? rng() < 0.35 : false;
          });
          if (before !== this.issues.length) this.log(0, 'pad', 'hold-resolved', 'Hold concluído: condições reavaliadas e sistemas reciclados', 'info');
          this.checks = this.checks.map((c) => this.recheck(c));
          this.state = 'ready';
          this.weatherAdverse = this.issues.some((i) => i.id === 'pad-weather');
        }
        break;
      }
      case 'countdown': {
        this.countdown -= dt;
        if (this.countdown <= 3 && this.sim.phase === 'prelaunch') {
          this.sim.ignite();
          this.state = 'ignition';
          this.log(this.sim.t, 'ignition', 'ignition', `Ignição dos motores (T−3 s): ${this.setup.vehicle.stages[0]?.name}`, 'info');
        }
        break;
      }
      case 'ignition':
      case 'flight': {
        if (this.paused) break;
        this.countdown -= dt;
        if (this.state === 'ignition' && this.ignitionFailure && this.sim.t > 1.6) {
          this.sim.abort('pad-shutdown');
          this.state = 'aborted';
          this.outcome = 'pad-abort';
          this.log(this.sim.t, 'ignition', 'fail-ignition', 'Falha de ignição detectada: aborto automático na plataforma, motores desligados em sequência', 'grave');
          this.ignitionFailure = false;
          break;
        }
        const stepDt = this.sim.opts.dt;
        this.accumulator += dt * this.timeWarp;
        const started = performance.now();
        let steps = 0;
        while (this.accumulator >= stepDt) {
          this.sim.step();
          this.accumulator -= stepDt;
          steps++;
          if (performance.now() - started > 12) {
            // Simulação mais lenta que o tempo real: preserva a física e informa a degradação
            this.perfDegraded = true;
            this.accumulator = 0;
            break;
          }
        }
        if (steps > 0) this.afterSteps();
        break;
      }
      default:
        break;
    }
    this.emit(false);
  }

  private afterSteps(): void {
    const tel = this.sim.telemetry();
    if (this.state === 'ignition' && (tel.phase === 'liftoff' || tel.phase === 'ascent')) this.state = 'flight';
    // Eventos da simulação física entram no registro de voo
    for (const e of this.sim.events.slice(this.lastSimEventCount)) {
      const sev: FlightEventRecord['severity'] = ['sep-fail', 'impact', 'depletion', 'suborbital', 'timeout'].includes(e.id) ? 'critica' : e.id === 'engine-out' ? 'grave' : 'info';
      this.log(e.t, tel.phase, e.id === 'sep-fail' ? 'fail-separation' : e.id === 'engine-out' ? 'fail-engine-out' : e.id, e.label, sev);
    }
    this.lastSimEventCount = this.sim.events.length;
    if (!this.vibrationRolled && tel.dynamicPressurePa > 20000) {
      this.vibrationRolled = true;
      const g = vibrationLevel('ascent', tel.dynamicPressurePa, tel.accelerationG, this.weatherAdverse);
      const ctx = { mission: this.setup.mission, config: this.setup.config, summary: this.summary, vehicleId: this.setup.vehicle.id, weatherAdverse: this.weatherAdverse, vibrationG: g };
      const dmg = rollPhase('ascent', ctx, this.setup.seed, this.setup.attempt, 'vibration').find((f) => f.spec.id === 'vibration-damage');
      if (dmg) {
        this.activeEffects.push('component-damage');
        this.log(tel.t, 'ascent', 'fail-vibration', `Anomalia de vibração na região de Max-Q (${g.toFixed(1)} g RMS): um instrumento pode operar degradado`, 'grave');
      }
    }
    if (this.sim.isFinished) {
      if (tel.phase === 'orbit') {
        this.state = 'orbit';
        this.outcome = 'orbit';
        const p = this.setup.profile;
        const orbitTxt = `perigeu ${tel.periapsisKm.toFixed(0)} km, apogeu ${tel.apoapsisKm.toFixed(0)} km`;
        if (p.launchProfile !== 'leo-polar') {
          // A injeção de partida e a separação acontecem nas operações, depois da primeira volta completa
          this.log(tel.t, 'upper', 'parking-orbit', `Inserção na órbita de estacionamento (${orbitTxt}). Sonda e estágio superior seguem acoplados até a injeção de partida, depois de uma volta completa em torno da Terra${this.sensorDegraded ? ' (navegação inicial degradada por sensor não recalibrado)' : ''}`, 'info');
        } else {
          this.log(tel.t, 'upper', 'orbit-insertion', `Inserção na órbita operacional (${orbitTxt})`, 'info');
          this.log(tel.t, 'upper', 'separation', `Separação da sonda${this.sensorDegraded ? ' (navegação inicial degradada por sensor não recalibrado)' : ''}`, 'info');
        }
      } else if (tel.phase === 'failed') {
        this.state = 'failed';
        this.outcome = 'launch-failure';
      }
    }
  }

  private evaluateCheck(i: number): void {
    const c = this.checks[i]!;
    this.checks[i] = this.recheck(c);
    const r = this.checks[i]!;
    this.log(0, 'pad', `check-${r.id}`, `${r.label}: ${r.status.toUpperCase()} ${r.detail ? `— ${r.detail}` : ''}`, r.status === 'falha' ? 'grave' : r.status === 'aviso' ? 'aviso' : 'info');
  }

  /** Cada verificação deriva do estado da configuração e dos eventos sorteados (não são mensagens aleatórias). */
  private recheck(c: SystemCheck): SystemCheck {
    const s = this.summary;
    const v = this.setup.validation;
    const has = (id: string) => this.issues.some((x) => x.id === id);
    const statusOf = (checkId: string) => v.checks.find((x) => x.id === checkId)?.status;
    switch (c.id) {
      case 'comm': return { ...c, status: s.commandRateKbps >= 1 ? 'ok' : 'falha', detail: `enlace de comando ${s.commandRateKbps.toFixed(1)} kbps no alcance da missão; atraso ${s.communicationDelayS < 1 ? `${(s.communicationDelayS * 1000).toFixed(0)} ms` : `${(s.communicationDelayS / 60).toFixed(1)} min`}` };
      case 'software': return { ...c, status: s.capabilities.has('computer') ? 'ok' : 'falha', detail: s.capabilities.has('computer') ? 'computador de bordo carregado com a sequência de voo' : 'sem computador de bordo' };
      case 'electrical': return { ...c, status: has('ground-power') ? 'falha' : statusOf('power-balance') === 'reprovada' ? 'falha' : statusOf('power-balance') === 'aviso' ? 'aviso' : 'ok', detail: has('ground-power') ? 'perda de alimentação de solo — comutação pendente' : `geração ${s.powerGenerationW.toFixed(0)} W / consumo ${s.powerConsumptionW.toFixed(0)} W` };
      case 'sensors': return { ...c, status: has('pad-sensor') ? 'aviso' : 'ok', detail: has('pad-sensor') ? 'leitura inconsistente em sensor inercial — recalibração no hold' : 'unidades inerciais alinhadas' };
      case 'pressurization': return { ...c, status: has('pad-pressurization') ? 'falha' : 'ok', detail: has('pad-pressurization') ? 'pressão do tanque abaixo do limite — lançamento bloqueado' : 'tanques na pressão de voo' };
      case 'propulsion': return { ...c, status: statusOf('vehicle-twr') === 'reprovada' ? 'falha' : 'ok', detail: `motores prontos; T/P ${v.checks.find((x) => x.id === 'vehicle-twr')?.value ?? '—'}` };
      case 'thermal': return { ...c, status: 'ok', detail: `ar ${(atmosphere(0).temperatureK - 273.15).toFixed(0)} °C (atmosfera padrão); eletrônica dentro dos limites` };
      case 'vibration': return { ...c, status: 'ok', detail: `${vibrationLevel('prelaunch', 0, 0, this.weatherAdverse).toFixed(2)} g RMS — ${vibrationClass(0.02)}` };
      case 'structure': return { ...c, status: statusOf('structure-limit') === 'reprovada' ? 'falha' : 'ok', detail: `massa ${s.wetMassKg.toFixed(0)} kg no adaptador` };
      case 'ground': return { ...c, status: has('ground-power') ? 'falha' : 'ok', detail: has('ground-power') ? 'alimentação de solo instável' : 'linhas de abastecimento e umbilicais nominais' };
      case 'weather': return { ...c, status: has('pad-weather') ? 'aviso' : 'ok', detail: has('pad-weather') ? 'ventos fortes em altitude: aumento de carga estrutural na ascensão' : 'ventos e visibilidade dentro dos limites' };
      case 'countdown': return { ...c, status: this.issues.some((i) => i.blocking) ? 'falha' : 'ok', detail: this.issues.some((i) => i.blocking) ? 'bloqueada por condição obrigatória' : 'contagem pronta para T−10 s' };
      default: return c;
    }
  }

  snapshot(): LaunchSnapshot {
    const tel = this.sim.telemetry();
    const simPhase = this.state === 'flight' || this.state === 'ignition' ? tel.phase : this.state === 'orbit' ? 'coast' : 'prelaunch';
    const vib = vibrationLevel(simPhase === 'staging' && tel.thrustN === 0 ? 'staging' : simPhase, tel.dynamicPressurePa, tel.accelerationG, this.weatherAdverse);
    const pressureOk = !this.issues.some((i) => i.id === 'pad-pressurization');
    return {
      state: this.state,
      countdownS: Math.max(0, this.countdown),
      checks: this.checks,
      issues: this.issues,
      telemetry: tel,
      vibrationG: vib,
      vibrationLabel: vibrationClass(vib),
      tankPressureBar: pressureOk ? 3.4 - (1 - tel.stagePropFraction) * 0.4 : 2.1,
      valves: tel.engineState === 'off' ? 'fechadas (pré-válvulas abertas)' : tel.engineState === 'shutdown' ? 'fechadas' : 'abertas',
      busVoltage: this.issues.some((i) => i.id === 'ground-power') ? 24.1 : 28.0,
      navigation: this.sensorDegraded ? 'INS degradado (sem recalibração)' : 'INS + GNSS nominal',
      events: this.events,
      timeWarp: this.timeWarp,
      outcome: this.outcome,
      holdRemainingS: Math.max(0, this.holdRemaining),
      stageSeparatedCount: this.sim.events.filter((e) => e.id === 'stage-sep' || e.id === 'booster-sep').length,
      perfDegraded: this.perfDegraded,
    };
  }

  private emit(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
  }

  dispose(): void { this.listeners.clear(); }
}
