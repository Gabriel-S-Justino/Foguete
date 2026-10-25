/**
 * Liga o plano da missão e o estado do voo à trajetória física (missionTrajectory) e à cena orbital.
 * A mesma função monta a linha do tempo no planejamento (inserção nominal) e nas operações (estado real do fim
 * da subida, comando de partida do jogador e resultado da inserção final).
 */
import type { MissionPlan, OrbitInsertion } from '../../types/campaign';
import type { MissionSpec } from '../../types/catalog';
import { BODIES, circularVelocity } from '../../engine/orbital-mechanics/orbits';
import { buildTimeline, type MissionTimeline, type TimelineInput } from '../../engine/orbital-mechanics/missionTrajectory';
import type { MissionProfile } from '../../engine/rules/mission-profile';
import { plannedManeuvers } from '../../engine/science/operations';

/** Inserção nominal (órbita circular na altitude alvo), usada no planejamento e em campanhas antigas. */
export function nominalInsertion(profile: MissionProfile): OrbitInsertion {
  const alt = profile.targetAltitudeKm * 1000;
  return { altitudeM: alt, speedMS: circularVelocity(BODIES.earth.mu, BODIES.earth.radius + alt), flightPathDeg: 0, inclinationDeg: profile.launchInclinationDeg, downrangeM: 1.9e6 };
}

export interface TimelineOptions {
  insertion?: OrbitInsertion | null;
  departureCommandT?: number | null;
  outcome?: 'captured' | 'high-orbit' | 'flyby';
}

export function timelineInput(mission: MissionSpec, plan: MissionPlan, profile: MissionProfile, opts: TimelineOptions = {}): TimelineInput {
  const insertion = opts.insertion ?? nominalInsertion(profile);
  const maneuverIds = plannedManeuvers(profile).filter((m) => m.executable).map((m) => m.id);
  const common = {
    insertion, parkingAltitudeKm: profile.targetAltitudeKm, launchInclinationDeg: profile.launchInclinationDeg, maneuverIds,
    departureCommandT: opts.departureCommandT ?? null, outcome: opts.outcome,
  };
  if (plan.kind === 'earth-orbit') {
    return { ...common, kind: 'earth-orbit', launchDate: plan.launchDate, localTimeOfNode: plan.localTimeOfNode };
  }
  if (plan.kind === 'lunar') {
    const opt = mission.planning.transferOptions?.find((o) => o.id === plan.transfer);
    return {
      ...common, kind: 'lunar', launchDate: plan.launchDate, lunarAltitudeKm: plan.lunarAltitudeKm, lunarInclinationDeg: plan.inclinationDeg,
      apogeeFactor: opt?.apogeeFactor ?? 1,
    };
  }
  const opt = mission.planning.trajectoryOptions?.find((o) => o.id === plan.trajectory);
  return {
    ...common, kind: 'interplanetary', launchDate: plan.departureDate, trajectory: plan.trajectory === 'direct' ? 'direct' : 'dveega',
    c3KmS2: profile.c3KmS2, loopYears: opt?.loopYears ?? 2, perijoveAltitudeKm: plan.perijoveAltitudeKm, orbitPeriodDays: plan.orbitPeriodDays,
    jupiterInclinationDeg: plan.inclinationDeg,
  };
}

/** Linha do tempo (com cache: a construção resolve Lambert e cônicas e leva de 10 a 700 ms). */
const cache = new Map<string, MissionTimeline>();
export function missionTimeline(mission: MissionSpec, plan: MissionPlan, profile: MissionProfile, opts: TimelineOptions = {}): MissionTimeline {
  const input = timelineInput(mission, plan, profile, opts);
  const key = JSON.stringify(input);
  let tl = cache.get(key);
  if (!tl) {
    tl = buildTimeline(input);
    if (cache.size > 12) cache.clear();
    cache.set(key, tl);
  }
  return tl;
}
