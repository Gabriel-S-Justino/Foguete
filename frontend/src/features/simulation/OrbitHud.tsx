import { useEffect, useState, type ReactNode } from 'react';
import type { OrbitFocus, OrbitInfo, OrbitSceneController, ScaleMode } from '../../engine/scenes/otherScenes';

const AU = 149597870700;

/** Distância legível: m, km ou UA. */
export function fmtDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1e4) return `${m.toFixed(0)} m`;
  if (m < 0.05 * AU) return `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km`;
  return `${(m / AU).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} UA`;
}

export function fmtWarp(w: number): string {
  if (w <= 0) return 'pausado';
  if (w < 10) return `×${w.toFixed(1)}`;
  return `×${Math.round(w).toLocaleString('pt-BR')}`;
}

const FOCUS: { id: OrbitFocus; label: string; title: string }[] = [
  { id: 'system', label: 'Sistema Solar', title: 'Sol e os oito planetas (enquadramento automático)' },
  { id: 'trajectory', label: 'Trajetória', title: 'Trecho atual da trajetória em torno do corpo central' },
  { id: 'destination', label: 'Destino', title: 'Foco no corpo de destino' },
  { id: 'probe', label: 'Sonda', title: 'Vista aproximada da sonda (modelo 3D em tamanho real)' },
];

/** Controles de foco e escala da cena orbital, com as informações do que está na tela. */
export function OrbitHud({ ctrl, children, initialFocus = 'trajectory' }: { ctrl: OrbitSceneController | null; children?: ReactNode; initialFocus?: OrbitFocus }) {
  const [info, setInfo] = useState<OrbitInfo | null>(null);
  const [focus, setFocus] = useState<OrbitFocus>(initialFocus);
  const [scale, setScale] = useState<ScaleMode>('physical');
  useEffect(() => {
    if (!ctrl) return;
    const id = setInterval(() => setInfo(ctrl.info()), 250);
    return () => clearInterval(id);
  }, [ctrl]);
  useEffect(() => { ctrl?.setScale(scale); }, [ctrl, scale]);
  const pick = (f: OrbitFocus) => { setFocus(f); ctrl?.setFocus(f); setInfo((i) => (i ? { ...i, focus: f } : i)); };
  // O foco também pode mudar pela cena (ex.: abertura dos painéis leva à vista da sonda)
  const shown = info?.focus ?? focus;

  return (
    <div className="panel orbit-hud" data-testid="orbit-hud">
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {FOCUS.map((f) => (
          <button key={f.id} className={`btn small ${shown === f.id ? 'amber' : ''}`} onClick={() => pick(f.id)} title={f.title} data-testid={`view-${f.id}`}>{f.label}</button>
        ))}
        <span className="spacer" />
        <button className={`btn small ${scale === 'physical' ? 'primary' : ''}`} onClick={() => setScale('physical')} data-testid="scale-physical" title="Raios e distâncias reais; marcadores na tela indicam corpos pequenos demais para aparecer">Escala física</button>
        <button className={`btn small ${scale === 'didactic' ? 'primary' : ''}`} onClick={() => setScale('didactic')} data-testid="scale-didactic" title="Corpos ampliados para ficarem visíveis; distâncias e trajetória continuam reais">Visualização didática</button>
      </div>
      {info && (
        <div className="small" style={{ marginTop: 6, lineHeight: 1.5 }} data-testid="orbit-info">
          <div>
            <b>{info.focusName}</b> · câmera a {fmtDistance(info.cameraDistanceM)} do foco ·{' '}
            {info.scale === 'physical'
              ? <span data-testid="scale-note">escala física (tamanhos e distâncias reais)</span>
              : <span data-testid="scale-note" style={{ color: 'var(--amber)' }}>visualização didática: corpos ampliados ({info.enlarged.length ? info.enlarged.slice(0, 4).map((e) => `${e.name} ×${e.factor >= 100 ? Math.round(e.factor / 10) * 10 : Math.round(e.factor)}`).join(', ') : 'nenhum no momento'}); distâncias reais</span>}
          </div>
          {info.segmentLabel && (
            <div className="muted">
              Sonda: {info.segmentLabel} · altitude {fmtDistance(info.altitudeM)} sobre {info.centerName === 'Sol' ? 'a fotosfera do Sol' : `a superfície (${info.centerName})`} · {fmtDistance(info.distanceM)} do centro · {(info.speedMS / 1000).toFixed(2)} km/s
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
