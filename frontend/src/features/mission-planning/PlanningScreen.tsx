import { useEffect, useMemo } from 'react';
import { useScene } from '../../components/useScene';
import { fmtMs, SourceRef, Stat, StatusChip } from '../../components/ui';
import { getMission, simulationConfig } from '../../engine/catalog';
import { sunSynchronousInclination } from '../../engine/orbital-mechanics/orbits';
import { validateMission } from '../../engine/rules/validation';
import { createOrbitScene } from '../../engine/scenes/otherScenes';
import { useCampaign } from '../../store/campaignStore';
import type { RangeParam } from '../../types/catalog';
import type { EarthOrbitPlan, JupiterPlan, LunarPlan, MissionPlan } from '../../types/campaign';
import { configureOrbitView } from './orbitView';

function Slider({ label, unit, range, value, step = 1, onChange, testId, hint }: { label: string; unit: string; range: RangeParam; value: number; step?: number; onChange: (v: number) => void; testId?: string; hint?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div className="row small"><span>{label}</span><span className="spacer" /><span className="mono">{value.toLocaleString('pt-BR')} {unit}</span></div>
      <input type="range" min={range.min} max={range.max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%' }} data-testid={testId} aria-label={label} />
      {hint && <div className="small muted">{hint}</div>}
    </label>
  );
}

export function PlanningScreen() {
  const ctrl = useScene('orbit-planning', createOrbitScene);
  const campaign = useCampaign((s) => s.campaign)!;
  const update = useCampaign((s) => s.updatePlan);
  const goTo = useCampaign((s) => s.goTo);
  const mission = getMission(campaign.missionId!);
  const plan = campaign.plan!;
  const p = mission.planning;
  const assist = simulationConfig.assistance[campaign.assistance];
  const ctx = useMemo(() => validateMission({ mission, config: campaign.spacecraft, vehicleId: campaign.vehicleId, plan, assistance: campaign.assistance }).context, [mission, campaign.spacecraft, campaign.vehicleId, plan, campaign.assistance]);
  const profile = ctx.profile;
  useEffect(() => { if (ctrl) configureOrbitView(ctrl, plan, profile); }, [ctrl, plan, profile]);
  const set = (patch: Partial<MissionPlan>) => update(patch);
  const dvAvail = ctx.summary.deltaVAvailableMS;

  return (
    <>
      <aside className="side-left panel" aria-label="Parâmetros da trajetória">
        <div className="panel-title"><h2>Trajetória</h2><span className="chip info">{assist.label}</span></div>
        <div className="panel-body" style={{ flex: 1 }}>
          {plan.kind === 'earth-orbit' && <EarthControls plan={plan} set={set} p={p} />}
          {plan.kind === 'lunar' && <LunarControls plan={plan} set={set} p={p} />}
          {plan.kind === 'interplanetary' && <JupiterControls plan={plan} set={set} p={p} window={profile.window} />}
        </div>
      </aside>
      <aside className="side-right panel" aria-label="Orçamento de Δv">
        <div className="panel-title"><h2>Orçamento de Δv da sonda</h2></div>
        <div className="panel-body" style={{ flex: 1 }}>
          <table className="checks">
            <thead><tr><th>Fase</th><th>Δv</th><th>Dado</th></tr></thead>
            <tbody>
              {profile.phases.map((ph) => (
                <tr key={ph.id} title={ph.explanation}><td>{ph.label}<div className="small muted">{ph.explanation}</div></td><td className="mono">{fmtMs(ph.dvMS)}</td><td><StatusChip status={ph.status} /></td></tr>
              ))}
              <tr><td>Soma das fases</td><td className="mono">{fmtMs(profile.totalDvMS)}</td><td /></tr>
              <tr><td>Margem ({profile.marginPct}%, nível {assist.label})</td><td className="mono">{fmtMs(profile.requiredDvMS - profile.totalDvMS)}</td><td /></tr>
              <tr><td><b>Necessário</b></td><td className="mono"><b>{fmtMs(profile.requiredDvMS)}</b></td><td /></tr>
              <tr><td>Disponível (Tsiolkovsky com a massa real)</td><td className="mono" style={{ color: dvAvail >= profile.requiredDvMS ? 'var(--green)' : 'var(--red)' }}>{fmtMs(dvAvail)}</td><td /></tr>
            </tbody>
          </table>
          {assist.showFormulas && (
            <p className="small muted" style={{ lineHeight: 1.5 }}>Δv = Isp · g₀ · ln(m₀ / m_f). m₀ = massa seca + propelente; m_f = massa seca. O Δv do lançador não é somado ao da sonda: ele apenas entrega a sonda no perfil de lançamento.</p>
          )}
          <h3>Notas</h3>
          <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.5 }}>{profile.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          {profile.transferTimeS > 0 && <p className="small">Tempo de transferência: <span className="mono">{(profile.transferTimeS / 86400).toFixed(1)} dias</span></p>}
          <SourceRef id="jpl-astro-par" />
          <h3>Limitações do modelo</h3>
          <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.45 }}>{mission.knownLimitations.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      </aside>
      <div className="bottom-bar">
        <Stat label="Perfil do lançador" value={profile.launchProfile} sub={profile.c3KmS2 !== null ? `C3 ${profile.c3KmS2.toFixed(1)} km²/s²` : `${profile.targetAltitudeKm} km, ${profile.launchInclinationDeg.toFixed(1)}°`} />
        <Stat label="Δv necessário" value={fmtMs(profile.requiredDvMS)} sub={`margem ${profile.marginPct}%`} meter={dvAvail > 0 ? profile.requiredDvMS / dvAvail : 1.1} testId="stat-dv" />
        <Stat label="Δv disponível" value={fmtMs(dvAvail)} sub={ctx.summary.mainPropulsion?.name ?? 'sem propulsão'} />
        {profile.window && <Stat label="Janela de lançamento" value={`${profile.window.errorDays.toFixed(0)} dias`} sub={`tolerância ${profile.window.toleranceDays} d · janela ${profile.window.nearest}`} meter={profile.window.errorDays / profile.window.toleranceDays} />}
        <div className="panel" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={() => goTo('vehicle')}>← Lançador</button>
          <button className="btn primary" onClick={() => goTo('briefing')} data-testid="to-briefing">Briefing →</button>
        </div>
      </div>
    </>
  );
}

type SetFn = (p: Partial<MissionPlan>) => void;
type Spec = ReturnType<typeof getMission>['planning'];

function EarthControls({ plan, set, p }: { plan: EarthOrbitPlan; set: SetFn; p: Spec }) {
  const sso = sunSynchronousInclination(plan.altitudeKm * 1000, plan.eccentricity);
  return (
    <>
      <Slider label="Altitude" unit="km" range={p.altitudeKm!} value={plan.altitudeKm} step={5} onChange={(v) => set({ altitudeKm: v, ...(plan.inclinationMode === 'sso' ? { inclinationDeg: Number((sunSynchronousInclination(v * 1000) ?? plan.inclinationDeg).toFixed(2)) } : {}) })} testId="altitude" hint="Mais baixo: melhor resolução e mais arrasto. Mais alto: maior cobertura e menos arrasto." />
      <Slider label="Excentricidade" unit="" range={p.eccentricity!} value={plan.eccentricity} step={0.0005} onChange={(v) => set({ eccentricity: v })} />
      <label className="small row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={plan.inclinationMode === 'sso'} onChange={(e) => set({ inclinationMode: e.target.checked ? 'sso' : 'manual', ...(e.target.checked && sso ? { inclinationDeg: Number(sso.toFixed(2)) } : {}) })} data-testid="sso-toggle" />
        Órbita heliossíncrona (inclinação calculada por J2: {sso ? `${sso.toFixed(2)}°` : 'impossível'})
      </label>
      <Slider label="Inclinação" unit="°" range={p.inclinationDeg!} value={plan.inclinationDeg} step={0.1} onChange={(v) => set({ inclinationDeg: v, inclinationMode: 'manual' })} />
      <label style={{ display: 'block', marginBottom: 10 }}>
        <div className="small">Hora local do nodo</div>
        <select className="input" value={plan.localTimeOfNode} onChange={(e) => set({ localTimeOfNode: e.target.value })}>{p.localTimeOfNode!.options.map((o) => <option key={o}>{o}</option>)}</select>
        <div className="small muted">Define o ângulo β e, portanto, a fração de eclipse e a iluminação das imagens.</div>
      </label>
      <Slider label="Vida útil" unit="anos" range={p.missionLifeYears!} value={plan.missionLifeYears} step={0.5} onChange={(v) => set({ missionLifeYears: v })} />
      <Slider label="Órbitas até o ajuste" unit="" range={p.orbitsBeforeTrim!} value={plan.orbitsBeforeTrim} onChange={(v) => set({ orbitsBeforeTrim: v })} />
      <label style={{ display: 'block' }}><div className="small">Data de lançamento</div><input className="input" type="date" value={plan.launchDate} onChange={(e) => set({ launchDate: e.target.value })} /></label>
    </>
  );
}

function LunarControls({ plan, set, p }: { plan: LunarPlan; set: SetFn; p: Spec }) {
  return (
    <>
      <Slider label="Órbita de estacionamento" unit="km" range={p.parkingOrbitKm!} value={plan.parkingOrbitKm} step={5} onChange={(v) => set({ parkingOrbitKm: v })} />
      <label style={{ display: 'block', marginBottom: 10 }}>
        <div className="small">Transferência</div>
        <select className="input" value={plan.transfer} onChange={(e) => set({ transfer: e.target.value as LunarPlan['transfer'] })} data-testid="transfer">{p.transferOptions!.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        <div className="small muted">Transferência rápida chega antes, mas com v∞ maior: a inserção lunar custa mais Δv.</div>
      </label>
      <Slider label="Altitude lunar" unit="km" range={p.altitudeKm!} value={plan.lunarAltitudeKm} step={5} onChange={(v) => set({ lunarAltitudeKm: v })} hint="Órbitas baixas melhoram a resolução, mas exigem mais manutenção (mascons)." />
      <Slider label="Inclinação lunar" unit="°" range={p.inclinationDeg!} value={plan.inclinationDeg} step={0.5} onChange={(v) => set({ inclinationDeg: v })} hint="≥ 85° cobre os polos (gelo em crateras sombreadas)." />
      <Slider label="Correções de trajetória" unit="" range={p.tcmCount!} value={plan.tcmCount} onChange={(v) => set({ tcmCount: v })} />
      <Slider label="Duração da ciência" unit="meses" range={p.missionLifeMonths!} value={plan.missionLifeMonths} onChange={(v) => set({ missionLifeMonths: v })} />
      <label style={{ display: 'block' }}><div className="small">Data de lançamento</div><input className="input" type="date" value={plan.launchDate} onChange={(e) => set({ launchDate: e.target.value })} /></label>
    </>
  );
}

function JupiterControls({ plan, set, p, window }: { plan: JupiterPlan; set: SetFn; p: Spec; window: { errorDays: number; toleranceDays: number; nearest: string; phasingDate: string } | undefined }) {
  return (
    <>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <div className="small">Trajetória</div>
        <select className="input" value={plan.trajectory} onChange={(e) => set({ trajectory: e.target.value as JupiterPlan['trajectory'] })} data-testid="trajectory">{p.trajectoryOptions!.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        <div className="small muted">A trajetória define o perfil de lançamento (C3) exigido do lançador.</div>
      </label>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <div className="small">Data de partida</div>
        <input className="input" type="date" min={p.departureDate!.min} max={p.departureDate!.max} value={plan.departureDate} onChange={(e) => set({ departureDate: e.target.value })} data-testid="departure" />
        {window && <div className="small" style={{ color: window.errorDays <= window.toleranceDays ? 'var(--green)' : 'var(--red)' }}>Fase Terra–Júpiter: erro de {window.errorDays.toFixed(0)} dias (janela mais próxima {window.nearest})</div>}
        {window && window.errorDays > window.toleranceDays && window.nearest >= p.departureDate!.min && window.nearest <= p.departureDate!.max && (
          <button className="btn small amber" style={{ marginTop: 4 }} onClick={() => set({ departureDate: window.nearest })} data-testid="snap-window">Usar a janela de {window.nearest}</button>
        )}
        <div className="small muted">Posições médias JPL em modelo circular coplanar: aproximação didática da geometria da janela.</div>
      </label>
      <Slider label="Altitude do perijove" unit="km" range={p.perijoveAltitudeKm!} value={plan.perijoveAltitudeKm} step={500} onChange={(v) => set({ perijoveAltitudeKm: v })} hint="Perijove baixo: inserção mais barata (efeito Oberth), porém mais radiação." />
      <Slider label="Período orbital" unit="dias" range={p.orbitPeriodDays!} value={plan.orbitPeriodDays} onChange={(v) => set({ orbitPeriodDays: v })} hint="Órbitas longas custam menos Δv na captura, mas reduzem o número de passagens." />
      <Slider label="Inclinação" unit="°" range={p.inclinationDeg!} value={plan.inclinationDeg} onChange={(v) => set({ inclinationDeg: v })} />
      <Slider label="Correções de trajetória" unit="" range={p.tcmCount!} value={plan.tcmCount} onChange={(v) => set({ tcmCount: v })} />
      <Slider label="Órbitas científicas" unit="" range={p.scienceOrbits!} value={plan.scienceOrbits} onChange={(v) => set({ scienceOrbits: v })} />
    </>
  );
}

