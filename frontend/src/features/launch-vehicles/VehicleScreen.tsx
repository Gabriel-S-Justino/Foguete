import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '@babylonjs/core';
import { useScene } from '../../components/useScene';
import { fmtKg, SourceRef, Stat, StatusChip } from '../../components/ui';
import { findVehicle, getMission, launchVehicles } from '../../engine/catalog';
import { formatBRL, formatUSD } from '../../engine/rules/budget';
import { validateMission, vehicleCompatibility } from '../../engine/rules/validation';
import { createRocketHangarScene } from '../../engine/scenes/otherScenes';
import { useCampaign } from '../../store/campaignStore';

const maxHeight = Math.max(...launchVehicles.vehicles.map((v) => v.heightM));
const factory = (e: Engine) => createRocketHangarScene(e, maxHeight);

export function VehicleScreen() {
  const ctrl = useScene('rocket-hangar', factory);
  const campaign = useCampaign((s) => s.campaign)!;
  const selectVehicle = useCampaign((s) => s.selectVehicle);
  const goTo = useCampaign((s) => s.goTo);
  const mission = getMission(campaign.missionId!);
  const [viewId, setViewId] = useState<string>(campaign.vehicleId ?? launchVehicles.vehicles[0]!.id);
  const vehicle = findVehicle(viewId)!;

  const ctx = useMemo(() => validateMission({ mission, config: campaign.spacecraft, vehicleId: viewId, plan: campaign.plan!, assistance: campaign.assistance }).context, [mission, campaign.spacecraft, viewId, campaign.plan, campaign.assistance]);
  const profileId = ctx.profile.launchProfile;
  const profile = launchVehicles.profiles[profileId];
  const wet = ctx.summary.wetMassKg;
  useEffect(() => { ctrl?.showVehicle(vehicle); }, [ctrl, vehicle]);

  const comp = vehicleCompatibility(vehicle, profileId, wet);
  const cap = vehicle.capacities[profileId];
  return (
    <>
      <aside className="side-left panel" aria-label="Veículos">
        <div className="panel-title"><h2>Lançadores</h2><span className="small muted">perfil: {profile.name}</span></div>
        <ul className="list panel-body" style={{ padding: 0, flex: 1 }}>
          {launchVehicles.vehicles.map((v) => {
            const c = vehicleCompatibility(v, profileId, wet);
            return (
              <li key={v.id} className={`catalog-item ${viewId === v.id ? 'selected' : ''} ${campaign.vehicleId === v.id ? 'installed' : ''}`} onClick={() => setViewId(v.id)} data-testid={`vehicle-${v.id}`}>
                <div className="thumb">{v.heightM.toFixed(0)} m</div>
                <div>
                  <div className="name">{v.name}</div>
                  <div className="meta">{v.provider} · {formatUSD(v.cost.usedUSD)}</div>
                  <div className="why" style={{ color: c.status === 'compativel' ? 'var(--green)' : c.status === 'pendente' ? 'var(--steel-400)' : 'var(--red)' }}>
                    {c.status === 'compativel' ? `compatível (margem ${c.marginPct?.toFixed(0)}%)` : c.status === 'pendente' ? 'capacidade pendente' : 'capacidade insuficiente'}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>
      <aside className="side-right panel" aria-label="Ficha do veículo">
        <div className="panel-title"><h2>{vehicle.name}</h2><StatusChip status={cap.status} /></div>
        <div className="panel-body" style={{ flex: 1 }}>
          <p className="small" style={{ lineHeight: 1.5 }}>{comp.text}</p>
          <dl className="kv">
            <dt>Fornecedor</dt><dd>{vehicle.provider}</dd>
            <dt>Tipo (documento)</dt><dd>{vehicle.typeFromDocument}</dd>
            <dt>Reutilização</dt><dd>{vehicle.reusability}</dd>
            <dt>Altura / diâmetro</dt><dd>{vehicle.heightM} m / {vehicle.diameterM} m</dd>
            <dt>Custo informado</dt><dd>{vehicle.cost.reportedText}</dd>
            <dt>Custo usado</dt><dd>{formatUSD(vehicle.cost.usedUSD)}</dd>
            <dt>Em reais</dt><dd>{formatBRL(vehicle.cost.usedUSD)}</dd>
            <dt>Capacidade ({profile.name})</dt><dd>{cap.massKg !== null ? fmtKg(cap.massKg) : 'pendente'}</dd>
          </dl>
          <p className="small muted" style={{ lineHeight: 1.45 }}>{cap.notes}</p>
          <SourceRef id={cap.sourceId} />
          <h3 style={{ marginTop: 10 }}>Estágios</h3>
          <table className="checks">
            <thead><tr><th>Estágio</th><th>Seco</th><th>Propelente</th><th>Isp vác.</th></tr></thead>
            <tbody>{vehicle.stages.map((s) => <tr key={s.name}><td>{s.name}{s.parallel ? ' (paralelo)' : ''}</td><td className="mono">{fmtKg(s.dryMassKg)}</td><td className="mono">{fmtKg(s.propMassKg)}</td><td className="mono">{s.ispVac} s</td></tr>)}</tbody>
          </table>
          <p className="small muted">Massas e Isp dos estágios são aproximações públicas usadas apenas na simulação da ascensão; a aprovação usa a capacidade documentada por perfil.</p>
          <h3>Limitações</h3>
          <ul className="small" style={{ paddingLeft: 18 }}>{vehicle.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="small muted">{vehicle.referenceContext}</p>
          <SourceRef id={vehicle.cost.sourceId} />
          <p className="small muted">{vehicle.cost.documentNote}</p>
        </div>
      </aside>
      <div className="bottom-bar">
        <Stat label="Massa da sonda" value={fmtKg(wet)} sub="carga útil a lançar" />
        <Stat label="Capacidade no perfil" value={cap.massKg !== null ? fmtKg(cap.massKg) : 'pendente'} sub={profile.c3KmS2 !== null ? `C3 ${profile.c3KmS2} km²/s²` : 'órbita baixa'} meter={cap.massKg ? wet / cap.massKg : undefined} />
        <Stat label="Orçamento com este veículo" value={formatUSD(ctx.budget.committedUSD)} sub={`de ${formatUSD(ctx.budget.availableUSD)}`} meter={ctx.budget.committedUSD / ctx.budget.availableUSD} />
        <div className="panel" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn amber" onClick={() => selectVehicle(vehicle.id)} disabled={campaign.vehicleId === vehicle.id} data-testid="select-vehicle">{campaign.vehicleId === vehicle.id ? 'Selecionado' : 'Selecionar veículo'}</button>
          <button className="btn" onClick={() => goTo('hangar')}>← Sonda</button>
          <button className="btn primary" onClick={() => goTo('planning')} disabled={!campaign.vehicleId} data-testid="to-planning">Trajetória →</button>
        </div>
      </div>
      {comp.status === 'pendente' && (
        <div className="panel small" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 14, padding: '6px 10px', maxWidth: 520 }}>
          A capacidade deste veículo para o perfil exigido não está documentada nas fontes: o lançamento permanecerá bloqueado. Nunca derivamos capacidades de outros perfis.
        </div>
      )}
    </>
  );
}
