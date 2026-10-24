import { useEffect, useMemo } from 'react';
import { useScene } from '../../components/useScene';
import { fmtKg, fmtMs, Panel, Stat } from '../../components/ui';
import { getMission } from '../../engine/catalog';
import { createRng, hashSeed } from '../../engine/core/rng';
import { analyzeSpacecraft } from '../../engine/entities/spacecraft';
import { rollPhase, type FailureProbability } from '../../engine/failures/failures';
import { validateMission } from '../../engine/rules/validation';
import { createOrbitScene } from '../../engine/scenes/otherScenes';
import { evaluateCheckpoint, executeManeuver, plannedManeuvers, type PlannedManeuver } from '../../engine/science/operations';
import { useCampaign } from '../../store/campaignStore';
import type { FlightEventRecord } from '../../types/campaign';
import { configureOrbitView } from '../mission-planning/orbitView';

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
  useEffect(() => { if (ctrl) configureOrbitView(ctrl, plan, ctx.profile, insertion === 'none' ? 'captured' : insertion); }, [ctrl, plan, ctx.profile, insertion]);
  useEffect(() => {
    if (!ctrl) return;
    ctrl.setProgress(phase === 'science' ? 1 : executable.length ? campaign.maneuvers.length / executable.length : 1);
  }, [ctrl, phase, campaign.maneuvers.length, executable.length]);

  const tNow = () => (ctx.profile.transferTimeS || 86400) * ((campaign.maneuvers.length + 1) / Math.max(1, executable.length));
  // Sem correções de trajetória (ou com navegação degradada) as dispersões aumentam o Δv real das manobras
  const dispersion = (m: PlannedManeuver) => {
    let f = 1;
    if (m.critical && plan.kind !== 'earth-orbit' && plan.tcmCount === 0) f *= 1.12;
    if (campaign.activeEffects.includes('sensor-degraded')) f *= 1.04;
    return f;
  };

  const runManeuver = (m: PlannedManeuver) => {
    const out = executeManeuver(m, summary, propellant, dispersion(m), tNow());
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
  const canStartScience = (insertion === 'captured' || insertion === 'high-orbit') && criticalDone && !pendingEvent;
  const failedCapture = insertion === 'flyby';

  return (
    <>
      <aside className="side-left panel" aria-label="Operações">
        <div className="panel-title"><h2>{phase === 'science' ? 'Operações científicas' : 'Manobras da sonda'}</h2><span className="chip info">{INSERTION_LABEL[insertion]}</span></div>
        <div className="panel-body" style={{ flex: 1 }}>
          {phase === 'cruise' ? (
            <>
              <table className="checks">
                <thead><tr><th>Manobra</th><th>Δv</th><th /></tr></thead>
                <tbody>
                  {maneuvers.map((m) => {
                    const rec = campaign.maneuvers.find((r) => r.id === m.id);
                    return (
                      <tr key={m.id}>
                        <td>{m.label}{m.critical && <span className="chip warn" style={{ marginLeft: 4 }}>crítica</span>}<div className="small muted">{m.executable ? m.explanation : 'Reserva de propelente (consumo contínuo ao longo da missão).'}</div>{rec && <div className="small" style={{ color: rec.success ? 'var(--green)' : 'var(--red)' }}>{rec.note}</div>}</td>
                        <td className="mono">{fmtMs(m.dvMS * (m.executable ? dispersion(m) : 1))}</td>
                        <td>{m.executable && !rec && <button className="btn small primary" disabled={next?.id !== m.id || Boolean(pendingEvent) || failedCapture} onClick={() => runManeuver(m)} data-testid={`mnv-${m.id}`}>Executar</button>}</td>
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
                      <td>{!r && <button className="btn small primary" disabled={Boolean(pendingEvent)} onClick={() => recordCheckpoint(evaluateCheckpoint(mission, plan, campaign.spacecraft, cp, { activeEffects: campaign.activeEffects, insertionState: insertion }))} data-testid={`cp-${cp.id}`}>Observar</button>}</td>
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

      <div className="bottom-bar">
        <Stat label="Propelente restante" value={fmtKg(propellant)} sub={`de ${fmtKg(campaign.spacecraft.propellantKg)}`} meter={campaign.spacecraft.propellantKg ? 1 - propellant / campaign.spacecraft.propellantKg : 0} />
        <Stat label="Manobras" value={`${campaign.maneuvers.filter((m) => m.id !== 'avoid').length} / ${executable.length}`} />
        <Stat label="Dados coletados" value={`${campaign.checkpointResults.reduce((s, r) => s + r.dataGb, 0).toFixed(0)} GB`} sub={`${campaign.checkpointResults.length} / ${mission.checkpoints.length} checkpoints`} />
        <Stat label="Efeitos ativos" value={campaign.activeEffects.length ? campaign.activeEffects.join(', ') : 'nenhum'} />
        <div className="panel" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          {phase === 'cruise' && !failedCapture && <button className="btn primary" disabled={!canStartScience} onClick={() => goTo('science')} data-testid="to-science">Iniciar ciência →</button>}
          {(phase === 'science' || failedCapture) && <button className="btn primary" disabled={Boolean(pendingEvent)} onClick={() => void finishMission()} data-testid="finish-mission">Encerrar missão e gerar relatório</button>}
        </div>
      </div>
    </>
  );
}
