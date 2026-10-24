import { useEffect, useMemo, useState } from 'react';
import { useScene } from '../../components/useScene';
import { Panel, SourceRef, StatusChip } from '../../components/ui';
import { findVehicle, getComponent, getMission } from '../../engine/catalog';
import { createBriefingScene } from '../../engine/scenes/otherScenes';
import { api } from '../../services/api';
import { STAGE_LABEL, useCampaign } from '../../store/campaignStore';
import type { CheckGroup } from '../../types/campaign';

const GROUP_LABEL: Record<CheckGroup, string> = { financeira: 'Financeira', massa: 'Massa', propulsao: 'Propulsão', subsistemas: 'Subsistemas', orbital: 'Orbital' };

export function BriefingScreen() {
  const ctrl = useScene('briefing', createBriefingScene);
  const campaign = useCampaign((s) => s.campaign)!;
  const token = useCampaign((s) => s.session.token);
  const runValidation = useCampaign((s) => s.runValidation);
  const goTo = useCampaign((s) => s.goTo);
  const mission = getMission(campaign.missionId!);
  const vehicle = findVehicle(campaign.vehicleId);
  const [picked, setPicked] = useState<string | null>(null);
  const [server, setServer] = useState<{ state: 'idle' | 'ok' | 'mismatch' | 'offline'; text: string }>({ state: 'idle', text: '' });

  useEffect(() => { if (!campaign.validation) runValidation(); }, [campaign.validation, runValidation]);
  useEffect(() => { ctrl?.setup(campaign.spacecraft.installed, vehicle); }, [ctrl, campaign.spacecraft.installed, vehicle]);
  useEffect(() => { ctrl?.onPick((id) => setPicked(id)); }, [ctrl]);
  useEffect(() => { ctrl?.highlight(picked); }, [ctrl, picked]);

  const v = campaign.validation;
  // Revalidação no servidor: a decisão persistida usa as regras do backend
  useEffect(() => {
    if (!v || !token) { setServer({ state: 'offline', text: 'Servidor indisponível: validação apenas local (o servidor revalida ao finalizar).' }); return; }
    let alive = true;
    api.validate(token, campaign).then((r) => {
      if (!alive) return;
      const same = r.approved === v.approved;
      setServer(same ? { state: 'ok', text: `Servidor confirma: ${r.approved ? 'aprovado' : 'bloqueado'} (${r.blockers.length} bloqueio(s)).` } : { state: 'mismatch', text: 'Divergência entre a validação local e a do servidor: prevalece a decisão do servidor.' });
    }).catch(() => alive && setServer({ state: 'offline', text: 'Servidor indisponível: validação apenas local (o servidor revalida ao finalizar).' }));
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.computedAt, token]);

  const grouped = useMemo(() => {
    const g = new Map<CheckGroup, NonNullable<typeof v>['checks']>();
    for (const c of v?.checks ?? []) g.set(c.group, [...(g.get(c.group) ?? []), c]);
    return g;
  }, [v]);

  if (!v) return null;
  const pickedSpec = picked ? getComponent(picked) : null;
  return (
    <>
      <div className="side-left panel" style={{ width: 'min(760px, calc(100vw - 420px))' }}>
        <div className="panel-title">
          <h2>Briefing e validação — {mission.code}</h2>
          <div className="row">
            <span className={`chip ${v.approved ? 'ok' : 'bad'}`} data-testid="briefing-status">{v.approved ? 'APROVADO PARA LANÇAMENTO' : `${v.blockers.length} BLOQUEIO(S)`}</span>
            <button className="btn small" onClick={runValidation}>Revalidar</button>
          </div>
        </div>
        <div className="panel-body" style={{ flex: 1 }}>
          {[...grouped.entries()].map(([group, checks]) => (
            <div key={group} style={{ marginBottom: 12 }}>
              <h3>{GROUP_LABEL[group]}</h3>
              <table className="checks">
                <thead><tr><th>Verificação</th><th>Valor</th><th>Limite</th><th>Margem</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.id} data-testid={`check-${c.id}`}>
                      <td><b>{c.title}</b><div className="small muted">{c.explanation}</div>{c.action && c.status !== 'aprovada' && <div className="small" style={{ color: 'var(--amber)' }}>{c.action}</div>}{c.sourceId && <SourceRef id={c.sourceId} />}</td>
                      <td className="mono">{c.value}</td>
                      <td className="mono">{c.limit}</td>
                      <td className="mono">{c.margin}</td>
                      <td><StatusChip status={c.status} /></td>
                      <td>{c.fixStage && c.status !== 'aprovada' && <button className="btn small" onClick={() => goTo(c.fixStage!)}>{STAGE_LABEL[c.fixStage]}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="small muted">Motor de regras {v.engineVersion} · calculado em {new Date(v.computedAt).toLocaleString('pt-BR')}</p>
        </div>
      </div>
      <aside className="side-right panel">
        <div className="panel-title">
          <h2>Inspeção 3D</h2>
          <div className="row"><button className="btn small" onClick={() => ctrl?.setView('overview')}>Conjunto</button><button className="btn small" onClick={() => ctrl?.setView('inspect')}>Sonda</button></div>
        </div>
        <div className="panel-body" style={{ flex: 1 }}>
          <dl className="kv">
            <dt>Missão</dt><dd>{mission.name}</dd>
            <dt>Lançador</dt><dd>{vehicle?.name ?? '—'}</dd>
            <dt>Componentes</dt><dd>{campaign.spacecraft.installed.length}</dd>
            <dt>Testes</dt><dd>{campaign.spacecraft.testCampaign}</dd>
          </dl>
          <p className="small muted">Clique em um componente da sonda para destacá-lo.</p>
          {pickedSpec && <Panel title={pickedSpec.name}><p className="small">{pickedSpec.description}</p><p className="small muted">{pickedSpec.limitations}</p></Panel>}
          {server.text && <p className="small" style={{ color: server.state === 'ok' ? 'var(--green)' : server.state === 'mismatch' ? 'var(--red)' : 'var(--steel-400)' }} data-testid="server-validation">{server.text}</p>}
          {v.warnings.length > 0 && <p className="small" style={{ color: 'var(--amber)' }}>{v.warnings.length} aviso(s) não bloqueiam o lançamento, mas aumentam o risco ou reduzem a ciência.</p>}
          <p className="small muted">Orçamento comprometido: {v.checks.find((c) => c.id === 'budget-total')?.value ?? '—'}</p>
        </div>
      </aside>
      <div className="bottom-bar">
        <div className="panel" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
          <span className="small">{v.approved ? 'Todas as verificações obrigatórias foram aprovadas.' : 'O lançamento está bloqueado até que todas as verificações obrigatórias sejam aprovadas.'}</span>
          <span className="spacer" />
          <button className="btn" onClick={() => goTo('planning')}>← Trajetória</button>
          <button className="btn primary" disabled={!v.approved || server.state === 'mismatch'} onClick={() => goTo('launch-pad')} data-testid="to-launch">Seguir para a plataforma →</button>
        </div>
      </div>
    </>
  );
}
