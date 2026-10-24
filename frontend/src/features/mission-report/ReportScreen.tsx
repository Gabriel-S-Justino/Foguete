import { useEffect } from 'react';
import { useScene } from '../../components/useScene';
import { fmtKg, Panel } from '../../components/ui';
import { formatBRL, formatUSD } from '../../engine/rules/budget';
import { createStartScene } from '../../engine/scenes/otherScenes';
import { useCampaign } from '../../store/campaignStore';

const CLASS_COLOR: Record<string, string> = { sucesso: 'var(--green)', parcial: 'var(--amber)', limitada: 'var(--amber)', abortada: 'var(--steel-300)', fracassada: 'var(--red)' };

export function ReportScreen() {
  useScene('start', createStartScene);
  const campaign = useCampaign((s) => s.campaign)!;
  const history = useCampaign((s) => s.history);
  const finishMission = useCampaign((s) => s.finishMission);
  const newAttempt = useCampaign((s) => s.newAttempt);
  const goTo = useCampaign((s) => s.goTo);
  const resetAll = useCampaign((s) => s.resetAll);
  const r = campaign.report;
  useEffect(() => { if (!r) void finishMission(); }, [r, finishMission]);
  if (!r) return <div className="center-panel"><Panel title="Relatório"><p>Gerando relatório…</p></Panel></div>;

  return (
    <div className="center-panel" style={{ width: 'min(1100px, calc(100vw - 28px))' }}>
      <Panel title={`Relatório final — ${r.missionName}`} actions={<span className="chip" style={{ color: CLASS_COLOR[r.classification], borderColor: CLASS_COLOR[r.classification] }} data-testid="classification">{r.classification}</span>}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div>
            <h3 style={{ color: CLASS_COLOR[r.classification] }}>{r.classificationLabel}</h3>
            <dl className="kv">
              <dt>Diretor(a)</dt><dd>{r.playerName}</dd>
              <dt>Tentativa</dt><dd>{campaign.attempt}</dd>
              <dt>Lançador</dt><dd>{r.vehicleName}</dd>
              <dt>Orçamento</dt><dd>{formatUSD(r.budgetUSD)}</dd>
              <dt>Custo final</dt><dd>{formatUSD(r.finalCostUSD)}</dd>
              <dt>Em reais (didático)</dt><dd>{formatBRL(r.finalCostUSD)}</dd>
              <dt>Lançamento</dt><dd>{r.launchResult}</dd>
              <dt>Trajetória</dt><dd>{r.trajectoryResult}</dd>
              <dt>Dados coletados</dt><dd>{r.dataCollectedGb.toFixed(0)} GB</dd>
              <dt>Dados enviados</dt><dd>{r.dataReturnedGb.toFixed(0)} GB</dd>
              <dt>Propelente restante</dt><dd>{fmtKg(r.remainingPropellantKg)}</dd>
              <dt>Pontuação científica</dt><dd data-testid="science-score">{r.scienceScore.toFixed(0)} / 100</dd>
              <dt>Pontuação final</dt><dd>{r.finalScore.toFixed(0)} / 100</dd>
            </dl>
          </div>
          <div>
            <h3>Objetivos</h3>
            <table className="checks"><tbody>{r.objectives.map((o) => <tr key={o.id}><td>{o.title}{o.primary && <span className="chip warn" style={{ marginLeft: 4 }}>primário</span>}</td><td className="mono">{o.score.toFixed(0)}%</td></tr>)}</tbody></table>
            <h3 style={{ marginTop: 10 }}>Eventos críticos</h3>
            <ul className="small" style={{ paddingLeft: 18 }}>{r.criticalEvents.length ? r.criticalEvents.map((e, i) => <li key={i}>{e.label}</li>) : <li>Nenhum</li>}</ul>
            {r.failures.length > 0 && <><h3>Falhas</h3><ul className="small" style={{ paddingLeft: 18 }}>{r.failures.map((f) => <li key={f}>{f}</li>)}</ul></>}
          </div>
          <div>
            <h3>O que aprendemos</h3>
            <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.5 }}>{r.educational.map((t) => <li key={t}>{t}</li>)}</ul>
            <h3>Recomendações</h3>
            <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.5 }}>{r.recommendations.map((t) => <li key={t}>{t}</li>)}</ul>
            <h3>Componentes</h3>
            <p className="small muted">{r.components.join(', ')}</p>
          </div>
        </div>
        {history.length > 1 && (
          <>
            <h3 style={{ marginTop: 12 }}>Histórico de tentativas</h3>
            <table className="checks">
              <thead><tr><th>Tentativa</th><th>Missão</th><th>Classificação</th><th>Ciência</th><th>Custo</th></tr></thead>
              <tbody>{history.slice().reverse().map((h, i) => <tr key={i}><td className="mono">{h.attempt}</td><td>{h.missionName}</td><td>{h.classification}</td><td className="mono">{h.scienceScore.toFixed(0)}</td><td className="mono">{formatUSD(h.finalCostUSD)}</td></tr>)}</tbody>
            </table>
          </>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={newAttempt} data-testid="new-attempt">Nova tentativa (mesma missão)</button>
          <button className="btn" onClick={() => goTo('mission-select')}>Outra missão</button>
          <span className="spacer" />
          <button className="btn danger small" onClick={() => { if (confirm('Encerrar a sessão e apagar o progresso local?')) resetAll(); }}>Encerrar sessão</button>
        </div>
      </Panel>
    </div>
  );
}
