/**
 * Perfil da missão: perfil de lançamento exigido e orçamento de Δv da sonda por fase.
 * O Δv do lançador nunca é somado ao da sonda: o lançador entrega a sonda no perfil (órbita, TLI ou C3);
 * a partir daí, apenas a propulsão da própria sonda conta.
 */
import type { AssistanceLevel, LaunchProfileId, MissionSpec, ValidationStatus } from '../../types/catalog';
import type { MissionPlan } from '../../types/campaign';
import { atmosphere } from '../atmosphere/us76';
import { DAY, JULIAN_YEAR } from '../core/units';
import {
  BODIES, captureDeltaV, circularVelocity, deorbitDeltaV, jupiterWindow, lunarTransfer,
  semiMajorAxisFromPeriod, sunSynchronousInclination,
} from '../orbital-mechanics/orbits';

export interface DeltaVPhase {
  id: string;
  label: string;
  dvMS: number;
  status: ValidationStatus;
  explanation: string;
}

export interface MissionProfile {
  launchProfile: LaunchProfileId;
  targetAltitudeKm: number;
  launchInclinationDeg: number;
  phases: DeltaVPhase[];
  totalDvMS: number;
  marginPct: number;
  requiredDvMS: number;
  /** Altitude/raio do periapse da captura e semieixo maior final (para checar perdas gravitacionais). */
  capture?: { mu: number; rp: number; a: number; dvMS: number; bodyName: string };
  transferTimeS: number;
  c3KmS2: number | null;
  notes: string[];
  window?: { errorDays: number; toleranceDays: number; nearest: string; phasingDate: string };
}

/** Δv anual para compensar arrasto em órbita circular (aproximação: Δv/ano = ρ·v²·(Cd·A/m)·... ). */
function dragMakeupPerYear(altitudeKm: number, ballisticCoeffKgM2 = 100): number {
  const r = BODIES.earth.radius + altitudeKm * 1000;
  const v = circularVelocity(BODIES.earth.mu, r);
  const rho = atmosphere(altitudeKm * 1000).densityKgM3;
  const accel = (0.5 * rho * v * v) / ballisticCoeffKgM2;
  return accel * JULIAN_YEAR;
}

export function defaultPlan(mission: MissionSpec): MissionPlan {
  const p = mission.planning;
  if (p.type === 'earth-orbit') {
    const alt = p.altitudeKm!.default;
    return {
      kind: 'earth-orbit', altitudeKm: alt, eccentricity: p.eccentricity!.default, inclinationMode: 'sso',
      inclinationDeg: Number((sunSynchronousInclination(alt * 1000) ?? 98).toFixed(2)),
      localTimeOfNode: p.localTimeOfNode!.default, missionLifeYears: p.missionLifeYears!.default,
      orbitsBeforeTrim: p.orbitsBeforeTrim!.default, launchDate: '2027-06-15',
    };
  }
  if (p.type === 'lunar') {
    return {
      kind: 'lunar', parkingOrbitKm: p.parkingOrbitKm!.default, transfer: 'hohmann', lunarAltitudeKm: p.altitudeKm!.default,
      inclinationDeg: p.inclinationDeg!.default, tcmCount: p.tcmCount!.default, missionLifeMonths: p.missionLifeMonths!.default,
      launchDate: '2027-09-10',
    };
  }
  return {
    kind: 'interplanetary', trajectory: 'dveega', departureDate: p.departureDate!.default,
    perijoveAltitudeKm: p.perijoveAltitudeKm!.default, orbitPeriodDays: p.orbitPeriodDays!.default,
    inclinationDeg: p.inclinationDeg!.default, tcmCount: p.tcmCount!.default, scienceOrbits: p.scienceOrbits!.default,
  };
}

export function computeMissionProfile(
  mission: MissionSpec, plan: MissionPlan, assistance: AssistanceLevel, hasRadioNavigation: boolean,
): MissionProfile {
  const marginPct = mission.deltaVPolicy.marginPct[assistance];
  const phases: DeltaVPhase[] = [];
  const notes: string[] = [];
  let launchProfile: LaunchProfileId = mission.launchProfile;
  let targetAltitudeKm = 200;
  let launchInclinationDeg = 28.5;
  let capture: MissionProfile['capture'];
  let transferTimeS = 0;
  let c3: number | null = null;
  let window: MissionProfile['window'];

  if (plan.kind === 'earth-orbit') {
    const policy = mission.deltaVPolicy;
    targetAltitudeKm = plan.altitudeKm;
    const sso = sunSynchronousInclination(plan.altitudeKm * 1000, plan.eccentricity);
    launchInclinationDeg = plan.inclinationMode === 'sso' && sso !== null ? sso : plan.inclinationDeg;
    phases.push({ id: 'trim', label: 'Ajuste da órbita após a separação', dvMS: policy.injectionTrimMS ?? 10, status: 'didático', explanation: 'Corrige a dispersão da inserção do lançador.' });
    const makeup = dragMakeupPerYear(plan.altitudeKm) * plan.missionLifeYears;
    phases.push({ id: 'drag', label: `Compensação de arrasto (${plan.missionLifeYears} anos)`, dvMS: makeup, status: 'aproximado', explanation: `Densidade atmosférica a ${plan.altitudeKm} km (modelo exponencial) e coeficiente balístico de 100 kg/m².` });
    const r = BODIES.earth.radius + plan.altitudeKm * 1000;
    const deorbit = deorbitDeltaV(BODIES.earth.mu, r, BODIES.earth.radius + (policy.deorbitTargetPerigeeKm ?? 50) * 1000);
    phases.push({ id: 'deorbit', label: 'Desorbitar no fim da vida', dvMS: deorbit, status: 'derivado', explanation: `Queima retrógrada para perigeu de ${policy.deorbitTargetPerigeeKm} km (reentrada controlada).` });
    transferTimeS = 0;
  } else if (plan.kind === 'lunar') {
    const policy = mission.deltaVPolicy;
    const opt = mission.planning.transferOptions?.find((o) => o.id === plan.transfer);
    const tr = lunarTransfer(plan.parkingOrbitKm * 1000, plan.lunarAltitudeKm * 1000, opt?.apogeeFactor ?? 1);
    c3 = tr.c3KmS2;
    transferTimeS = tr.transferTimeS;
    targetAltitudeKm = plan.parkingOrbitKm;
    notes.push(`A injeção translunar (Δv ≈ ${tr.tliDeltaV.toFixed(0)} m/s a partir de ${plan.parkingOrbitKm} km) é executada pelo estágio superior do lançador, não pela sonda.`);
    const tcm = plan.tcmCount === 0 ? 0 : (policy.tcmBaseMS ?? 30) + (hasRadioNavigation ? 0 : policy.tcmNoRadioNavPenaltyMS ?? 40);
    phases.push({ id: 'tcm', label: `Correções de trajetória (${plan.tcmCount})`, dvMS: tcm, status: 'didático', explanation: hasRadioNavigation ? 'Navegação por ranging/Doppler reduz a dispersão.' : 'Sem ranging/Doppler, a órbita é determinada com menos precisão e as correções custam mais.' });
    phases.push({ id: 'loi', label: 'Inserção na órbita lunar (LOI)', dvMS: tr.loiDeltaV, status: 'derivado', explanation: `Captura de v∞ = ${(tr.vInfAtMoon / 1000).toFixed(2)} km/s para órbita circular de ${plan.lunarAltitudeKm} km (cônicas ajustadas).` });
    const months = plan.missionLifeMonths;
    const sk = (policy.stationKeepingMSPerMonthAt50km ?? 15) * (50 / Math.max(20, plan.lunarAltitudeKm)) * months;
    phases.push({ id: 'station', label: `Manutenção da órbita lunar (${months} meses)`, dvMS: sk, status: 'didático', explanation: 'Concentrações de massa (mascons) perturbam órbitas lunares baixas; taxa didática escalada pela altitude.' });
    const rLunar = BODIES.moon.radius + plan.lunarAltitudeKm * 1000;
    capture = { mu: BODIES.moon.mu, rp: rLunar, a: rLunar, dvMS: tr.loiDeltaV, bodyName: 'Lua' };
  } else {
    const policy = mission.deltaVPolicy;
    const opt = mission.planning.trajectoryOptions?.find((o) => o.id === plan.trajectory) ?? mission.planning.trajectoryOptions![0]!;
    launchProfile = opt.launchProfile;
    const win = jupiterWindow(new Date(`${plan.departureDate}T00:00:00Z`), opt.loopYears);
    c3 = opt.id === 'direct' ? win.transfer.c3KmS2 : 31;
    transferTimeS = win.transfer.transferTimeS + opt.loopYears * JULIAN_YEAR;
    window = {
      errorDays: win.windowErrorDays,
      toleranceDays: mission.planning.windowToleranceDays ?? 30,
      nearest: win.nearestWindow.toISOString().slice(0, 10),
      phasingDate: win.phasingDate.toISOString().slice(0, 10),
    };
    const tcm = plan.tcmCount === 0 ? 0 : (policy.tcmBaseMS ?? 50) + (hasRadioNavigation ? 0 : policy.tcmNoRadioNavPenaltyMS ?? 40);
    phases.push({ id: 'tcm', label: `Correções de trajetória (${plan.tcmCount})`, dvMS: tcm, status: 'didático', explanation: 'Correções durante o cruzeiro de vários anos.' });
    if (opt.dsmMS > 0) {
      phases.push({ id: 'dsm', label: 'Manobra de espaço profundo (DSM)', dvMS: opt.dsmMS, status: opt.dsmStatus, explanation: 'No ΔV-EGA a sonda parte com C3 baixo, executa uma DSM no afélio e retorna à Terra para uma assistência gravitacional.' });
    }
    const rp = BODIES.jupiter.radius + plan.perijoveAltitudeKm * 1000;
    const a = semiMajorAxisFromPeriod(BODIES.jupiter.mu, plan.orbitPeriodDays * DAY);
    const joi = captureDeltaV(BODIES.jupiter.mu, win.transfer.vInfArrival, rp, a);
    phases.push({ id: 'joi', label: 'Inserção na órbita de Júpiter (JOI)', dvMS: joi, status: 'derivado', explanation: `Captura de v∞ = ${(win.transfer.vInfArrival / 1000).toFixed(2)} km/s (Hohmann) em perijove de ${plan.perijoveAltitudeKm} km para órbita de ${plan.orbitPeriodDays} dias.` });
    phases.push({ id: 'cleanup', label: 'Correções em órbita e descarte final em Júpiter', dvMS: 60, status: 'didático', explanation: 'Ajustes de perijove e manobra final de descarte (proteção planetária).' });
    capture = { mu: BODIES.jupiter.mu, rp, a, dvMS: joi, bodyName: 'Júpiter' };
    notes.push(opt.id === 'direct'
      ? `Transferência direta exige C3 ≈ ${c3.toFixed(0)} km²/s² do lançador.`
      : 'Perfil ΔV-EGA: C3 de partida ≈ 31 km²/s² (aproximado, inspirado em perfis publicados), cruzeiro mais longo.');
  }

  const totalDvMS = phases.reduce((s, p) => s + p.dvMS, 0);
  return {
    launchProfile, targetAltitudeKm, launchInclinationDeg, phases, totalDvMS, marginPct,
    requiredDvMS: totalDvMS * (1 + marginPct / 100), capture, transferTimeS, c3KmS2: c3, notes, window,
  };
}
