import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '@babylonjs/core';
import { useScene } from '../../components/useScene';
import { fmtKg } from '../../components/ui';
import { findVehicle, getMission } from '../../engine/catalog';
import { validateMission } from '../../engine/rules/validation';
import { createLaunchPadScene, PAD_CAMERAS, type PadCamera } from '../../engine/scenes/launchPadScene';
import { LaunchController, type LaunchSnapshot } from '../../engine/simulation/launchController';
import { useCampaign } from '../../store/campaignStore';

import { ARRAYS_EVENT } from '../../engine/entities/power';

const FINAL = new Set(['orbit', 'aborted', 'failed', 'scrubbed']);
const STATE_LABEL: Record<LaunchSnapshot['state'], string> = {
  checks: 'VERIFICAÇÕES', ready: 'PRONTO — AGUARDANDO GO', hold: 'HOLD', countdown: 'CONTAGEM FINAL', ignition: 'IGNIÇÃO',
  flight: 'EM VOO', orbit: 'ÓRBITA ATINGIDA', aborted: 'ABORTADO', failed: 'FALHA DE LANÇAMENTO', scrubbed: 'CANCELADO (SCRUB)',
};

const CAMERA_LABEL: Record<PadCamera, string> = { overview: 'Geral', tracking: 'Rastreio', cinematic: 'Cinemática', externalDown: 'Externa ↓', externalUp: 'Externa ↑' };
const CAMERA_HINT: Record<PadCamera, string> = {
  overview: 'Câmera de rastreio fixa no solo, com zoom óptico que acompanha a distância',
  tracking: 'Acompanha o veículo e a inclinação real da trajetória até a órbita; arraste para girar em volta',
  cinematic: 'Gira lentamente em volta do veículo',
  externalDown: 'Câmera presa ao último estágio, olhando para baixo (motores, separação, Terra)',
  externalUp: 'Câmera presa ao último estágio, olhando para cima (corpo e coifa)',
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
  // Depois da decolagem a vista passa sozinha para o rastreio (que acompanha a inclinação até a órbita),
  // a menos que o jogador tenha escolhido outra câmera desde a confirmação do lançamento
  const userCamera = useRef(false);
  const pickCamera = (c: PadCamera) => { userCamera.current = true; setCamera(c); };
  useEffect(() => {
    if (!userCamera.current && camera === 'overview' && snap.state === 'flight' && snap.telemetry.altitudeM > 250) setCamera('tracking');
  }, [snap, camera]);
  // Exposto para os testes ponta a ponta (estado das câmeras e do zoom)
  useEffect(() => {
    if (!pad || !navigator.webdriver) return;
    (globalThis as { __launchPad?: unknown }).__launchPad = pad;
    return () => { delete (globalThis as { __launchPad?: unknown }).__launchPad; };
  }, [pad]);
  useEffect(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight }); }, [snap.events.length]);

  // Painéis solares: recolhidos na coifa durante a subida; em órbita o jogador manda abrir
  const arraysDeployed = campaign.flightEvents.some((e) => e.id === ARRAYS_EVENT);
  const deployArrays = () => {
    pad?.deployArrays();
    recordEvent({ t: snap.telemetry.t, phase: 'orbit', id: ARRAYS_EVENT, label: 'Painéis solares estendidos em órbita', severity: 'info' });
    if (camera !== 'tracking') pickCamera('tracking');
  };

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
            <dt>Temperatura de estagnação</dt><dd title="Temperatura do ar ambiente somada ao aquecimento por compressão no nariz (v²/2cp)">{(tel.temperatureK - 273.15).toFixed(0)} °C</dd>
            <dt>Vibração</dt><dd>{snap.vibrationG.toFixed(2)} g ({snap.vibrationLabel})</dd>
            <dt>Pressão dos tanques</dt><dd>{snap.tankPressureBar.toFixed(2)} bar</dd>
            <dt>Válvulas</dt><dd>{snap.valves}</dd>
            <dt>Barramento</dt><dd>{snap.busVoltage.toFixed(1)} V</dd>
            <dt>Navegação</dt><dd>{snap.navigation}</dd>
            <dt>Periapse / apoapse</dt><dd>{tel.periapsisKm < 0 ? 'suborbital' : `${tel.periapsisKm.toFixed(0)} km`} / {tel.apoapsisKm.toFixed(0)} km</dd>
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
          <button className="btn primary" disabled={!a.confirmLaunch} onClick={() => { userCamera.current = false; ctrl.confirmLaunch(); }} data-testid="confirm-launch" title={a.blocking ? 'Condição bloqueante ativa' : ''}>Confirmar lançamento</button>
          <button className="btn danger" disabled={!a.abort} onClick={() => ctrl.abort()} data-testid="abort">Abortar</button>
          {snap.state === 'flight' && <button className="btn danger small" onClick={() => ctrl.abort('flight-termination')} data-testid="terminate">Terminação de voo</button>}
          <button className="btn" disabled={!a.scrub} onClick={() => ctrl.scrub()} data-testid="scrub">Scrub</button>
          <button className="btn" disabled={!a.pause} onClick={() => { ctrl.togglePause(); setPaused((p) => !p); }}>{paused ? 'Retomar' : 'Pausar'}</button>
          <span className="small muted" style={{ marginLeft: 8 }}>Tempo:</span>
          {[1, 5, 10, 20].map((w) => <button key={w} className={`btn small ${snap.timeWarp === w ? 'amber' : ''}`} onClick={() => ctrl.setTimeWarp(w)} data-testid={`warp-${w}`}>{w}×</button>)}
          <span className="small muted" style={{ marginLeft: 8 }}>Câmera:</span>
          {PAD_CAMERAS.map((c) => <button key={c} className={`btn small ${camera === c ? 'amber' : ''}`} onClick={() => pickCamera(c)} data-testid={`camera-${c}`} title={CAMERA_HINT[c]}>{CAMERA_LABEL[c]}</button>)}
          <button className="btn small" onClick={() => pad?.zoom(1.4)} data-testid="zoom-in" title="Aproximar (também pela roda do mouse)" aria-label="Aproximar">+</button>
          <button className="btn small" onClick={() => pad?.zoom(1 / 1.4)} data-testid="zoom-out" title="Afastar (também pela roda do mouse)" aria-label="Afastar">−</button>
          <span className="spacer" />
          {snap.state === 'orbit' && pad?.hasSolarArrays && !arraysDeployed && <button className="btn amber" onClick={deployArrays} data-testid="deploy-arrays" title="Abre os painéis dobrados dentro da coifa; a câmera de rastreio enquadra a sonda">Estender painéis solares</button>}
          {snap.state === 'scrubbed' && <button className="btn amber" onClick={newWindow} data-testid="new-window">Nova janela</button>}
          {final && snap.state !== 'scrubbed' && <button className="btn primary" onClick={finish} data-testid="launch-continue">{snap.state === 'orbit' ? 'Separação: operar a sonda →' : 'Ver relatório →'}</button>}
          {snap.state === 'scrubbed' && <button className="btn" onClick={finish}>Encerrar campanha</button>}
        </div>
      </div>
    </>
  );
}
