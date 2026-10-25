import { useEffect, useMemo, useState } from 'react';
import { useScene } from '../../components/useScene';
import { fmtKg, fmtW, SourceRef, Stat, StatusChip } from '../../components/ui';
import { getComponent, getMission, missions, simulationConfig } from '../../engine/catalog';
import { allComponents, analyzeSpacecraft, canInstall, componentRelevance } from '../../engine/entities/spacecraft';
import { NASA_MODELS, REFERENCE_SPACECRAFT } from '../../engine/entities/nasaModels';
import { formatUSD } from '../../engine/rules/budget';
import { REFERENCE_ARCHITECTURES } from '../../engine/rules/presets';
import { validateMission } from '../../engine/rules/validation';
import { createProbeHangarScene } from '../../engine/scenes/probeHangarScene';
import { useCampaign } from '../../store/campaignStore';
import type { ComponentCategory, ComponentSpec, TestCampaignId } from '../../types/catalog';

const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  estrutura: 'Estrutura', 'carga-util': 'Carga útil', energia: 'Energia', atitude: 'Atitude', propulsao: 'Propulsão',
  computacao: 'Computação', comunicacao: 'Comunicação', navegacao: 'Navegação', termico: 'Térmico', protecao: 'Proteção',
};

type SortKey = 'relevancia' | 'massa' | 'custo' | 'energia' | 'nome';

export function HangarScreen() {
  const ctrl = useScene('probe-hangar', createProbeHangarScene);
  const campaign = useCampaign((s) => s.campaign)!;
  const install = useCampaign((s) => s.installComponent);
  const remove = useCampaign((s) => s.removeComponent);
  const setPropellant = useCampaign((s) => s.setPropellant);
  const setTest = useCampaign((s) => s.setTestCampaign);
  const applySuggestion = useCampaign((s) => s.applySuggestion);
  const goTo = useCampaign((s) => s.goTo);
  const mission = getMission(campaign.missionId!);
  const assist = simulationConfig.assistance[campaign.assistance];

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ComponentCategory | 'todas'>('todas');
  const [onlyRelevant, setOnlyRelevant] = useState(false);
  const [sort, setSort] = useState<SortKey>('relevancia');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arms, setArms] = useState<string[]>([]);
  const [refView, setRefView] = useState(false);
  const reference = NASA_MODELS[REFERENCE_SPACECRAFT[campaign.missionId!]];
  const view = (v: 'overview' | 'inspect' | 'reference') => { setRefView(v === 'reference'); ctrl?.setView(v); };

  const summary = useMemo(() => analyzeSpacecraft(campaign.spacecraft, mission, campaign.plan), [campaign.spacecraft, mission, campaign.plan]);
  const validation = useMemo(() => (campaign.plan
    ? validateMission({ mission, config: campaign.spacecraft, vehicleId: campaign.vehicleId, plan: campaign.plan, assistance: campaign.assistance })
    : null), [campaign.spacecraft, campaign.vehicleId, campaign.plan, campaign.assistance, mission]);

  // Sincroniza o modelo 3D com a configuração lógica (fonte única: campaign.spacecraft)
  useEffect(() => { ctrl?.sync(campaign.spacecraft.installed); }, [ctrl, campaign.spacecraft.installed]);
  // Nave real equivalente à missão, exposta no hangar (modelo do NASA 3D Resources)
  useEffect(() => {
    ctrl?.showReference(campaign.missionId!);
    if (ctrl && navigator.webdriver) (globalThis as Record<string, unknown>).__probeHangar = ctrl;
  }, [ctrl, campaign.missionId]);
  useEffect(() => { ctrl?.highlight(selectedId); }, [ctrl, selectedId]);
  useEffect(() => { ctrl?.onPick((componentId) => setSelectedId(componentId)); }, [ctrl]);
  useEffect(() => {
    if (!ctrl) return;
    const t = setInterval(() => setArms(ctrl.armStatus()), 400);
    return () => clearInterval(t);
  }, [ctrl]);

  const rank = { essencial: 0, útil: 1, irrelevante: 2 } as const;
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = allComponents
      .map((c) => ({ c, rel: componentRelevance(c, mission) }))
      .filter(({ c, rel }) => (category === 'todas' || c.category === category)
        && (!q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
        && (!onlyRelevant || rel.level !== 'irrelevante'));
    const cmp: Record<SortKey, (a: typeof items[number], b: typeof items[number]) => number> = {
      relevancia: (a, b) => rank[a.rel.level] - rank[b.rel.level] || a.c.name.localeCompare(b.c.name),
      massa: (a, b) => a.c.massKg - b.c.massKg,
      custo: (a, b) => a.c.costUSD - b.c.costUSD,
      energia: (a, b) => a.c.powerW - b.c.powerW,
      nome: (a, b) => a.c.name.localeCompare(b.c.name),
    };
    return items.sort(cmp[sort]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, onlyRelevant, sort, mission]);

  const selected: ComponentSpec | null = selectedId ? getComponent(selectedId) : null;
  const installedOfSelected = selected ? campaign.spacecraft.installed.filter((i) => i.componentId === selected.id) : [];
  const installCheck = selected ? canInstall(campaign.spacecraft, selected.id) : null;
  const budget = validation?.context.budget;
  const refVehicle = REFERENCE_ARCHITECTURES[mission.id].vehicleId;
  const massGuide = mission.massGuidelineKg;
  const missingReqs = mission.requirements.filter((r) => r.severity === 'obrigatoria' && !r.anyOf.some((c) => summary.capabilities.has(c)));

  return (
    <>
      <aside className="side-left panel" aria-label="Catálogo de componentes">
        <div className="panel-title"><h2>Catálogo</h2><span className="small muted">{list.length} itens</span></div>
        <div style={{ padding: '8px 12px', display: 'grid', gap: 6 }}>
          <input className="input" placeholder="Buscar componente…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="catalog-search" aria-label="Buscar" />
          <div className="row">
            <select className="input" style={{ flex: 1 }} value={category} onChange={(e) => setCategory(e.target.value as ComponentCategory | 'todas')} aria-label="Categoria">
              <option value="todas">Todas as categorias</option>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input" style={{ flex: 1 }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar">
              <option value="relevancia">Relevância</option><option value="massa">Massa</option><option value="custo">Custo</option><option value="energia">Consumo</option><option value="nome">Nome</option>
            </select>
          </div>
          <label className="small row"><input type="checkbox" checked={onlyRelevant} onChange={(e) => setOnlyRelevant(e.target.checked)} /> Ocultar irrelevantes para a missão</label>
        </div>
        <ul className="list panel-body" style={{ flex: 1, padding: 0 }}>
          {list.map(({ c, rel }) => {
            const n = campaign.spacecraft.installed.filter((i) => i.componentId === c.id).length;
            return (
              <li key={c.id} className={`catalog-item ${selectedId === c.id ? 'selected' : ''} ${n ? 'installed' : ''}`} onClick={() => setSelectedId(c.id)} data-testid={`comp-${c.id}`}>
                <div className="thumb">{CATEGORY_LABEL[c.category].slice(0, 4).toUpperCase()}</div>
                <div>
                  <div className="name">{c.name}{n > 1 ? ` ×${n}` : ''}</div>
                  <div className="meta">{fmtKg(c.massKg)} · {formatUSD(c.costUSD)} · {fmtW(c.powerW)}</div>
                  {(assist.suggestComponents || rel.level !== 'útil') && (
                    <div className="why" style={{ color: rel.level === 'essencial' ? 'var(--green)' : rel.level === 'irrelevante' ? 'var(--steel-400)' : undefined }}>{rel.level}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      <aside className="side-right panel" aria-label="Detalhes">
        <div className="panel-title">
          <h2>{selected ? 'Componente' : 'Sonda'}</h2>
          <div className="row">
            <button className="btn small" onClick={() => view('overview')}>Visão geral</button>
            <button className="btn small" onClick={() => view('inspect')}>Inspecionar</button>
            <button className={`btn small ${refView ? 'amber' : ''}`} onClick={() => view('reference')} data-testid="view-reference" title="Nave real da NASA equivalente a esta missão, exposta no hangar">Nave real</button>
          </div>
        </div>
        <div className="panel-body" style={{ flex: 1 }}>
          {refView && (
            <div className="small" style={{ marginBottom: 10, lineHeight: 1.5 }} data-testid="reference-info">
              <h3>Referência real: {reference.title}</h3>
              <p className="muted">{reference.note} Modelo 3D do <a href={reference.source} target="_blank" rel="noreferrer">NASA 3D Resources</a>, exposto em escala de exposição (não é a sua sonda).</p>
            </div>
          )}
          {selected ? (
            <>
              <h3>{selected.name}</h3>
              <div className="row" style={{ marginBottom: 6 }}><span className="chip">{CATEGORY_LABEL[selected.category]}</span><StatusChip status="didático" /><span className="chip info">{componentRelevance(selected, mission).level}</span></div>
              <p className="small" style={{ lineHeight: 1.5 }}>{selected.description}</p>
              <p className="small" style={{ lineHeight: 1.5 }}><b>Para esta missão:</b> {componentRelevance(selected, mission).text}</p>
              <dl className="kv">
                <dt>Massa</dt><dd>{fmtKg(selected.massKg)}</dd>
                <dt>Custo</dt><dd>{formatUSD(selected.costUSD)}</dd>
                <dt>Consumo</dt><dd>{fmtW(selected.powerW)}</dd>
                <dt>Dimensões</dt><dd>{selected.dimensionsM.map((d) => d.toFixed(2)).join(' × ')} m</dd>
                {selected.radiationToleranceKrad !== undefined && <><dt>Tolerância à radiação</dt><dd>{selected.radiationToleranceKrad} krad</dd></>}
                {selected.effects.science && <><dt>Dados</dt><dd>{selected.effects.science.dataGbPerDay} GB/dia</dd></>}
                {selected.effects.propulsion && <><dt>Isp / empuxo</dt><dd>{selected.effects.propulsion.ispS} s / {selected.effects.propulsion.thrustN} N</dd></>}
                {selected.effects.tankCapacityKg !== undefined && <><dt>Capacidade do tanque</dt><dd>{fmtKg(selected.effects.tankCapacityKg)}</dd></>}
                {selected.effects.comm && <><dt>Enlace de referência</dt><dd>{selected.effects.comm.rateMbps} Mbps @ {selected.effects.comm.refRangeKm.toLocaleString('pt-BR')} km</dd></>}
              </dl>
              <p className="small muted" style={{ lineHeight: 1.45 }}><b>Limitações:</b> {selected.limitations}</p>
              <p className="small muted" style={{ lineHeight: 1.45 }}><b>Se faltar:</b> {selected.absenceConsequence}</p>
              {selected.requires.map((r) => <p key={r.reason} className="small" style={{ color: r.anyOf.some((x) => summary.capabilities.has(x)) ? 'var(--green)' : 'var(--amber)' }}>Requer: {r.reason}</p>)}
              <p className="small muted">Linha de origem: {selected.documentRow}</p>
              <SourceRef id="doc-componentes" />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn primary" disabled={!installCheck?.ok} title={installCheck?.reason} onClick={() => install(selected.id)} data-testid="install-btn">Instalar</button>
                {installedOfSelected.length > 0 && <button className="btn danger" onClick={() => remove(installedOfSelected[installedOfSelected.length - 1]!.instanceId)} data-testid="remove-btn">Remover</button>}
                <button className="btn small" onClick={() => setSelectedId(null)}>Fechar</button>
              </div>
              {installCheck && !installCheck.ok && <p className="small" style={{ color: 'var(--amber)' }}>{installCheck.reason}</p>}
            </>
          ) : (
            <>
              <h3>{mission.name}</h3>
              <p className="small muted">Selecione um componente no catálogo ou clique na sonda 3D.</p>
              <h3>Requisitos obrigatórios</h3>
              <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.5 }}>
                {mission.requirements.map((r) => {
                  const ok = r.anyOf.some((c) => summary.capabilities.has(c));
                  return <li key={r.id} style={{ color: ok ? 'var(--green)' : r.severity === 'obrigatoria' ? 'var(--red)' : 'var(--amber)' }}>{ok ? '✓' : '✗'} {r.reason}</li>;
                })}
              </ul>
              <h3>Instalados ({campaign.spacecraft.installed.length})</h3>
              <ul className="small" style={{ paddingLeft: 18 }} data-testid="installed-list">
                {campaign.spacecraft.installed.map((i) => <li key={i.instanceId}><a href="#" onClick={(e) => { e.preventDefault(); setSelectedId(i.componentId); }}>{getComponent(i.componentId).name}</a></li>)}
              </ul>
              <h3>Propelente da sonda</h3>
              <div className="row">
                <input type="range" min={0} max={Math.max(0, summary.tankCapacityKg)} step={5} value={Math.min(campaign.spacecraft.propellantKg, summary.tankCapacityKg)} onChange={(e) => setPropellant(Number(e.target.value))} style={{ flex: 1 }} aria-label="Propelente" disabled={summary.tankCapacityKg <= 0} data-testid="propellant" />
                <span className="mono small">{fmtKg(campaign.spacecraft.propellantKg)} / {fmtKg(summary.tankCapacityKg)}</span>
              </div>
              {summary.tankCapacityKg <= 0 && <p className="small muted">Instale um tanque para carregar propelente.</p>}
              <h3 style={{ marginTop: 10 }}>Campanha de testes</h3>
              <select className="input" value={campaign.spacecraft.testCampaign} onChange={(e) => setTest(e.target.value as TestCampaignId)} aria-label="Campanha de testes">
                {Object.entries(missions.testCampaigns).map(([k, t]) => <option key={k} value={k}>{t.label} (+{Math.round(t.costFactor * 100)}% do custo dos componentes)</option>)}
              </select>
              <p className="small muted">{missions.testCampaigns[campaign.spacecraft.testCampaign].description}</p>
              {assist.suggestComponents && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn amber" onClick={applySuggestion} data-testid="apply-suggestion">Carregar arquitetura de referência</button>
                  <p className="small muted">Configuração de referência baseada em componentes-sondas.md (lançador sugerido: {refVehicle}). Substitui a montagem atual.</p>
                </div>
              )}
              <h3 style={{ marginTop: 10 }}>Braços robóticos</h3>
              <ul className="small mono" style={{ paddingLeft: 18 }}>{arms.map((a) => <li key={a}>{a}</li>)}</ul>
            </>
          )}
        </div>
      </aside>

      <div className="bottom-bar">
        <Stat label="Massa úmida" value={fmtKg(summary.wetMassKg)} sub={`seca ${fmtKg(summary.dryMassKg)} · guia ${fmtKg(massGuide[0])}–${fmtKg(massGuide[1])}`} meter={summary.structuralLimitKg ? summary.wetMassKg / summary.structuralLimitKg : undefined} testId="stat-mass" />
        <Stat label="Orçamento comprometido" value={budget ? formatUSD(budget.committedUSD) : '—'} sub={budget ? `de ${formatUSD(budget.availableUSD)} (${budget.usedPct.toFixed(0)}%)` : ''} meter={budget ? budget.committedUSD / budget.availableUSD : undefined} testId="stat-budget" />
        <Stat label="Energia" value={`${fmtW(summary.powerGenerationW)} / ${fmtW(summary.powerConsumptionW)}`} sub="geração / consumo" meter={summary.powerGenerationW > 0 ? summary.powerConsumptionW / summary.powerGenerationW : summary.powerConsumptionW > 0 ? 1.1 : 0} />
        <Stat label="Δv da sonda" value={`${summary.deltaVAvailableMS.toFixed(0)} m/s`} sub={validation ? `necessário ${validation.context.profile.requiredDvMS.toFixed(0)} m/s` : ''} meter={validation && summary.deltaVAvailableMS > 0 ? validation.context.profile.requiredDvMS / summary.deltaVAvailableMS : undefined} />
        <Stat label="Dados" value={`${summary.dataGeneratedGbPerDay.toFixed(0)} GB/dia`} sub={`envio ${summary.downlinkGbPerDay.toFixed(1)} GB/dia`} />
        <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, minWidth: 190 }}>
          <span className="small muted">{missingReqs.length ? `${missingReqs.length} requisito(s) obrigatório(s) pendente(s)` : 'Requisitos obrigatórios atendidos'}</span>
          <button className="btn primary" onClick={() => goTo('vehicle')} data-testid="to-vehicle">Escolher lançador →</button>
        </div>
      </div>
    </>
  );
}
