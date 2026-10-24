/**
 * Análise da configuração da sonda: massa, custo, energia, comunicação, propulsão e radiação,
 * calculados exclusivamente a partir dos componentes efetivamente instalados.
 */
import type { ComponentSpec, MissionSpec } from '../../types/catalog';
import type { MissionPlan, SpacecraftConfig } from '../../types/campaign';
import { components, getComponent, simulationConfig } from '../catalog';
import { DAY, JULIAN_YEAR } from '../core/units';
import { tsiolkovsky } from '../propulsion/rocket';
import { BODIES, betaAngleForLocalTime, eclipseFraction, earthJupiterMeanDistance, lightTime, orbitalPeriod } from '../orbital-mechanics/orbits';

export interface PropulsionSummary {
  componentId: string;
  name: string;
  ispS: number;
  thrustN: number;
  kind: string;
}

export interface SpacecraftSummary {
  parts: ComponentSpec[];
  dryMassKg: number;
  propellantKg: number;
  wetMassKg: number;
  tankCapacityKg: number;
  structuralLimitKg: number | null;
  componentCostUSD: number;
  powerConsumptionW: number;
  powerGenerationW: number;
  solarAtDistanceW: number;
  rtgW: number;
  batteryWh: number;
  storageGb: number;
  dataGeneratedGbPerDay: number;
  downlinkGbPerDay: number;
  commandRateKbps: number;
  scienceRateMbps: number;
  communicationDelayS: number;
  capabilities: Set<string>;
  mainPropulsion: PropulsionSummary | null;
  deltaVAvailableMS: number;
  eclipseFraction: number;
  eclipseDurationS: number;
  orbitPeriodS: number;
  missionDurationS: number;
  radiation: { componentId: string; name: string; doseKrad: number; toleranceKrad: number; ratio: number; shielded: boolean }[];
  thermalDissipationW: number;
}

export function partsOf(config: SpacecraftConfig): ComponentSpec[] {
  return config.installed.map((i) => getComponent(i.componentId));
}

/** Capacidades efetivas considerando o ambiente (ex.: magnetotorquers só descarregam rodas perto da Terra). */
export function effectiveCapabilities(parts: ComponentSpec[], mission: MissionSpec): Set<string> {
  const caps = new Set<string>();
  for (const p of parts) for (const c of p.provides) caps.add(c);
  if (caps.has('momentum-dump-thrusters') || (caps.has('momentum-dump-magnetic') && mission.environment.magneticMomentumDumping)) {
    caps.add('momentum-dump');
  }
  if (caps.has('navigation-gnss') && !mission.environment.gnssAvailable) caps.delete('navigation-gnss');
  return caps;
}

/** Distância Terra–sonda usada no enlace (m). */
export function earthRangeM(mission: MissionSpec): number {
  if (mission.environment.centralBody === 'jupiter') return earthJupiterMeanDistance();
  return mission.environment.earthRangeKm * 1000;
}

/** Taxa de um enlace na distância d: cai com 1/d² além da distância de referência do projeto. */
export function linkRateMbps(rateMbps: number, refRangeKm: number, rangeM: number): number {
  const ratio = (refRangeKm * 1000) / rangeM;
  return rateMbps * Math.min(1, ratio * ratio);
}

export function missionGeometry(mission: MissionSpec, plan: MissionPlan | null) {
  const env = mission.environment;
  if (env.centralBody === 'earth') {
    const alt = plan?.kind === 'earth-orbit' ? plan.altitudeKm : 705;
    const r = BODIES.earth.radius + alt * 1000;
    const beta = plan?.kind === 'earth-orbit' ? betaAngleForLocalTime(plan.localTimeOfNode) : 0;
    const period = orbitalPeriod(BODIES.earth.mu, r);
    const f = eclipseFraction(BODIES.earth.radius, r, beta);
    const years = plan?.kind === 'earth-orbit' ? plan.missionLifeYears : 5;
    return { period, eclipseFraction: f, duration: years * JULIAN_YEAR, altitudeKm: alt };
  }
  if (env.centralBody === 'moon') {
    const alt = plan?.kind === 'lunar' ? plan.lunarAltitudeKm : 50;
    const r = BODIES.moon.radius + alt * 1000;
    const period = orbitalPeriod(BODIES.moon.mu, r);
    const months = plan?.kind === 'lunar' ? plan.missionLifeMonths : 12;
    return { period, eclipseFraction: eclipseFraction(BODIES.moon.radius, r, 0), duration: (months / 12) * JULIAN_YEAR, altitudeKm: alt };
  }
  const periodDays = plan?.kind === 'interplanetary' ? plan.orbitPeriodDays : 53;
  const orbits = plan?.kind === 'interplanetary' ? plan.scienceOrbits : 12;
  // Órbita polar muito excêntrica: eclipses por Júpiter são evitados no projeto (premissa documentada)
  return { period: periodDays * DAY, eclipseFraction: 0, duration: orbits * periodDays * DAY, altitudeKm: plan?.kind === 'interplanetary' ? plan.perijoveAltitudeKm : 4200 };
}

/** Anos de exposição à radiação no ambiente de destino (cruzeiro com taxa reduzida). */
function exposureYears(plan: MissionPlan | null, durationS: number): number {
  let years = durationS / JULIAN_YEAR;
  if (plan?.kind === 'interplanetary') {
    const cruiseYears = plan.trajectory === 'dveega' ? 4.8 : 2.7;
    years += cruiseYears * 0.01; // cruzeiro interplanetário: ~1% da taxa joviana (didático)
  }
  return years;
}

export function analyzeSpacecraft(config: SpacecraftConfig, mission: MissionSpec, plan: MissionPlan | null): SpacecraftSummary {
  const parts = partsOf(config);
  const caps = effectiveCapabilities(parts, mission);
  const geo = missionGeometry(mission, plan);
  const env = mission.environment;
  const years = geo.duration / JULIAN_YEAR;

  const dryMassKg = parts.reduce((s, p) => s + p.massKg, 0);
  const tankCapacityKg = parts.reduce((s, p) => s + (p.effects.tankCapacityKg ?? 0), 0);
  const propellantKg = Math.min(config.propellantKg, tankCapacityKg);
  const structural = parts.find((p) => p.effects.maxTotalMassKg !== undefined)?.effects.maxTotalMassKg ?? null;

  const degradation = Math.max(0, 1 - simulationConfig.physics.solarArrayDegradationPerYear * years);
  const solar1AU = parts.reduce((s, p) => s + (p.effects.solarW1AU ?? 0), 0);
  const solarAtDistanceW = (solar1AU / env.sunDistanceAU ** 2) * degradation;
  const rtgW = parts.reduce((s, p) => s + (p.effects.rtgW ?? 0), 0);
  const powerConsumptionW = parts.reduce((s, p) => s + p.powerW, 0);

  const rangeM = earthRangeM(mission);
  let scienceRate = 0;
  let commandRate = 0;
  for (const p of parts) {
    const c = p.effects.comm;
    if (!c) continue;
    const rate = linkRateMbps(c.rateMbps, c.refRangeKm, rangeM);
    if (p.provides.includes('comm-science')) scienceRate = Math.max(scienceRate, rate);
    if (p.provides.includes('comm-command')) commandRate = Math.max(commandRate, rate);
  }
  const downlinkGbPerDay = (scienceRate * env.contactHoursPerDay * 3600) / 8000;
  const dataGeneratedGbPerDay = parts.reduce((s, p) => s + (p.effects.science?.dataGbPerDay ?? 0), 0);

  const engines = parts
    .filter((p) => p.effects.propulsion)
    .map((p) => ({ componentId: p.id, name: p.name, ...p.effects.propulsion! }))
    .sort((a, b) => b.thrustN - a.thrustN);
  const mainPropulsion = engines[0] ?? null;
  const wetMassKg = dryMassKg + propellantKg;
  const deltaVAvailableMS = mainPropulsion && propellantKg > 0 ? tsiolkovsky(mainPropulsion.ispS, wetMassKg, dryMassKg) : 0;

  const vault = parts.find((p) => p.effects.vaultDoseFactor !== undefined);
  const dose = env.radiationKradPerYear * exposureYears(plan, geo.duration);
  const radiation = parts
    .filter((p) => p.radiationToleranceKrad !== undefined)
    .map((p) => {
      const internal = p.mount === 'internal' || p.electronics === true;
      const shielded = Boolean(vault) && internal;
      // Fatores didáticos: blindagem do cofre (0,03), blindagem local de instrumentos externos (0,05),
      // equipamentos internos sem cofre recebem a dose atrás da estrutura (0,3).
      const factor = shielded ? vault!.effects.vaultDoseFactor! : internal ? 0.3 : 0.05;
      const doseKrad = dose * factor;
      const tol = p.radiationToleranceKrad!;
      return { componentId: p.id, name: p.name, doseKrad, toleranceKrad: tol, ratio: doseKrad / tol, shielded };
    });

  return {
    parts,
    dryMassKg,
    propellantKg,
    wetMassKg,
    tankCapacityKg,
    structuralLimitKg: structural,
    componentCostUSD: parts.reduce((s, p) => s + p.costUSD, 0),
    powerConsumptionW,
    powerGenerationW: solarAtDistanceW + rtgW,
    solarAtDistanceW,
    rtgW,
    batteryWh: parts.reduce((s, p) => s + (p.effects.batteryWh ?? 0), 0),
    storageGb: parts.reduce((s, p) => s + (p.effects.storageGb ?? 0), 0),
    dataGeneratedGbPerDay,
    downlinkGbPerDay,
    commandRateKbps: commandRate * 1000,
    scienceRateMbps: scienceRate,
    communicationDelayS: lightTime(rangeM),
    capabilities: caps,
    mainPropulsion,
    deltaVAvailableMS,
    eclipseFraction: geo.eclipseFraction,
    eclipseDurationS: geo.eclipseFraction * geo.period,
    orbitPeriodS: geo.period,
    missionDurationS: geo.duration,
    radiation,
    thermalDissipationW: powerConsumptionW,
  };
}

export interface InstallCheck { ok: boolean; reason: string }

/** Regras de montagem no hangar (cada restrição tem justificativa técnica). */
export function canInstall(config: SpacecraftConfig, componentId: string): InstallCheck {
  const spec = getComponent(componentId);
  const parts = partsOf(config);
  const count = parts.filter((p) => p.id === componentId).length;
  const hasBus = parts.some((p) => p.provides.includes('structure'));
  if (spec.mount === 'bus') {
    if (hasBus) return { ok: false, reason: 'Já existe uma estrutura principal instalada; remova-a antes de trocar de barramento.' };
    return { ok: true, reason: '' };
  }
  if (!hasBus) return { ok: false, reason: 'Instale primeiro uma estrutura principal (barramento): todos os componentes precisam de um ponto de montagem.' };
  if (count >= spec.maxInstances) {
    return { ok: false, reason: spec.maxInstances === 1 ? 'Este componente já está instalado (unidade única por projeto).' : `Limite de ${spec.maxInstances} unidades atingido.` };
  }
  return { ok: true, reason: '' };
}

export function canRemove(config: SpacecraftConfig, instanceId: string): InstallCheck {
  const inst = config.installed.find((i) => i.instanceId === instanceId);
  if (!inst) return { ok: false, reason: 'Componente não encontrado.' };
  const spec = getComponent(inst.componentId);
  if (spec.mount === 'bus' && config.installed.length > 1) {
    return { ok: false, reason: 'Remova os demais componentes antes da estrutura principal: eles estão fixados nela.' };
  }
  return { ok: true, reason: '' };
}

/** Relevância de um componente para a missão (explicação adaptada). */
export function componentRelevance(spec: ComponentSpec, mission: MissionSpec): { level: 'essencial' | 'útil' | 'irrelevante'; text: string } {
  const measures = spec.effects.science?.measures ?? [];
  if (measures.length > 0) {
    const objective = mission.objectives.find((o) => o.measures.some((m) => measures.includes(m)));
    if (objective) return { level: objective.primary ? 'essencial' : 'útil', text: `Atende ao objetivo "${objective.title}"${objective.primary ? ' (primário)' : ''}.` };
    return { level: 'irrelevante', text: 'Nenhum objetivo científico desta missão usa esta medida: massa e custo sem retorno científico.' };
  }
  const req = mission.requirements.find((r) => r.anyOf.some((c) => spec.provides.includes(c)));
  if (req) return { level: req.severity === 'obrigatoria' ? 'essencial' : 'útil', text: req.reason };
  if (spec.documentedFor.includes(mission.id)) return { level: 'útil', text: 'Listado na arquitetura de referência desta missão (componentes-sondas.md).' };
  if (spec.provides.includes('navigation-gnss') && !mission.environment.gnssAvailable) {
    return { level: 'irrelevante', text: 'O GPS não funciona longe da Terra: os sinais da constelação são projetados para a superfície e órbitas baixas.' };
  }
  if (spec.provides.includes('momentum-dump-magnetic') && !mission.environment.magneticMomentumDumping) {
    return { level: 'irrelevante', text: 'Magnetotorquers dependem de um campo magnético planetário adequado e previsível; aqui não descarregam as rodas.' };
  }
  return { level: 'útil', text: 'Não faz parte da arquitetura de referência desta missão; avalie massa e custo.' };
}

export const allComponents = components.components;
