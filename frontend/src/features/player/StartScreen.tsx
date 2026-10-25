import { type FormEvent, useState } from 'react';
import { createStartScene } from '../../engine/scenes/otherScenes';
import { useScene } from '../../components/useScene';
import { PLAYER_NAME_MAX, useCampaign, validatePlayerName } from '../../store/campaignStore';

export function StartScreen() {
  useScene('start', createStartScene);
  const identify = useCampaign((s) => s.identify);
  const existing = useCampaign((s) => s.campaign);
  const goTo = useCampaign((s) => s.goTo);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validatePlayerName(name);
    if (!v.ok) { setError(v.error); return; }
    setBusy(true);
    const r = await identify(v.value);
    setBusy(false);
    if (!r.ok) setError(r.reason);
  }

  return (
    <div style={{ position: 'absolute', left: 'clamp(16px, 7vw, 120px)', top: '50%', transform: 'translateY(-50%)', maxWidth: 520 }}>
      <h1 className="logo">Space Mission<span>Architect</span></h1>
      <p className="muted" style={{ maxWidth: 440, lineHeight: 1.5 }}>Simulador educacional de planejamento, montagem, lançamento e operação de missões espaciais robóticas, com física orbital e dados técnicos rastreáveis.</p>
      <form onSubmit={submit} className="panel" style={{ padding: 16, marginTop: 18 }} aria-label="Identificação do jogador">
        <label htmlFor="player-name" className="small muted">Nome do diretor de missão</label>
        <div className="row" style={{ marginTop: 6, flexWrap: 'nowrap' }}>
          <input id="player-name" data-testid="player-name" className="input" value={name} maxLength={PLAYER_NAME_MAX + 8} autoComplete="nickname"
            onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Ex.: Neil Armstrong" />
          <button className="btn primary" type="submit" disabled={busy} data-testid="start-button">{busy ? 'Registrando…' : 'Iniciar'}</button>
        </div>
        {error && <p role="alert" className="small" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
        <p className="small muted" style={{ margin: '10px 0 0' }}>Não é necessário criar conta. Apenas o nome é registrado, associado a um identificador de sessão.</p>
      </form>
      {existing && existing.stage !== 'identification' && (
        <button className="btn" style={{ marginTop: 10 }} onClick={() => goTo(existing.stage)}>Continuar campanha de {existing.playerName}</button>
      )}
      <p className="small muted" style={{ marginTop: 14, opacity: 0.7, fontSize: 11 }}>
        Imagens planetárias: NASA (Blue Marble, Black Marble, SVS CGI Moon Kit) e Solar System Scope (
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>CC BY 4.0</a>).
        {' '}Modelo da sonda Juno: <a href="https://github.com/nasa/NASA-3D-Resources" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>NASA 3D Resources</a>.
      </p>
    </div>
  );
}
