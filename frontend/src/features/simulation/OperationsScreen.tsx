import { useEffect, useMemo, useRef, useState } from 'react';
import { useScene } from '../../components/useScene';
import { fmtKg, fmtMs, Panel, Stat } from '../../components/ui';
import { findVehicle, getMission } from '../../engine/catalog';
import { createRng, hashSeed } from '../../engine/core/rng';
import { ARRAYS_EVENT, powerState } from '../../engine/entities/power';
import { analyzeSpacecraft } from '../../engine/entities/spacecraft';
import { rollPhase, type FailureProbability } from '../../engine/failures/failures';
import { validateMission } from '../../engine/rules/validation';
import { createOrbitScene, type OrbitInfo } from '../../engine/scenes/otherScenes';
import type { MissionTimeline } from '../../engine/orbital-mechanics/missionTrajectory';
import { evaluateCheckpoint, chargedManeuver, executeManeuver, plannedManeuvers, type PlannedManeuver } from '../../engine/science/operations';
import { useCampaign } from '../../store/campaignStore';
import type { FlightEventRecord } from '../../types/campaign';
import { missionTimeline } from '../mission-planning/orbitView';
import { fmtWarp, OrbitHud } from './OrbitHud';

const WARPS: (number | 'auto')[] = ['auto', 1, 10, 100, 1000, 1e4, 1e5];
const REV_EVENT = 'earth-orbit-rev';

function fmtCountdown(s: number): string {
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`;
  if (s < 86400 * 2) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} dias`;
}

const RESPONSE_LABEL: Record<string, string> = {
  'load-shed': 'Desligar cargas não essenciais', continue: 'Continuar sem ação', 'switch-redundant': 'Comutar para o transmissor redundante',
  'thruster-control': 'Controlar atitude por propulsores', reboot: 'Reiniciar o computador', 'protect-instruments': 'Proteger instrumentos',
  'avoidance-maneuver': 'Executar manobra de desvio', 'accept-risk': 'Aceitar o risco', 'reduce-duty': 'Reduzir o ciclo de trabalho',
};

const INSERTION_LABEL = { captured: 'órbita de destino', 'high-orbit': 'órbita alta', flyby: 'sobrevoo', none: 'em trânsito' } as const;

export function OperationsScreen() {
  const ctrl = useScene('orbit-ops', createOrbitScene);
  const campaign = useCampaign((s) => s.campaign)!;
  const recordManeuver = useCampaign((s) => s.recordManeuver);
  const recordEvent = useCampaign((s) => s.recordEvent);
  const recordCheckpoint = useCampaign((s) => s.recordCheckpoint);
  const finishMission = useCampaign((s) => s.finishMission);
  const goTo = useCampaign((s) => s.goTo);
  const mission = getMission(campaign.missionId!);
  const plan = campaign.plan!;
  const phase = campaign.stage === 'science' ? 'science' : 'cruise';

  const ctx = useMemo(() => validateMission({ mission, config: campaign.spacecraft, vehicleId: campaign.vehicleId, plan, assistance: campaign.assistance }).context, [mission, campaign.spacecraft, campaign.vehicleId, plan, campaign.assistance]);
  const summary = useMemo(() => analyzeSpacecraft(campaign.spacecraft, mission, plan), [campaign.spacecraft, mission, plan]);
  const maneuvers = useMemo(() => plannedManeuvers(ctx.profile), [ctx.profile]);
  const executable = maneuvers.filter((m) => m.executable);
  const doneIds = new Set(campaign.maneuvers.map((m) => m.id));
  const next = executable.find((m) => !doneIds.has(m.id)) ?? null;
  const propellant = campaign.propellantRemainingKg ?? campaign.spacecraft.propellantKg;

  // Eventos de cruzeiro e de ciência: sorteio determinístico por campanha (mesma semente → mesmos eventos)
  const failureCtx = { mission, config: campaign.spacecraft, summary, vehicleId: campaign.vehicleId ?? '' };
  const rolled = useMemo<FailureProbability[]>(() => rollPhase(phase, failureCtx, campaign.seed, campaign.attempt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, campaign.seed, campaign.attempt]);
  const handled = new Set(campaign.flightEvents.filter((e) => e.id.startsWith('resp-')).map((e) => e.id.slice(5)));
  // Eventos de cruzeiro aparecem após a primeira manobra; os de ciência após o primeiro checkpoint
  const trigger = phase === 'cruise' ? campaign.maneuvers.length >= 1 : campaign.checkpointResults.length >= 1;
  const pendingEvent = trigger ? rolled.find((f) => !handled.has(f.spec.id)) ?? null : null;

  const insertion = campaign.insertionState;
  const power = powerState(campaign.spacecraft.installed, campaign.flightEvents);
  const recordedIds = new Set(campaign.flightEvents.map((e) => e.id));
  const revDone = recordedIds.has(REV_EVENT);
  const setOpsClock = useCampaign((s) => s.setOpsClock);
  const vehicle = findVehicle(campaign.vehicleId) ?? null;
  // Trajetória física: estado real do fim da subida, comando de partida e resultado da inserção final
  const outcome = insertion === 'none' ? undefined : insertion;
  const fullTl = useMemo<MissionTimeline>(() => missionTimeline(mission, plan, ctx.profile, { insertion: campaign.orbitInsertion, departureCommandT: campaign.departureCommandT ?? null, outcome }),
    [mission, plan, ctx.profile, campaign.orbitInsertion, campaign.departureCommandT, outcome]);
  const hasDeparture = fullTl.departure !== null;
  const commanded = campaign.departureCommandT !== null && campaign.departureCommandT !== undefined;
  // Sem comando de partida a sonda continua na órbita de estacionamento (a trajetória de partida não é mostrada)
  const timeline = useMemo<MissionTimeline>(() => (hasDeparture && !commanded
    ? { ...fullTl, segments: [{ ...fullTl.segments[0]!, t1: Infinity }], milestones: fullTl.milestones.filter((m) => m.id === REV_EVENT), departure: null, arrival: null }
    : fullTl), [fullTl, hasDeparture, commanded]);
  const separationT = hasDeparture ? fullTl.milestones.find((m) => m.id === 'separation')?.t ?? null : null;
  const departureT = fullTl.departure?.t ?? null;
  const departed = recordedIds.has('departure-burn');
  const separated = !hasDeparture || recordedIds.has('separation');
  // Manobra da sonda que o relógio espera (a próxima ainda não executada)
  const pendingHold = timeline.milestones.filter((m) => m.kind === 'burn' && m.maneuverId && !doneIds.has(m.maneuverId)).sort((x, y) => x.t - y.t)[0] ?? null;
  const [info, setInfo] = useState<OrbitInfo | null>(null);
  const [warp, setWarp] = useState<number | 'auto'>('auto');
  const [running, setRunning] = useState(true);
  const clockStarted = useRef(false);

  useEffect(() => {
    if (!ctrl) return;
    ctrl.setMission({ timeline, vehicle: hasDeparture ? vehicle : null, separationT });
    if (!clockStarted.current) {
      clockStarted.current = true;
      ctrl.setTime(campaign.opsClockS ?? 0);
      ctrl.setFocus('trajectory');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl, timeline]);
  // Sonda montada (mesmos componentes do hangar) em tamanho real
  useEffect(() => {
    if (ctrl) ctrl.setProbe(campaign.spacecraft.installed, power.arraysDeployed || !power.hasSolarArrays);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl, campaign.spacecraft.installed]);
  useEffect(() => { ctrl?.setClock({ running: running && !pendingEvent, warp, holdAt: pendingHold?.t ?? null }); }, [ctrl, running, warp, pendingHold?.t, pendingEvent]);
  useEffect(() => {
    if (!ctrl) return;
    const id = setInterval(() => setInfo(ctrl.info()), 250);
    return () => clearInterval(id);
  }, [ctrl]);
  // Eventos da trajetória registrados quando o relógio passa por eles (volta completa medida pela posição)
  const clockRef = useRef(0);
  useEffect(() => {
    if (!info) return;
    clockRef.current = info.t;
    if (!revDone && info.revolution.complete) {
      recordEvent({ t: info.t, phase: 'orbit', id: REV_EVENT, label: `Primeira volta completa em torno da Terra: 360° percorridos (medidos pela posição angular) em ${(info.t / 60).toFixed(1)} min`, severity: 'info' });
      setOpsClock(info.t);
    }
    if (commanded && departureT !== null && !departed && info.t >= departureT) {
      const m = fullTl.milestones.find((x) => x.id === 'departure-burn');
      recordEvent({ t: departureT, phase: 'orbit', id: 'departure-burn', label: m?.label ?? 'Injeção de partida', severity: 'info' });
      setOpsClock(info.t);
    }
    if (departed && !recordedIds.has('separation') && separationT !== null && info.t >= separationT) {
      recordEvent({ t: separationT, phase: 'cruise', id: 'separation', label: 'Separação da sonda do estágio superior (molas, 0,5 m/s)', severity: 'info' });
    }
    for (const m of timeline.milestones) {
      if ((m.kind === 'patch' || m.kind === 'arrival') && m.id !== 'separation' && info.t >= m.t && !recordedIds.has(`traj-${m.id}`)) {
        recordEvent({ t: m.t, phase: 'cruise', id: `traj-${m.id}`, label: m.label, severity: 'info' });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);
  // Relógio salvo para retomar a missão
  useEffect(() => {
    const id = setInterval(() => setOpsClock(clockRef.current), 20000);
    return () => { clearInterval(id); setOpsClock(clockRef.current); };
  }, [setOpsClock]);
  // Exposto para os testes ponta a ponta (posição da sonda, foco, escala, relógio)
  useEffect(() => {
    if (!ctrl || !navigator.webdriver) return;
    (globalThis as { __orbitView?: unknown }).__orbitView = ctrl;
    return () => { delete (globalThis as { __orbitView?: unknown }).__orbitView; };
  }, [ctrl]);
  const commandDeparture = () => {
    const t = info?.t ?? 0;
    setOpsClock(t, t);
    recordEvent({ t, phase: 'orbit', id: 'departure-command', label: 'Injeção de partida comandada: o estágio superior queima na próxima passagem pelo ponto de queima', severity: 'info' });
  };
  const deployArrays = () => {
    ctrl?.deployArrays();
    recordEvent({ t: 0, phase: 'orbit', id: ARRAYS_EVENT, label: 'Painéis solares estendidos: geração solar disponível para propulsão e instrumentos', severity: 'info' });
  };

  const tNow = () => info?.t ?? 0;
  // Sem correções de trajetória (ou com navegação degradada) as dispersões aumentam o Δv real das manobras
  const dispersion = (m: PlannedManeuver) => {
    let f = 1;
    if (m.critical && plan.kind !== 'earth-orbit' && plan.tcmCount === 0) f *= 1.12;
    if (campaign.activeEffects.includes('sensor-degraded')) f *= 1.04;
    return f;
  };

  // Δv cobrado: o da trajetória calculada (o orçado no planejamento fica como referência)
  const charged = (m: PlannedManeuver) => chargedManeuver(m, m.executable ? milestoneOf(m.id)?.dvMS : undefined);
  const runManeuver = (m: PlannedManeuver) => {
    const out = executeManeuver(charged(m), summary, propellant, dispersion(m), tNow());
    recordManeuver(out.record, out.event, out.propellantRemainingKg, out.insertionState);
  };

  const respond = (f: FailureProbability, response: string) => {
    const rng = createRng(hashSeed(campaign.seed, campaign.attempt, 'response', f.spec.id));
    let effect: string | undefined;
    let note = '';
    const commCount = summary.parts.filter((p) => p.category === 'comunicacao' && p.effects.comm).length;
    switch (response) {
      case 'continue': effect = f.spec.effect === 'solar-storm' ? 'solar-storm-unprotected' : f.spec.effect; note = 'Sem ação corretiva: o efeito permanece.'; break;
      case 'load-shed': note = 'Cargas não essenciais desligadas: instrumentos priorizados.'; break;
      case 'switch-redundant': if (commCount >= 2) note = 'Transmissor redundante assumiu o enlace.'; else { effect = 'comm-rate-50'; note = 'Não há transmissor redundante instalado: taxa reduzida a 50%.'; } break;
      case 'thruster-control': if (summary.capabilities.has('attitude-thrusters')) note = 'Atitude mantida por propulsores (consumo extra de propelente).'; else { effect = 'pointing-degraded'; note = 'Sem propulsores de atitude: apontamento degradado.'; } break;
      case 'reboot': effect = 'safe-mode'; note = 'Computador reiniciado; um ciclo de observação perdido.'; break;
      case 'protect-instruments': note = 'Instrumentos em modo de proteção durante a tempestade.'; break;
      case 'reduce-duty': effect = 'safe-mode'; note = 'Ciclo de trabalho reduzido para controlar a temperatura.'; break;
      case 'avoidance-maneuver': {
        const out = executeManeuver({ id: 'avoid', label: 'Manobra de desvio de detrito', dvMS: 0.5, executable: true, critical: false, explanation: '' }, summary, propellant, 1, tNow());
        recordManeuver(out.record, out.event, out.propellantRemainingKg);
        note = 'Desvio executado.';
        break;
      }
      case 'accept-risk': if (rng() < 0.05) { effect = 'component-damage'; note = 'Impacto de micrometeoroide: componente danificado.'; } else note = 'Conjunção passou sem impacto.'; break;
    }
    const ev: FlightEventRecord = { t: tNow(), phase, id: `resp-${f.spec.id}`, label: `${f.spec.category}: ${RESPONSE_LABEL[response] ?? response}. ${note}`, severity: effect ? 'grave' : 'aviso' };
    recordEvent(ev, effect);
  };

  const criticalDone = executable.filter((m) => m.critical).every((m) => doneIds.has(m.id));
  const canStartScience = (insertion === 'captured' || insertion === 'high-orbit') && criticalDone && !pendingEvent && revDone;
  // Uma manobra só pode ser executada quando o relógio chegou ao instante dela (na órbita terrestre, após a volta)
  // A ordem é a da trajetória (ex.: no ΔV-EGA a DSM vem antes da TCM), não a da tabela do orçamento
  const maneuverReady = (id: string) => (plan.kind === 'earth-orbit' ? revDone && next?.id === id : pendingHold?.maneuverId === id && Boolean(info?.holding));
  const milestoneOf = (id: string) => fullTl.milestones.find((x) => x.maneuverId === id || x.id === id);
  const parkingPhase = !hasDeparture ? !revDone : !departed;
  const revPct = Math.round((info?.revolution.fraction ?? (revDone ? 1 : 0)) * 100);
  const failedCapture = insertion === 'flyby';

  return (
    <>
      <aside className="side-left panel" aria-label="Operações">
        <div className="panel-title"><h2>{phase === 'science' ? 'Operações científicas' : 'Manobras da sonda'}</h2><span className="chip info">{parkingPhase ? 'órbita da Terra' : INSERTION_LABEL[insertion]}</span></div>
        <div className="panel-body" style={{ flex: 1 }}>
          {parkingPhase && (
            <div className="small" style={{ border: '1px solid var(--panel-border)', padding: 8, marginBottom: 8, borderRadius: 3 }} data-testid="earth-orbit-phase">
              <div className="row"><b>Fase: órbita da Terra</b><span className="spacer" /><span className="mono" data-testid="rev-progress">{revDone ? 'volta completa' : `volta 1: ${revPct}%`}</span></div>
              <div className="meter" style={{ height: 4, background: 'var(--graphite-600)', margin: '6px 0' }}><div style={{ width: `${revDone ? 100 : revPct}%`, height: '100%', background: revDone ? 'var(--green)' : 'var(--blue)' }} /></div>
              <div className="muted">
                Período {(fullTl.parking.period / 60).toFixed(1)} min · perigeu {(fullTl.parking.perigeeAltM / 1000).toFixed(0)} km · apogeu {(fullTl.parking.apogeeAltM / 1000).toFixed(0)} km · inclinação {fullTl.parking.inclinationDeg.toFixed(1)}°.
                {' '}A volta é contada pelo ângulo percorrido em torno da Terra (360°), não por um cronômetro.
              </div>
              {hasDeparture && (
                <div style={{ marginTop: 6 }}>
                  {!commanded ? (
                    <>
                      <div className="muted">Sonda acoplada ao estágio superior. {revDone ? 'Volta completa: a injeção de partida pode ser comandada.' : 'A injeção de partida só pode ser comandada depois da primeira volta completa.'}</div>
                      <button className="btn primary small" style={{ marginTop: 6 }} disabled={!revDone || Boolean(pendingEvent)} onClick={commandDeparture} data-testid="command-departure">{fullTl.departure?.label ?? 'Injeção de partida'}</button>
                    </>
                  ) : (
                    <div data-testid="departure-countdown">Injeção na próxima passagem pelo ponto de queima: {departureT !== null && info ? (info.t < departureT ? `em ${fmtCountdown(departureT - info.t)}` : 'executada') : '—'} · Δv {fullTl.departure?.dvMS.toFixed(0)} m/s{fullTl.departure && fullTl.departure.c3KmS2 > 0 ? ` (C3 ${fullTl.departure.c3KmS2.toFixed(1)} km²/s²)` : ''}</div>
                  )}
                </div>
              )}
            </div>
          )}
          {power.needsDeploy && (
            <div className="small" style={{ border: '1px solid var(--amber)', padding: 8, marginBottom: 8, borderRadius: 3 }} data-testid="arrays-notice">
              Painéis solares ainda dobrados (como viajaram dentro da coifa).{' '}
              {power.blocked ? 'Sem eles a sonda só tem a bateria: propulsão principal e instrumentos ficam desligados.' : 'O RTG mantém a sonda ligada, mas a geração fica reduzida.'}
              <div style={{ marginTop: 6 }}><button className="btn amber small" onClick={deployArrays} disabled={!separated} data-testid="deploy-arrays">Estender painéis solares</button>{!separated && <span className="muted"> depois da separação do estágio superior</span>}</div>
            </div>
          )}
          {phase === 'cruise' ? (
            <>
              <table className="checks">
                <thead><tr><th>Manobra</th><th title="Δv calculado pela trajetória (o orçado no planejamento aparece como referência)">Δv cobrado</th><th /></tr></thead>
                <tbody>
                  {maneuvers.map((m) => {
                    const rec = campaign.maneuvers.find((r) => r.id === m.id);
                    const ms = m.executable ? milestoneOf(m.id) : undefined;
                    return (
                      <tr key={m.id}>
                        <td>{m.label}{m.critical && <span className="chip warn" style={{ marginLeft: 4 }}>crítica</span>}<div className="small muted">{m.executable ? m.explanation : 'Reserva de propelente (consumo contínuo ao longo da missão).'}</div>{ms && ms.dvMS !== undefined && <div className="small muted" data-testid={`dv-calc-${m.id}`}>Δv cobrado = calculado pela trajetória: {ms.dvMS.toFixed(ms.dvMS < 10 ? 1 : 0)} m/s · orçado no planejamento: {m.dvMS.toFixed(0)} m/s (referência){plan.kind !== 'earth-orbit' && info && !rec ? (info.t < ms.t ? ` · em ${fmtCountdown(ms.t - info.t)}` : ' · agora') : ''}</div>}{rec && <div className="small" style={{ color: rec.success ? 'var(--green)' : 'var(--red)' }}>{rec.note}</div>}</td>
                        <td className="mono">{fmtMs(m.executable ? charged(m).dvMS * dispersion(m) : m.dvMS)}</td>
                        <td>{m.executable && !rec && <button className="btn small primary" disabled={!maneuverReady(m.id) || Boolean(pendingEvent) || failedCapture || power.blocked} onClick={() => runManeuver(m)} data-testid={`mnv-${m.id}`}>Executar</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {plan.kind !== 'earth-orbit' && plan.tcmCount === 0 && <p className="small" style={{ color: 'var(--amber)' }}>Sem correções de trajetória: a dispersão aumenta o Δv da inserção em 12%.</p>}
            </>
          ) : (
            <table className="checks">
              <thead><tr><th>Checkpoint</th><th>Qualidade</th><th /></tr></thead>
              <tbody>
                {mission.checkpoints.map((cp) => {
                  const r = campaign.checkpointResults.find((x) => x.checkpointId === cp.id);
                  return (
                    <tr key={cp.id}>
                      <td>{cp.name}<div className="small muted">lat. {cp.latitudeDeg}° · {cp.measures.join(', ')}</div>{r?.notes.map((n) => <div key={n} className="small" style={{ color: 'var(--amber)' }}>{n}</div>)}</td>
                      <td className="mono">{r ? `${(r.quality * 100).toFixed(0)}% · ${r.dataGb.toFixed(0)} GB` : '—'}</td>
                      <td>{!r && <button className="btn small primary" disabled={Boolean(pendingEvent) || power.blocked} onClick={() => recordCheckpoint(evaluateCheckpoint(mission, plan, campaign.spacecraft, cp, { activeEffects: campaign.activeEffects, insertionState: insertion }))} data-testid={`cp-${cp.id}`}>Observar</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>

      <aside className="side-right panel" aria-label="Registro">
        <div className="panel-title"><h2>Registro da missão</h2></div>
        <div className="terminal panel-body" style={{ flex: 1 }} data-testid="ops-log">
          {campaign.flightEvents.slice(-60).map((e, i) => <div key={i} className={e.severity === 'critica' || e.severity === 'grave' ? 'bad' : e.severity === 'aviso' ? 'warn' : ''}><span className="dim">{e.phase.toUpperCase()}</span> {e.label}</div>)}
        </div>
      </aside>

      {pendingEvent && (
        <div className="center-panel" style={{ width: 'min(560px, calc(100vw - 28px))', zIndex: 10 }}>
          <Panel title={`Anomalia: ${pendingEvent.spec.category}`}>
            <p className="small">Subsistema: {pendingEvent.spec.subsystem}. Probabilidade calculada: {(pendingEvent.probability * 100).toFixed(1)}% ({pendingEvent.factors.map((f) => `${f.name} ×${f.value.toFixed(2)}`).join(', ') || 'sem fatores'}).</p>
            <p className="small">Impacto na ciência: {pendingEvent.spec.scienceImpact}</p>
            <p className="small muted">Recuperação recomendada: {pendingEvent.spec.recovery}</p>
            <div className="row">{pendingEvent.spec.responses.map((r) => <button key={r} className="btn" onClick={() => respond(pendingEvent, r)} data-testid={`resp-${r}`}>{RESPONSE_LABEL[r] ?? r}</button>)}</div>
          </Panel>
        </div>
      )}

      <OrbitHud ctrl={ctrl}>
        {info?.stackAttached && <div className="muted">Conjunto estágio superior + sonda (atitude prógrada para a injeção).</div>}
      </OrbitHud>

      <div className="bottom-bar">
        <Stat label="Propelente restante" value={fmtKg(propellant)} sub={`de ${fmtKg(campaign.spacecraft.propellantKg)}`} meter={campaign.spacecraft.propellantKg ? 1 - propellant / campaign.spacecraft.propellantKg : 0} />
        <Stat label="Manobras" value={`${campaign.maneuvers.filter((m) => m.id !== 'avoid').length} / ${executable.length}`} />
        <Stat label="Dados coletados" value={`${campaign.checkpointResults.reduce((s, r) => s + r.dataGb, 0).toFixed(0)} GB`} sub={`${campaign.checkpointResults.length} / ${mission.checkpoints.length} checkpoints`} />
        <Stat label="Efeitos ativos" value={campaign.activeEffects.length ? campaign.activeEffects.join(', ') : 'nenhum'} />
        <div className="panel" style={{ padding: 10, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', maxWidth: 520 }} data-testid="mission-clock">
          <span className="small mono" style={{ minWidth: 150 }}>{info ? `${info.dateIso.slice(0, 16).replace('T', ' ')} UTC` : '—'}<br /><span className="muted">{info?.holding ? 'aguardando manobra' : info ? fmtWarp(info.warp) : ''}</span></span>
          <button className={`btn small ${running ? '' : 'amber'}`} onClick={() => setRunning((r) => !r)} data-testid="clock-run">{running ? 'Pausar' : 'Continuar'}</button>
          {WARPS.map((w) => <button key={String(w)} className={`btn small ${warp === w ? 'amber' : ''}`} onClick={() => setWarp(w)} data-testid={`warp-${w}`}>{w === 'auto' ? 'Auto' : fmtWarp(w)}</button>)}
        </div>
        <div className="panel" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          {phase === 'cruise' && !failedCapture && <button className="btn primary" disabled={!canStartScience} onClick={() => goTo('science')} data-testid="to-science">Iniciar ciência →</button>}
          {(phase === 'science' || failedCapture) && <button className="btn primary" disabled={Boolean(pendingEvent)} onClick={() => void finishMission()} data-testid="finish-mission">Encerrar missão e gerar relatório</button>}
        </div>
      </div>
    </>
  );
}
