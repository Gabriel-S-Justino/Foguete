import { Component, type ReactNode, useEffect, useRef, useState } from 'react';
import { sceneManager, type EngineStatus } from '../engine/core/SceneManager';
import { canEnter, STAGE_LABEL, STAGE_ORDER, useCampaign } from '../store/campaignStore';
import { StartScreen } from '../features/player/StartScreen';
import { MissionSelect } from '../features/missions/MissionSelect';
import { HangarScreen } from '../features/spacecraft/HangarScreen';
import { VehicleScreen } from '../features/launch-vehicles/VehicleScreen';
import { PlanningScreen } from '../features/mission-planning/PlanningScreen';
import { BriefingScreen } from '../features/mission-planning/BriefingScreen';
import { LaunchScreen } from '../features/launch-control/LaunchScreen';
import { OperationsScreen } from '../features/simulation/OperationsScreen';
import { ReportScreen } from '../features/mission-report/ReportScreen';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="overlay-center">
        <div className="panel" style={{ padding: 20, maxWidth: 520 }}>
          <h2>Falha na interface</h2>
          <p className="small">{this.state.error.message}</p>
          <p className="small muted">O progresso está salvo. Recarregue a página para continuar da última etapa válida.</p>
          <button className="btn primary" onClick={() => location.reload()}>Recarregar</button>
        </div>
      </div>
    );
  }
}

function TopBar() {
  const campaign = useCampaign((s) => s.campaign);
  const backend = useCampaign((s) => s.backend);
  const goTo = useCampaign((s) => s.goTo);
  if (!campaign) return null;
  const currentIdx = STAGE_ORDER.indexOf(campaign.stage);
  return (
    <header className="topbar">
      <div className="brand">Space Mission <span>Architect</span></div>
      <nav className="stages" aria-label="Etapas da campanha">
        {STAGE_ORDER.slice(1).map((s, i) => {
          const gate = canEnter(campaign, s);
          const idx = STAGE_ORDER.indexOf(s);
          return (
            <button key={s} className={`stage ${s === campaign.stage ? 'current' : idx < currentIdx ? 'done' : ''}`} disabled={!gate.ok} title={gate.reason || STAGE_LABEL[s]} onClick={() => goTo(s)}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>{STAGE_LABEL[s]}
            </button>
          );
        })}
      </nav>
      <div className="sync" title={backend.lastSync ?? ''}><span className={`dot ${backend.online ? 'on' : ''}`} />{backend.message}</div>
    </header>
  );
}

function Screen() {
  const stage = useCampaign((s) => s.campaign?.stage ?? 'identification');
  const hasCampaign = useCampaign((s) => Boolean(s.campaign));
  if (!hasCampaign) return <StartScreen />;
  switch (stage) {
    case 'identification': return <StartScreen />;
    case 'mission-select': return <MissionSelect />;
    case 'hangar': return <HangarScreen />;
    case 'vehicle': return <VehicleScreen />;
    case 'planning': return <PlanningScreen />;
    case 'briefing': return <BriefingScreen />;
    case 'launch-pad': return <LaunchScreen />;
    case 'flight': case 'science': return <OperationsScreen />;
    case 'report': return <ReportScreen />;
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<EngineStatus>(sceneManager.status);
  const notice = useCampaign((s) => s.notice);
  const dismiss = useCampaign((s) => s.dismissNotice);
  useEffect(() => {
    if (canvasRef.current) sceneManager.attach(canvasRef.current);
    const unsub = sceneManager.subscribe(setStatus);
    return () => { unsub(); };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, 6000);
    return () => clearTimeout(t);
  }, [notice, dismiss]);
  return (
    <ErrorBoundary>
      <canvas ref={canvasRef} className="render-canvas" data-testid="render-canvas" />
      {status.loading && <div className="loading-bar" role="progressbar" aria-label="Carregando cena" />}
      <div className="app-shell">
        <TopBar />
        <main className="workspace">
          {notice && <div className="panel notice" role="alert"><span>{notice}</span><button className="btn small" onClick={dismiss}>OK</button></div>}
          <Screen />
          {status.degraded && <div className="panel small" style={{ position: 'absolute', right: 14, bottom: 80, padding: '4px 8px' }}>Qualidade gráfica reduzida para manter a taxa de quadros ({Math.round(status.fps)} FPS)</div>}
        </main>
      </div>
      {!status.webgl2 && (
        <div className="overlay-center">
          <div className="panel" style={{ padding: 20, maxWidth: 560 }}>
            <h2>WebGL 2 indisponível</h2>
            <p className="small">O Space Mission Architect renderiza o ambiente 3D com Babylon.js e exige WebGL 2. Ative a aceleração por hardware ou use uma versão recente do Chrome, Edge ou Firefox.</p>
          </div>
        </div>
      )}
      {status.contextLost && (
        <div className="overlay-center"><div className="panel" style={{ padding: 20 }}>Contexto gráfico perdido — recuperando…</div></div>
      )}
    </ErrorBoundary>
  );
}
