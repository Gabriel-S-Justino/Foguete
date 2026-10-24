import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '@babylonjs/core';
import { useScene } from '../../components/useScene';
import { fmtKg } from '../../components/ui';
import { findVehicle, getMission } from '../../engine/catalog';
import { validateMission } from '../../engine/rules/validation';
import { createLaunchPadScene, type PadCamera } from '../../engine/scenes/launchPadScene';
import { LaunchController, type LaunchSnapshot } from '../../engine/simulation/launchController';
import { useCampaign } from '../../store/campaignStore';

const FINAL = new Set(['orbit', 'aborted', 'failed', 'scrubbed']);
const STATE_LABEL: Record<LaunchSnapshot['state'], string> = {
  checks: 'VERIFICAÇÕES', ready: 'PRONTO — AGUARDANDO GO', hold: 'HOLD', countdown: 'CONTAGEM FINAL', ignition: 'IGNIÇÃO',
  flight: 'EM VOO', orbit: 'ÓRBITA ATINGIDA', aborted: 'ABORTADO', failed: 'FALHA DE LANÇAMENTO', scrubbed: 'CANCELADO (SCRUB)',
};

export function LaunchScreen() {
  const campaign = useCampaign((s) => s.campaign)!;
  const recordLaunch = useCampaign((s) => s.recordLaunch);
  const recordEvent = useCampaign((s) => s.recordEvent);
  const mission = getMission(campaign.missionId!);
  const vehicle = findVehicle(campaign.vehicleId)!;
  const [window, setWindow] = useState(0);

  // Controlador de lançamento: recriado a cada nova janela (após scrub), sempre a partir da configuração validada
  const ctrl = useMemo(() => {
    const v = validateMission({ mission, config: campaign.spacecraft, vehicleId: campaign.vehicleId, plan: campaign.plan!, assistance: campaign.assistance });
    return new LaunchController({ mission, config: campaign.spacecraft, vehicle, plan: campaign.plan!, profile: v.context.profile, validation: v, seed: campaign.seed, attempt: campaign.attempt * 100 + window });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);
  const factory = useMemo(() => (e: Engine) => createLaunchPadScene(e, vehicle, campaign.spacecraft.installed), [vehicle, campaign.spacecraft.installed]);
  const pad = useScene(`launch-pad-${campaign.attempt}`, factory);
  const [snap, setSnap] = useState<LaunchSnapshot>(() => ctrl.snapshot());
  const [camera, setCamera] = useState<PadCamera>('overview');
  const [paused, setPaused] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pad?.bind(ctrl); }, [pad, ctrl]);
  useEffect(() => ctrl.subscribe(setSnap), [ctrl]);
  useEffect(() => () => ctrl.dispose(), [ctrl]);
  useEffect(() => { pad?.setCamera(camera); }, [pad, camera]);
  useEffect(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight }); }, [snap.events.length]);

  const a = ctrl.actions;
  const tel = snap.telemetry;
  const final = FINAL.has(snap.state);
  const finish = () => recordLaunch(ctrl.flightOutcome, ctrl.flightEvents, ctrl.activeEffects);
  const newWindow = () => {
    recordEvent({ t: 0, phase: 'pad', id: `scrub-${window}`, label: 'Lançamento cancelado (scrub); nova janela agendada', severity: 'aviso' });
    setWindow((w) => w + 1);
  };
  const tFmt = snap.state === 'countdown' || snap.state === 'checks' || snap.state === 'ready' || snap.state === 'hold'
    ? `T−${snap.countdownS.toFixed(1)} s` : `T+${tel.t.toFixed(1)} s`;

  return (
    <>
      <div className="panel" style={{ position: 'absolute', left: 14, top: 14, padding: '8px 12px', minWidth: 300 }}>
        <div className="small muted">{mission.code} · {vehicle.name}</div>
        <div className="mono" style={{ fontSize: 26, color: 'var(--amber)' }} data-testid="clock">{tFmt}</div>
        <div className="small" data-testid="launch-state" style={{ letterSpacing: '0.1em', color: snap.state === 'orbit' ? 'var(--green)' : ['aborted', 'failed'].includes(snap.state) ? 'var(--red)' : 'var(--white)' }}>{STATE_LABEL[snap.state]}</div>
        {snap.holdRemainingS > 0 && <div className="small muted">hold: {snap.holdRemainingS.toFixed(1)} s</div>}
        {snap.perfDegraded && <div className="small" style={{ color: 'var(--amber)' }}>Simulação mais lenta que o tempo real (física preservada)</div>}
      </div>

      <div className="side-right panel" style={{ top: 14 }} aria-label="Telemetria">
        <div className="panel-title"><h2>Centro de controle</h2></div>
        <div className="panel-body" style={{ flex: 1 }}>
          <dl className="kv">
            <dt>Altitude</dt><dd data-testid="tel-alt">{(tel.altitudeM / 1000).toFixed(1)} km</dd>
            <dt>Velocidade inercial</dt><dd>{tel.speedMS.toFixed(0)} m/s</dd>
            <dt>Velocidade vertical</dt><dd>{tel.verticalSpeedMS.toFixed(0)} m/s</dd>
            <dt>Alcance horizontal</dt><dd>{(tel.downrangeM / 1000).toFixed(1)} km</dd>
            <dt>Aceleração</dt><dd>{tel.accelerationG.toFixed(2)} g</dd>
            <dt>Pressão dinâmica</dt><dd>{(tel.dynamicPressurePa / 1000).toFixed(1)} kPa</dd>
            <dt>Arfagem</dt><dd>{tel.pitchDeg.toFixed(1)}°</dd>
            <dt>Massa</dt><dd>{fmtKg(tel.massKg)}</dd>
            <dt>Propelente</dt><dd>{fmtKg(tel.propellantKg)}</dd>
            <dt>Estágio</dt><dd>{tel.stageName}</dd>
            <dt>Motores</dt><dd>{tel.engineState}</dd>
            <dt>Empuxo</dt><dd>{(tel.thrustN / 1000).toFixed(0)} kN</dd>
            <dt>Temperatura do ar</dt><dd>{(tel.temperatureK - 273.15).toFixed(0)} °C</dd>
            <dt>Vibração</dt><dd>{snap.vibrationG.toFixed(2)} g ({snap.vibrationLabel})</dd>
            <dt>Pressão dos tanques</dt><dd>{snap.tankPressureBar.toFixed(2)} bar</dd>
            <dt>Válvulas</dt><dd>{snap.valves}</dd>
            <dt>Barramento</dt><dd>{snap.busVoltage.toFixed(1)} V</dd>
            <dt>Navegação</dt><dd>{snap.navigation}</dd>
            <dt>Periapse / apoapse</dt><dd>{tel.periapsisKm.toFixed(0)} / {tel.apoapsisKm.toFixed(0)} km</dd>
          </dl>
          <h3 style={{ marginTop: 10 }}>Sistemas</h3>
          <table className="checks"><tbody>
            {snap.checks.map((c) => <tr key={c.id} title={c.detail}><td>{c.label}</td><td><span className={`chip ${c.status === 'ok' ? 'ok' : c.status === 'aviso' ? 'warn' : c.status === 'falha' ? 'bad' : ''}`}>{c.status}</span></td></tr>)}
          </tbody></table>
          {snap.issues.length > 0 && (
            <>
              <h3 style={{ marginTop: 10 }}>Condições ativas</h3>
              <ul className="small" style={{ paddingLeft: 18 }}>{snap.issues.map((i) => <li key={i.id} style={{ color: i.blocking ? 'var(--red)' : 'var(--amber)' }}>{i.label} — {i.recovery} <span className="muted">(p = {(i.probability * 100).toFixed(1)}%)</span></li>)}</ul>
            </>
          )}
        </div>
      </div>

      <div className="terminal" ref={termRef} style={{ position: 'absolute', left: 14, bottom: 76, width: 'min(620px, calc(100vw - 420px))', height: 230, overflow: 'auto', padding: 10, borderRadius: 3 }} data-testid="terminal" aria-live="polite">
        {snap.events.map((e, i) => (
          <div key={i} className={e.severity === 'critica' || e.severity === 'grave' ? 'bad' : e.severity === 'aviso' ? 'warn' : ''}>
            <span className="dim">[{e.t >= 0 ? `T+${e.t.toFixed(1).padStart(6, ' ')}` : ''}] {e.phase.toUpperCase().padEnd(8, ' ')}</span> {e.label}
          </div>
        ))}
      </div>

      <div className="bottom-bar">
        <div className="panel" style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          <button className="btn primary" disabled={!a.startProcedures} onClick={() => ctrl.startProcedures()} data-testid="start-procedures">Iniciar procedimentos</button>
          <button className="btn amber" disabled={!a.hold} onClick={() => ctrl.hold()} data-testid="hold">Hold</button>
          <button className="btn primary" disabled={!a.confirmLaunch} onClick={() => ctrl.confirmLaunch()} data-testid="confirm-launch" title={a.blocking ? 'Condição bloqueante ativa' : ''}>Confirmar lançamento</button>
          <button className="btn danger" disabled={!a.abort} onClick={() => ctrl.abort()} data-testid="abort">Abortar</button>
          {snap.state === 'flight' && <button className="btn danger small" onClick={() => ctrl.abort('flight-termination')}>Terminação de voo</button>}
          <button className="btn" disabled={!a.scrub} onClick={() => ctrl.scrub()} data-testid="scrub">Scrub</button>
          <button className="btn" disabled={!a.pause} onClick={() => { ctrl.togglePause(); setPaused((p) => !p); }}>{paused ? 'Retomar' : 'Pausar'}</button>
          <span className="small muted" style={{ marginLeft: 8 }}>Tempo:</span>
          {[1, 5, 10, 20].map((w) => <button key={w} className={`btn small ${snap.timeWarp === w ? 'amber' : ''}`} onClick={() => ctrl.setTimeWarp(w)} data-testid={`warp-${w}`}>{w}×</button>)}
          <span className="small muted" style={{ marginLeft: 8 }}>Câmera:</span>
          {(['overview', 'cinematic', 'tracking', 'onboard'] as PadCamera[]).map((c) => <button key={c} className={`btn small ${camera === c ? 'amber' : ''}`} onClick={() => setCamera(c)}>{{ overview: 'Geral', cinematic: 'Cinemática', tracking: 'Rastreio', onboard: 'A bordo' }[c]}</button>)}
          <span className="spacer" />
          {snap.state === 'scrubbed' && <button className="btn amber" onClick={newWindow} data-testid="new-window">Nova janela</button>}
          {final && snap.state !== 'scrubbed' && <button className="btn primary" onClick={finish} data-testid="launch-continue">{snap.state === 'orbit' ? 'Separação: operar a sonda →' : 'Ver relatório →'}</button>}
          {snap.state === 'scrubbed' && <button className="btn" onClick={finish}>Encerrar campanha</button>}
        </div>
      </div>
    </>
  );
}
