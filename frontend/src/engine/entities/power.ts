/**
 * Estado de energia em voo ligado aos painéis solares. Os painéis viajam dobrados dentro da coifa; até serem
 * estendidos em órbita a sonda vive só da bateria, então propulsão principal e instrumentos ficam
 * indisponíveis. Sondas com RTG (gerador a radioisótopo) têm energia própria e não dependem dos painéis.
 */
import type { FlightEventRecord, InstalledComponent } from '../../types/campaign';

export const ARRAYS_EVENT = 'arrays-deployed';
export const SOLAR_ARRAY_IDS = new Set(['solar-gaas', 'solar-articulated', 'solar-giant']);

export interface PowerState {
  hasSolarArrays: boolean;
  hasRtg: boolean;
  arraysDeployed: boolean;
  /** Painéis instalados e ainda dobrados. */
  needsDeploy: boolean;
  /** Sem energia para manobras e ciência (painéis dobrados e sem RTG). */
  blocked: boolean;
}

export function powerState(installed: InstalledComponent[], events: FlightEventRecord[]): PowerState {
  const hasSolarArrays = installed.some((i) => SOLAR_ARRAY_IDS.has(i.componentId));
  const hasRtg = installed.some((i) => i.componentId === 'rtg');
  const arraysDeployed = events.some((e) => e.id === ARRAYS_EVENT);
  const needsDeploy = hasSolarArrays && !arraysDeployed;
  return { hasSolarArrays, hasRtg, arraysDeployed, needsDeploy, blocked: needsDeploy && !hasRtg };
}
