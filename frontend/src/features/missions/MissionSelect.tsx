import { useState } from 'react';
import { createStartScene } from '../../engine/scenes/otherScenes';
import { useScene } from '../../components/useScene';
import { Panel, SourceRef } from '../../components/ui';
import { missions, simulationConfig } from '../../engine/catalog';
import { formatBRL, formatUSD, brlNotice } from '../../engine/rules/budget';
import { useCampaign } from '../../store/campaignStore';
import type { AssistanceLevel, MissionId } from '../../types/catalog';

export function MissionSelect() {
  useScene('start', createStartScene);
  const campaign = useCampaign((s) => s.campaign)!;
  const select = useCampaign((s) => s.selectMission);
  const [selected, setSelected] = useState<MissionId>(campaign.missionId ?? 'leo-climate');
  const [assist, setAssist] = useState<AssistanceLevel>(campaign.assistance);
  const m = missions.missions.find((x) => x.id === selected)!;
  return (
    <div className="center-panel">
      <Panel title={`Seleção de missão — Diretor(a) ${campaign.playerName}`} bodyClass="" className="">
        <div className="mission-grid" role="radiogroup" aria-label="Missões">
          {missions.missions.map((x) => (
            <div key={x.id} role="radio" aria-checked={x.id === selected} tabIndex={0} data-testid={`mission-${x.id}`}
              className={`mission-card ${x.id === selected ? 'selected' : ''}`} onClick={() => setSelected(x.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(x.id)}>
              <div className="code">{x.code} · {x.difficulty.toUpperCase()}</div>
              <h3>{x.name}</h3>
              <div className="small muted">{x.summary}</div>
              <div className="mono small">Orçamento: {formatUSD(x.budget.availableUSD)} <span className="muted">({formatBRL(x.budget.availableUSD)})</span></div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 14 }}>
          <div>
            <h3>{m.name}</h3>
            <p className="small" style={{ lineHeight: 1.5 }}>{m.description}</p>
            <h3 style={{ marginTop: 10 }}>Contexto científico</h3>
            <ul className="small" style={{ lineHeight: 1.5, paddingLeft: 18 }}>{m.scienceContext.map((t) => <li key={t}>{t}</li>)}</ul>
            <h3>Objetivos</h3>
            <ul className="small" style={{ paddingLeft: 18 }}>{m.objectives.map((o) => <li key={o.id}>{o.title} {o.primary ? <span className="chip warn">primário</span> : null} <span className="muted">peso {Math.round(o.weight * 100)}%</span></li>)}</ul>
          </div>
          <div>
            <h3>Orçamento de jogo</h3>
            <dl className="kv">
              <dt>Disponível</dt><dd>{formatUSD(m.budget.availableUSD)}</dd>
              <dt>Reserva de contingência</dt><dd>{m.budget.contingencyPct}%</dd>
              <dt>Operações</dt><dd>{formatUSD(m.budget.operationsCostUSD)}</dd>
            </dl>
            <p className="small muted">{missions.budgetNotice} {brlNotice}</p>
            <h3>Nível de assistência</h3>
            <div className="row">
              {(Object.keys(simulationConfig.assistance) as AssistanceLevel[]).map((a) => (
                <button key={a} className={`btn small ${assist === a ? 'amber' : ''}`} onClick={() => setAssist(a)} data-testid={`assist-${a}`}>{simulationConfig.assistance[a].label}</button>
              ))}
            </div>
            <p className="small muted">Margem mínima de carga útil: {simulationConfig.assistance[assist].payloadMarginPct}% · margem de Δv: {m.deltaVPolicy.marginPct[assist]}%. A física é a mesma em todos os níveis.</p>
            <h3>Limitações do modelo</h3>
            <ul className="small muted" style={{ paddingLeft: 18 }}>{m.knownLimitations.map((t) => <li key={t}>{t}</li>)}</ul>
            <div className="small">{m.sources.map((s) => <div key={s}><SourceRef id={s} /></div>)}</div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="spacer" />
          <button className="btn primary" data-testid="confirm-mission" onClick={() => select(selected, assist)}>Abrir hangar de montagem</button>
        </div>
      </Panel>
    </div>
  );
}
