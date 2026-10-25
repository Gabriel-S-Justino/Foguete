/**
 * Simulador de ascensão 2D (plano orbital, referencial inercial centrado na Terra).
 * Considera gravidade, massa variável, empuxo dependente da pressão, arrasto com densidade US76,
 * pressão dinâmica, perfil de atitude (giro gravitacional + guiamento em malha fechada) e separação de estágios.
 * Passo de tempo fixo, independente da renderização.
 */
import type { LaunchVehicle, StageSpec } from '../../types/catalog';
import { atmosphere } from '../atmosphere/us76';
import { BODIES, circularVelocity, elementsFromState } from '../orbital-mechanics/orbits';
import { G0, thrustAtPressure } from '../propulsion/rocket';

export type AscentPhase =
  | 'prelaunch' | 'ignition' | 'liftoff' | 'ascent' | 'staging' | 'upper' | 'coast-orbit'
  | 'aborted' | 'terminated' | 'failed' | 'orbit';

export interface AscentEvent { t: number; id: string; label: string }

export interface AscentTelemetry {
  t: number;
  altitudeM: number;
  downrangeM: number;
  speedMS: number;
  surfaceSpeedMS: number;
  verticalSpeedMS: number;
  accelerationG: number;
  massKg: number;
  propellantKg: number;
  stagePropFraction: number;
  dynamicPressurePa: number;
  temperatureK: number;
  pitchDeg: number;
  stageIndex: number;
  stageName: string;
  engineState: 'off' | 'startup' | 'nominal' | 'throttled' | 'shutdown';
  thrustN: number;
  phase: AscentPhase;
  periapsisKm: number;
  apoapsisKm: number;
  x: number;
  y: number;
}

export interface AscentOptions {
  vehicle: LaunchVehicle;
  payloadKg: number;
  targetAltitudeKm: number;
  inclinationDeg: number;
  dt: number;
  dragCoefficient: number;
  /** Fator multiplicativo do empuxo (falha de motor = < 1). */
  thrustFactor?: number;
  /** Índice de estágio cuja separação falha (evento de falha). */
  separationFailureStage?: number | null;
  /** Instante em que o empuxo é reduzido por perda de motor. */
  engineOutTime?: number | null;
}

interface StageRuntime { spec: StageSpec; prop: number; attached: boolean; burning: boolean }

const MAX_ACCEL_G = 5;
const SEPARATION_COAST_S = 3;
const STARTUP_RAMP_S = 2.5;

export class AscentSimulator {
  readonly opts: AscentOptions;
  t = 0;
  x: number;
  y = 0;
  vx = 0;
  vy: number;
  phase: AscentPhase = 'prelaunch';
  events: AscentEvent[] = [];
  private stages: StageRuntime[];
  private active = 0;
  private fairingAttached: boolean;
  private coastUntil = -1;
  private ignitionTime = 0;
  private maxQ = 0;
  private maxQReported = false;
  private thrustNow = 0;
  private accelNow = 0;
  private pitchNow = 90;
  private engineOutApplied = false;
  private liftoffT: number | null = null;
  /** Órbitas altas: SECO-1 na transferência, voo balístico até a apoapse e reignição para circularizar. */
  private coastToApoapsis = false;
  private circularizing = false;
  /** Velocidade angular da plataforma no plano orbital (a Terra gira sob o referencial inercial). */
  private readonly padRate: number;
  readonly rTarget: number;
  private readonly R = BODIES.earth.radius;
  private readonly mu = BODIES.earth.mu;
  private readonly omega = BODIES.earth.rotationRate ?? 7.2921159e-5;

  constructor(opts: AscentOptions) {
    this.opts = opts;
    this.x = this.R;
    // Componente da rotação terrestre no plano orbital (≈ ωR·cos i; negativa para órbitas retrógradas)
    this.vy = this.omega * this.R * Math.cos((opts.inclinationDeg * Math.PI) / 180);
    this.padRate = this.vy / this.R;
    this.stages = opts.vehicle.stages.map((s) => ({ spec: s, prop: s.propMassKg, attached: true, burning: false }));
    this.fairingAttached = opts.vehicle.fairingMassKg > 0;
    this.rTarget = this.R + opts.targetAltitudeKm * 1000;
  }

  get altitude(): number { return Math.hypot(this.x, this.y) - this.R; }

  get mass(): number {
    let m = this.opts.payloadKg + (this.fairingAttached ? this.opts.vehicle.fairingMassKg : 0);
    for (const s of this.stages) if (s.attached) m += s.spec.dryMassKg + s.prop;
    return m;
  }

  get totalPropellant(): number {
    return this.stages.reduce((sum, s) => sum + (s.attached ? s.prop : 0), 0);
  }

  get isFinished(): boolean {
    return ['orbit', 'aborted', 'terminated', 'failed'].includes(this.phase);
  }

  /** Inicia a sequência de ignição (motores sobem de empuxo gradualmente antes da liberação). */
  ignite(): void {
    if (this.phase !== 'prelaunch') return;
    this.phase = 'ignition';
    this.ignitionTime = this.t;
    this.burningStages().forEach((s) => (s.burning = true));
    this.log('ignition', 'Sequência de ignição dos motores');
  }

  /** Aborto: na plataforma desliga os motores; em voo corta o empuxo e aciona o sistema de terminação. */
  abort(mode: 'pad-shutdown' | 'engine-cutoff' | 'flight-termination'): void {
    this.stages.forEach((s) => (s.burning = false));
    this.thrustNow = 0;
    if (mode === 'pad-shutdown') {
      this.phase = 'aborted';
      this.log('pad-abort', 'Aborto na plataforma: válvulas fechadas, motores desligados, contagem interrompida');
    } else if (mode === 'engine-cutoff') {
      this.phase = 'aborted';
      this.log('engine-cutoff', 'Corte de motores em voo: trajetória balística, sem inserção orbital');
    } else {
      this.phase = 'terminated';
      this.log('fts', 'Sistema de terminação de voo acionado (destruição controlada na área de segurança)');
    }
  }

  private log(id: string, label: string): void {
    this.events.push({ t: this.t, id, label });
  }

  private burningStages(): StageRuntime[] {
    const s = this.stages[this.active];
    if (!s) return [];
    if (s.spec.parallel) {
      const next = this.stages[this.active + 1];
      return next ? [s, next] : [s];
    }
    return [s];
  }

  private computeThrust(pressure: number): { thrust: number; mdot: number } {
    let thrust = 0;
    let mdot = 0;
    const ramp = this.phase === 'ignition' ? Math.min(1, (this.t - this.ignitionTime) / STARTUP_RAMP_S) : 1;
    const factor = (this.opts.thrustFactor ?? 1) * (this.engineOutApplied ? 8 / 9 : 1);
    for (const s of this.burningStages()) {
      if (!s.burning || s.prop <= 0) continue;
      const tVac = s.spec.thrustVackN * 1000;
      const tSL = s.spec.thrustSLkN > 0 ? s.spec.thrustSLkN * 1000 : tVac * 0.6;
      const f = thrustAtPressure(tSL, tVac, pressure) * ramp * factor;
      thrust += f;
      mdot += tVac * ramp * factor / (s.spec.ispVac * G0);
    }
    // Limite de aceleração (estrangulamento) para preservar a carga útil
    const maxThrust = MAX_ACCEL_G * G0 * this.mass;
    if (thrust > maxThrust && this.phase !== 'ignition') {
      const k = maxThrust / thrust;
      return { thrust: maxThrust, mdot: mdot * k };
    }
    return { thrust, mdot };
  }

  /** Lei de guiamento: retorna o ângulo de arfagem (rad, a partir da horizontal local). */
  private guidance(r: number, vr: number, vt: number, thrustAccel: number, mdot: number, airVx: number, airVy: number): number {
    const alt = r - this.R;
    const speed = Math.hypot(this.vx, this.vy);
    if (alt < 300 || speed < 60) return Math.PI / 2;
    const firstStage = this.active === 0 || (this.stages[0]?.spec.parallel === true && this.active <= 1);
    if (firstStage && alt < 60000) {
      // Programa de arfagem do primeiro estágio, limitado pelo ângulo da velocidade relativa ao ar (giro gravitacional)
      const ux = this.x / r, uy = this.y / r;
      const airR = airVx * ux + airVy * uy;
      const airT = -airVx * uy + airVy * ux;
      const gamma = Math.atan2(airR, Math.max(1, airT));
      const program = (Math.PI / 2) - ((70 * Math.PI) / 180) * Math.pow(Math.min(1, alt / 60000), 0.55);
      return Math.max(program, Math.min(gamma, Math.PI / 2) - (8 * Math.PI) / 180);
    }
    // Guiamento em malha fechada: leva (r, vr) a (r alvo, 0) no tempo restante de queima. O tempo vem da
    // equação do foguete (a aceleração cresce conforme o propelente é consumido); com a aceleração atual
    // constante o tempo era superestimado e o veículo passava do ponto (apoapse de milhares de km).
    const g = this.mu / (r * r);
    const vCirc = circularVelocity(this.mu, this.rTarget);
    const dv = Math.max(0, vCirc - vt);
    const ve = mdot > 0 ? (thrustAccel * this.mass) / mdot : 3000;
    const tau = mdot > 0 ? this.mass / mdot : 600;
    const lastStage = this.active >= this.stages.length - 1;
    const timeToGo = Math.max(8, lastStage ? tau * (1 - Math.exp(-dv / Math.max(500, ve))) : dv / Math.max(0.5, thrustAccel));
    const dr = this.rTarget - r;
    const aRadialCmd = (6 * dr) / (timeToGo * timeToGo) - (4 * vr) / timeToGo;
    const aRadialNeeded = g - (vt * vt) / r + aRadialCmd;
    const s = Math.max(-0.7, Math.min(0.9, aRadialNeeded / Math.max(0.1, thrustAccel)));
    // Primeiro estágio acima de 60 km: sem "empinar" de volta perto do MECO (o estágio superior corrige)
    return firstStage ? Math.min(Math.asin(s), (35 * Math.PI) / 180) : Math.asin(s);
  }

  /** Avança a simulação por um passo fixo dt. */
  step(): AscentTelemetry {
    const dt = this.opts.dt;
    if (this.isFinished || this.phase === 'prelaunch') {
      this.t += dt;
      return this.telemetry();
    }
    if (this.opts.engineOutTime != null && !this.engineOutApplied && this.t >= this.opts.engineOutTime && this.phase !== 'ignition') {
      this.engineOutApplied = true;
      this.log('engine-out', 'Perda de um motor: empuxo reduzido, guiamento prolonga a queima');
    }
    const r = Math.hypot(this.x, this.y);
    const alt = r - this.R;
    const atm = atmosphere(alt);
    // Velocidade relativa à atmosfera, que gira junto com a plataforma (componente da rotação no plano
    // orbital, ω·cos i). Usar ω inteiro criava um "vento" de até ~500 m/s em órbitas polares/retrógradas.
    const airVx = this.vx + this.padRate * this.y;
    const airVy = this.vy - this.padRate * this.x;
    const airSpeed = Math.hypot(airVx, airVy);
    const q = 0.5 * atm.densityKgM3 * airSpeed * airSpeed;

    const coasting = this.t < this.coastUntil;
    const { thrust, mdot } = coasting ? { thrust: 0, mdot: 0 } : this.computeThrust(atm.pressurePa);
    const mass = this.mass;

    // Liberação da plataforma quando o empuxo supera o peso
    if (this.phase === 'ignition') {
      if (thrust > mass * G0 * 1.02 && this.t - this.ignitionTime >= STARTUP_RAMP_S) {
        this.phase = 'liftoff';
        this.liftoffT = this.t;
        this.log('liftoff', 'Liberação das estruturas de sustentação — decolagem');
      } else {
        this.consume(mdot * dt);
        this.thrustNow = thrust;
        this.t += dt;
        return this.telemetry();
      }
    }

    const ux = this.x / r, uy = this.y / r;
    const vr = this.vx * ux + this.vy * uy;
    const vt = -this.vx * uy + this.vy * ux;
    const thrustAccel = thrust / mass;
    // Taxa de arfagem limitada (≈ 2,5°/s, como num veículo real): sem "trancos" na troca de lei de
    // guiamento (fim do programa do primeiro estágio, ignição do estágio superior, circularização)
    // Em voo balístico (separação, costeio até a apoapse) o eixo acompanha o vetor velocidade (prógrado)
    const cmd = thrust > 0 ? this.guidance(r, vr, vt, thrustAccel, mdot, airVx, airVy) : Math.atan2(vr, Math.max(1, vt));
    const prev = (this.pitchNow * Math.PI) / 180;
    const maxStep = ((2.5 * Math.PI) / 180) * dt;
    const pitch = Math.max(prev - maxStep, Math.min(prev + maxStep, cmd));
    this.pitchNow = (pitch * 180) / Math.PI;
    const tx = Math.sin(pitch) * ux - Math.cos(pitch) * uy;
    const ty = Math.sin(pitch) * uy + Math.cos(pitch) * ux;
    const area = Math.PI * (Math.min(this.opts.vehicle.diameterM, 12) / 2) ** 2;
    const dragAcc = airSpeed > 0 ? (q * this.opts.dragCoefficient * area) / mass : 0;

    const deriv = (px: number, py: number, pvx: number, pvy: number) => {
      const rr = Math.hypot(px, py);
      const gk = -this.mu / (rr * rr * rr);
      return [
        pvx, pvy,
        gk * px + thrustAccel * tx - (airSpeed > 0 ? (dragAcc * airVx) / airSpeed : 0),
        gk * py + thrustAccel * ty - (airSpeed > 0 ? (dragAcc * airVy) / airSpeed : 0),
      ] as const;
    };
    // RK4 sobre posição/velocidade com empuxo e arrasto constantes no passo
    const k1 = deriv(this.x, this.y, this.vx, this.vy);
    const k2 = deriv(this.x + (dt / 2) * k1[0], this.y + (dt / 2) * k1[1], this.vx + (dt / 2) * k1[2], this.vy + (dt / 2) * k1[3]);
    const k3 = deriv(this.x + (dt / 2) * k2[0], this.y + (dt / 2) * k2[1], this.vx + (dt / 2) * k2[2], this.vy + (dt / 2) * k2[3]);
    const k4 = deriv(this.x + dt * k3[0], this.y + dt * k3[1], this.vx + dt * k3[2], this.vy + dt * k3[3]);
    this.x += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    this.y += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    this.vx += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    this.vy += (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
    this.consume(mdot * dt);
    this.thrustNow = thrust;
    this.accelNow = Math.hypot(thrustAccel * tx - (airSpeed > 0 ? (dragAcc * airVx) / airSpeed : 0), thrustAccel * ty - (airSpeed > 0 ? (dragAcc * airVy) / airSpeed : 0)) / G0;
    this.t += dt;

    if (this.phase === 'liftoff' && alt > 1000) this.phase = 'ascent';
    if (q > this.maxQ) this.maxQ = q;
    else if (!this.maxQReported && this.maxQ > 1000 && q < this.maxQ * 0.97) {
      this.maxQReported = true;
      this.log('max-q', `Máxima pressão dinâmica (Max-Q): ${(this.maxQ / 1000).toFixed(1)} kPa`);
    }
    if (this.fairingAttached && alt > 110000) {
      this.fairingAttached = false;
      this.log('fairing', 'Separação da coifa (fora da atmosfera densa)');
    }

    this.handleStaging();
    this.checkTermination(alt);
    return this.telemetry();
  }

  private consume(dm: number): void {
    if (dm <= 0) return;
    const burning = this.burningStages().filter((s) => s.burning && s.prop > 0);
    if (burning.length === 0) return;
    // Divide o consumo proporcionalmente à vazão de cada estágio
    const flows = burning.map((s) => s.spec.thrustVackN / s.spec.ispVac);
    const total = flows.reduce((a, b) => a + b, 0);
    burning.forEach((s, i) => { s.prop = Math.max(0, s.prop - (dm * flows[i]!) / total); });
  }

  private handleStaging(): void {
    const current = this.stages[this.active];
    if (!current) return;
    if (current.prop > 0) {
      // Se o próximo estágio paralelo (núcleo) acabou antes dos propulsores, segue normalmente
      return;
    }
    current.burning = false;
    if (this.opts.separationFailureStage === this.active) {
      this.phase = 'failed';
      this.log('sep-fail', `Falha de separação: ${current.spec.name} não se desacoplou`);
      return;
    }
    current.attached = false;
    const next = this.stages[this.active + 1];
    if (current.spec.parallel) {
      this.log('booster-sep', `Separação: ${current.spec.name}${current.spec.recoverable ? ' (recuperação prevista)' : ' (descartados)'}`);
      this.active += 1;
      return;
    }
    if (!next) {
      // Último estágio esgotado sem atingir a órbita
      this.phase = 'failed';
      this.log('depletion', 'Propelente esgotado antes da inserção orbital');
      return;
    }
    this.log('stage-sep', `Corte do ${current.spec.name} e separação de estágios${current.spec.recoverable ? ' — estágio segue para recuperação' : ' — estágio descartado'}`);
    this.active += 1;
    this.coastUntil = this.t + SEPARATION_COAST_S;
    next.burning = true;
    this.phase = 'staging';
    this.events.push({ t: this.t + SEPARATION_COAST_S, id: 'stage-ignition', label: `Ignição: ${next.spec.name}` });
  }

  private checkTermination(alt: number): void {
    if (this.phase === 'staging' && this.t >= this.coastUntil) this.phase = 'upper';
    if (alt < -1) {
      this.phase = 'failed';
      this.log('impact', 'Impacto com o solo');
      return;
    }
    const el = elementsFromState(this.mu, this.x, this.y, this.vx, this.vy);
    const targetAlt = this.rTarget - this.R;
    const lastStage = this.active >= this.stages.length - 1;
    // Órbitas acima de 300 km: como nos lançamentos reais, o estágio superior corta ao atingir a apoapse
    // alvo, segue balístico até ela e reacende para circularizar (inserção direta "passava do ponto")
    if (lastStage && targetAlt > 300000 && !this.coastToApoapsis && !this.circularizing && this.phase === 'upper'
      && el.ra - this.R >= targetAlt - 5000 && el.rp - this.R < targetAlt - 30000) {
      this.coastToApoapsis = true;
      this.coastUntil = Infinity;
      this.thrustNow = 0;
      this.log('seco-1', `Primeiro corte do estágio superior (SECO-1): voo balístico até a apoapse de ${((el.ra - this.R) / 1000).toFixed(0)} km`);
      return;
    }
    if (this.coastToApoapsis) {
      const vr = (this.vx * this.x + this.vy * this.y) / Math.hypot(this.x, this.y);
      if (vr <= 0) {
        this.coastToApoapsis = false;
        this.circularizing = true;
        this.coastUntil = this.t;
        this.log('reignition', 'Reignição do estágio superior na apoapse: queima de circularização');
      }
      return;
    }
    // Corte ao atingir o perigeu alvo ou, para não passar do ponto, quando a apoapse já ultrapassa o alvo
    // com perigeu orbital
    const overshoot = el.ra - this.R > targetAlt + 40000 && el.rp - this.R >= 150000;
    if (alt > 100000 && (el.rp - this.R >= Math.max(150000, targetAlt - 30000) || overshoot)) {
      this.burningStages().forEach((s) => (s.burning = false));
      this.thrustNow = 0;
      const periKm = (el.rp - this.R) / 1000;
      if (periKm > 120) {
        this.phase = 'orbit';
        this.log('seco', `Corte do motor do estágio superior (SECO). Órbita ${periKm.toFixed(0)} × ${((el.ra - this.R) / 1000).toFixed(0)} km`);
      } else {
        this.phase = 'failed';
        this.log('suborbital', `Corte com perigeu de ${periKm.toFixed(0)} km: trajetória suborbital`);
      }
    }
  }

  telemetry(): AscentTelemetry {
    const r = Math.hypot(this.x, this.y);
    const alt = r - this.R;
    const atm = atmosphere(alt);
    const airVx = this.vx + this.padRate * this.y;
    const airVy = this.vy - this.padRate * this.x;
    const airSpeed = Math.hypot(airVx, airVy);
    const ux = this.x / r, uy = this.y / r;
    const el = elementsFromState(this.mu, this.x, this.y, this.vx, this.vy);
    const cur = this.stages[this.active];
    const engineState: AscentTelemetry['engineState'] =
      this.thrustNow <= 0 ? (this.phase === 'prelaunch' ? 'off' : 'shutdown')
        : this.phase === 'ignition' ? 'startup'
          : this.accelNow >= MAX_ACCEL_G - 0.05 ? 'throttled' : 'nominal';
    return {
      t: this.t,
      altitudeM: alt,
      downrangeM: this.surfaceDownrange(),
      speedMS: Math.hypot(this.vx, this.vy),
      surfaceSpeedMS: airSpeed,
      verticalSpeedMS: this.vx * ux + this.vy * uy,
      accelerationG: this.accelNow,
      massKg: this.mass,
      propellantKg: this.totalPropellant,
      stagePropFraction: cur ? cur.prop / cur.spec.propMassKg : 0,
      dynamicPressurePa: 0.5 * atm.densityKgM3 * airSpeed * airSpeed,
      // Temperatura de estagnação aproximada (T + v²/2cp), limitada ao regime atmosférico
      temperatureK: atm.temperatureK + (alt < 120000 ? (airSpeed * airSpeed) / (2 * 1004.5) : 0),
      pitchDeg: this.pitchNow,
      stageIndex: this.active,
      stageName: cur?.spec.name ?? '—',
      engineState,
      thrustN: this.thrustNow,
      phase: this.phase,
      periapsisKm: (el.rp - this.R) / 1000,
      apoapsisKm: Number.isFinite(el.ra) ? (el.ra - this.R) / 1000 : Infinity,
      x: this.x,
      y: this.y,
    };
  }

  /**
   * Alcance sobre a superfície, medido a partir da plataforma (que se move com a rotação da Terra).
   * O ângulo inercial puro incluía o deslocamento da própria plataforma: em órbitas para leste o foguete
   * "andava de lado" logo após a decolagem e em órbitas retrógradas o alcance ficava negativo.
   */
  private surfaceDownrange(): number {
    if (this.liftoffT === null) return 0;
    let a = Math.atan2(this.y, this.x) - this.padRate * (this.t - this.liftoffT);
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return a * this.R;
  }

  /** Executa a ascensão completa (testes / validação), com limite de tempo. */
  runToCompletion(maxTimeS = 1500): AscentTelemetry {
    if (this.phase === 'prelaunch') this.ignite();
    let tel = this.telemetry();
    while (!this.isFinished && this.t < maxTimeS) tel = this.step();
    if (!this.isFinished) {
      this.phase = 'failed';
      this.log('timeout', 'Tempo máximo de simulação atingido sem inserção orbital');
      tel = this.telemetry();
    }
    return tel;
  }
}
