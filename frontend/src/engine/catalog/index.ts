import componentsJson from '@data/components/components.json';
import vehiclesJson from '@data/launch-vehicles/launch-vehicles.json';
import missionsJson from '@data/missions/missions.json';
import constantsJson from '@data/scientific-sources/constants.json';
import sourcesJson from '@data/scientific-sources/sources.json';
import simulationJson from '@data/simulation/simulation-config.json';
import type {
  ComponentCatalog, ComponentSpec, ConstantsCatalog, LaunchVehicle, LaunchVehicleCatalog,
  MissionCatalog, MissionId, MissionSpec, SimulationConfig, SourceCatalog,
} from '../../types/catalog';

export const components = componentsJson as unknown as ComponentCatalog;
export const launchVehicles = vehiclesJson as unknown as LaunchVehicleCatalog;
export const missions = missionsJson as unknown as MissionCatalog;
export const constants = constantsJson as unknown as ConstantsCatalog;
export const sources = sourcesJson as unknown as SourceCatalog;
export const simulationConfig = simulationJson as unknown as SimulationConfig;

/** Versões gravadas em cada campanha para que atualizações futuras não alterem resultados antigos. */
export const catalogVersions = {
  components: components.version,
  launchVehicles: launchVehicles.version,
  missions: missions.version,
  constants: constants.version,
  simulation: simulationConfig.version,
  simulationModel: 'sma-engine-1.0.0',
} as const;

const componentIndex = new Map(components.components.map((c) => [c.id, c]));
const vehicleIndex = new Map(launchVehicles.vehicles.map((v) => [v.id, v]));
const missionIndex = new Map(missions.missions.map((m) => [m.id, m]));
const sourceIndex = new Map(sources.sources.map((s) => [s.id, s]));

export function getComponent(id: string): ComponentSpec {
  const c = componentIndex.get(id);
  if (!c) throw new Error(`Componente desconhecido: ${id}`);
  return c;
}
export function findComponent(id: string): ComponentSpec | undefined {
  return componentIndex.get(id);
}
export function getVehicle(id: string): LaunchVehicle {
  const v = vehicleIndex.get(id);
  if (!v) throw new Error(`Veículo desconhecido: ${id}`);
  return v;
}
export function findVehicle(id: string | null | undefined): LaunchVehicle | undefined {
  return id ? vehicleIndex.get(id) : undefined;
}
export function getMission(id: MissionId): MissionSpec {
  const m = missionIndex.get(id);
  if (!m) throw new Error(`Missão desconhecida: ${id}`);
  return m;
}
export function getSource(id: string | null | undefined) {
  return id ? sourceIndex.get(id) : undefined;
}

/** Verificação estrutural mínima dos catálogos (executada nos testes e na inicialização). */
export function checkCatalogIntegrity(): string[] {
  const problems: string[] = [];
  const known = new Set(sources.sources.map((s) => s.id));
  for (const v of launchVehicles.vehicles) {
    if (!known.has(v.cost.sourceId)) problems.push(`${v.id}: fonte de custo inexistente`);
    for (const [profile, cap] of Object.entries(v.capacities)) {
      if (cap.status !== 'pendente' && (cap.massKg === null || cap.massKg <= 0)) problems.push(`${v.id}/${profile}: capacidade não pendente sem valor`);
      if (cap.status === 'pendente' && cap.massKg !== null) problems.push(`${v.id}/${profile}: capacidade pendente com valor`);
      if (cap.sourceId && !known.has(cap.sourceId)) problems.push(`${v.id}/${profile}: fonte ${cap.sourceId} inexistente`);
    }
  }
  for (const c of components.components) {
    if (c.massKg < 0 || c.costUSD < 0) problems.push(`${c.id}: massa/custo negativo`);
    if (c.documentedFor.length === 0) problems.push(`${c.id}: sem missão documentada`);
  }
  for (const m of missions.missions) {
    const w = m.objectives.reduce((s, o) => s + o.weight, 0);
    if (Math.abs(w - 1) > 1e-6) problems.push(`${m.id}: pesos dos objetivos somam ${w}`);
    for (const cp of m.checkpoints) {
      if (!m.objectives.some((o) => o.id === cp.objectiveId)) problems.push(`${m.id}/${cp.id}: objetivo inexistente`);
    }
    for (const s of m.sources) if (!known.has(s)) problems.push(`${m.id}: fonte ${s} inexistente`);
  }
  return problems;
}
