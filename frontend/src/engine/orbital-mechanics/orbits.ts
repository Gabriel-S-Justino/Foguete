/**
 * Mecânica orbital de dois corpos e cônicas ajustadas (patched conics). Unidades SI.
 * Aproximações estão documentadas em docs/physics-model.md.
 */
import { constants } from '../catalog';
import { DAY, DEG, JULIAN_YEAR } from '../core/units';

export const BODIES = constants.bodies;
export const AU = constants.parameters.AU?.value ?? 149597870700;
export const SPEED_OF_LIGHT = constants.parameters.c?.value ?? 299792458;

export const circularVelocity = (mu: number, r: number): number => Math.sqrt(mu / r);
export const escapeVelocity = (mu: number, r: number): number => Math.sqrt((2 * mu) / r);
/** Equação vis-viva: v² = μ(2/r − 1/a). */
export const visViva = (mu: number, r: number, a: number): number => Math.sqrt(mu * (2 / r - 1 / a));
export const orbitalPeriod = (mu: number, a: number): number => 2 * Math.PI * Math.sqrt(a ** 3 / mu);
export const semiMajorAxisFromPeriod = (mu: number, periodS: number): number =>
  Math.cbrt((mu * periodS ** 2) / (4 * Math.PI ** 2));

export interface HohmannResult { dv1: number; dv2: number; total: number; transferTimeS: number }

/** Transferência de Hohmann entre órbitas circulares coplanares r1 → r2. */
export function hohmann(mu: number, r1: number, r2: number): HohmannResult {
  const at = (r1 + r2) / 2;
  const dv1 = Math.abs(visViva(mu, r1, at) - circularVelocity(mu, r1));
  const dv2 = Math.abs(circularVelocity(mu, r2) - visViva(mu, r2, at));
  return { dv1, dv2, total: dv1 + dv2, transferTimeS: Math.PI * Math.sqrt(at ** 3 / mu) };
}

/**
 * Inclinação heliossíncrona: a precessão nodal por J2 deve igualar a taxa média do Sol (360°/ano).
 * cos i = −(2/3)·Ω̇·a^(7/2)·(1−e²)² / (J2·R²·√μ)
 */
export function sunSynchronousInclination(altitudeM: number, eccentricity = 0): number | null {
  const earth = BODIES.earth;
  const a = earth.radius + altitudeM;
  const nodalRate = (2 * Math.PI) / (365.2421897 * DAY);
  const cosI = (-(2 / 3) * nodalRate * a ** 3.5 * (1 - eccentricity ** 2) ** 2) / ((earth.J2 ?? 1.08263e-3) * earth.radius ** 2 * Math.sqrt(earth.mu));
  if (cosI < -1 || cosI > 1) return null;
  return Math.acos(cosI) / DEG;
}

/** Taxa de precessão nodal por J2 (rad/s). */
export function nodalPrecessionRate(altitudeM: number, inclinationDeg: number, eccentricity = 0): number {
  const earth = BODIES.earth;
  const a = earth.radius + altitudeM;
  const n = Math.sqrt(earth.mu / a ** 3);
  return (-1.5 * n * (earth.J2 ?? 1.08263e-3) * (earth.radius / a) ** 2 * Math.cos(inclinationDeg * DEG)) / (1 - eccentricity ** 2) ** 2;
}

/** Latitude máxima sobrevoada por uma órbita de inclinação i (graus). */
export function maxLatitudeDeg(inclinationDeg: number): number {
  return inclinationDeg <= 90 ? inclinationDeg : 180 - inclinationDeg;
}

/**
 * Fração da órbita circular em eclipse (sombra cilíndrica), para o pior caso β = 0
 * (Sol no plano orbital). β é o ângulo entre o vetor Sol e o plano orbital.
 */
export function eclipseFraction(bodyRadius: number, orbitRadius: number, betaDeg = 0): number {
  const beta = betaDeg * DEG;
  const sinRho = bodyRadius / orbitRadius;
  const cosB = Math.cos(beta);
  if (cosB === 0) return 0;
  const arg = Math.sqrt(Math.max(0, 1 - sinRho ** 2)) / cosB;
  if (arg >= 1) return 0;
  return Math.acos(arg) / Math.PI;
}

/** Ângulo β aproximado para uma órbita heliossíncrona com o horário local do nodo dado (hh:mm). */
export function betaAngleForLocalTime(localTime: string): number {
  const [hh = '12', mm = '0'] = localTime.split(':');
  const hours = Number(hh) + Number(mm) / 60;
  // Ângulo horário entre o meio-dia local e o nodo; 12:00 → β≈0, 06:00/18:00 → β≈90° (órbita terminadora).
  return Math.abs(hours - 12) * 15;
}

/** Δv para desorbitar: queima retrógrada da órbita circular r para uma elipse com perigeu rp. */
export function deorbitDeltaV(mu: number, r: number, perigeeR: number): number {
  const a = (r + perigeeR) / 2;
  return circularVelocity(mu, r) - visViva(mu, r, a);
}

/** Δv de captura hiperbólica no periapse rp para uma órbita com semieixo maior a. */
export function captureDeltaV(mu: number, vInf: number, rp: number, aFinal: number): number {
  const vHyper = Math.sqrt(vInf ** 2 + (2 * mu) / rp);
  return vHyper - visViva(mu, rp, aFinal);
}

/** Δv de partida de uma órbita circular de estacionamento para atingir C3 (m²/s²). */
export function departureDeltaV(mu: number, rPark: number, c3: number): number {
  return Math.sqrt(c3 + (2 * mu) / rPark) - circularVelocity(mu, rPark);
}

export interface LunarTransfer {
  tliDeltaV: number;
  c3KmS2: number;
  vInfAtMoon: number;
  transferTimeS: number;
  loiDeltaV: number;
}

/**
 * Transferência Terra–Lua por cônicas ajustadas coplanares (modelo educacional).
 * apogeeFactor = 1 → apogeu na distância da Lua (quase-Hohmann); >1 → transferência mais rápida.
 */
export function lunarTransfer(parkingAltM: number, lunarAltM: number, apogeeFactor: number): LunarTransfer {
  const earth = BODIES.earth;
  const moon = BODIES.moon;
  const dMoon = moon.semiMajorAxisEarth ?? 384400000;
  const rp = earth.radius + parkingAltM;
  const ra = dMoon * apogeeFactor;
  const a = (rp + ra) / 2;
  const vp = visViva(earth.mu, rp, a);
  const tliDeltaV = vp - circularVelocity(earth.mu, rp);
  const energy = vp ** 2 / 2 - earth.mu / rp;
  // Velocidade e ângulo de trajetória ao cruzar a distância da Lua
  const vAtMoon = Math.sqrt(2 * (energy + earth.mu / dMoon));
  const h = rp * vp;
  const vTangential = h / dMoon;
  const vRadial = Math.sqrt(Math.max(0, vAtMoon ** 2 - vTangential ** 2));
  const vMoon = circularVelocity(earth.mu, dMoon);
  const vInfAtMoon = Math.hypot(vTangential - vMoon, vRadial);
  // Tempo de voo até r = dMoon (anomalia excêntrica)
  const e = (ra - rp) / (ra + rp);
  const cosE = (1 - dMoon / a) / e;
  const E = Math.acos(Math.min(1, Math.max(-1, cosE)));
  const transferTimeS = Math.sqrt(a ** 3 / earth.mu) * (E - e * Math.sin(E));
  const rLunar = moon.radius + lunarAltM;
  const loiDeltaV = captureDeltaV(moon.mu, vInfAtMoon, rLunar, rLunar);
  return { tliDeltaV, c3KmS2: (2 * energy) / 1e6, vInfAtMoon, transferTimeS, loiDeltaV };
}

export interface InterplanetaryTransfer {
  c3KmS2: number;
  vInfDeparture: number;
  vInfArrival: number;
  transferTimeS: number;
  requiredPhaseDeg: number;
}

/** Transferência de Hohmann heliocêntrica entre órbitas circulares coplanares (modelo educacional). */
export function interplanetaryHohmann(r1: number, r2: number, targetPeriodS: number): InterplanetaryTransfer {
  const mu = BODIES.sun.mu;
  const at = (r1 + r2) / 2;
  const vInfDeparture = Math.abs(visViva(mu, r1, at) - circularVelocity(mu, r1));
  const vInfArrival = Math.abs(circularVelocity(mu, r2) - visViva(mu, r2, at));
  const transferTimeS = Math.PI * Math.sqrt(at ** 3 / mu);
  const targetMotionDeg = (360 * transferTimeS) / targetPeriodS;
  return {
    c3KmS2: (vInfDeparture / 1000) ** 2,
    vInfDeparture,
    vInfArrival,
    transferTimeS,
    requiredPhaseDeg: 180 - targetMotionDeg,
  };
}

/** Longitudes médias J2000 e taxas (graus, graus/século) — JPL "Approximate Positions of the Planets". */
const MEAN_LONGITUDE = {
  earth: { L0: 100.46457166, rate: 35999.37244981 },
  jupiter: { L0: 34.39644051, rate: 3034.74612775 },
} as const;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export function meanLongitudeDeg(body: keyof typeof MEAN_LONGITUDE, date: Date): number {
  const centuries = (date.getTime() - J2000_MS) / 1000 / (36525 * DAY);
  const { L0, rate } = MEAN_LONGITUDE[body];
  return (((L0 + rate * centuries) % 360) + 360) % 360;
}

const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

export interface JupiterWindow {
  departure: Date;
  /** Data em que a geometria Terra–Júpiter deve ser a da transferência (partida direta ou sobrevoo da Terra). */
  phasingDate: Date;
  actualPhaseDeg: number;
  requiredPhaseDeg: number;
  phaseErrorDeg: number;
  /** Erro equivalente em dias de calendário (período sinódico). */
  windowErrorDays: number;
  nearestWindow: Date;
  transfer: InterplanetaryTransfer;
}

/** Janela Terra→Júpiter no modelo educacional de órbitas circulares coplanares. */
export function jupiterWindow(departure: Date, loopYears: number): JupiterWindow {
  const rE = BODIES.earth.semiMajorAxisSun ?? AU;
  const rJ = BODIES.jupiter.semiMajorAxisSun ?? 5.2 * AU;
  const periodJ = orbitalPeriod(BODIES.sun.mu, rJ);
  const transfer = interplanetaryHohmann(rE, rJ, periodJ);
  const phasingDate = new Date(departure.getTime() + loopYears * JULIAN_YEAR * 1000);
  const actual = wrap180(meanLongitudeDeg('jupiter', phasingDate) - meanLongitudeDeg('earth', phasingDate));
  const phaseErrorDeg = wrap180(actual - transfer.requiredPhaseDeg);
  const periodE = orbitalPeriod(BODIES.sun.mu, rE);
  const synodicS = 1 / (1 / periodE - 1 / periodJ);
  const relRateDegPerDay = (360 / synodicS) * DAY;
  // A fase relativa (Júpiter − Terra) diminui com o tempo; erro positivo => janela no futuro
  const daysToWindow = phaseErrorDeg / relRateDegPerDay;
  return {
    departure,
    phasingDate,
    actualPhaseDeg: actual,
    requiredPhaseDeg: transfer.requiredPhaseDeg,
    phaseErrorDeg,
    windowErrorDays: Math.abs(daysToWindow),
    nearestWindow: new Date(departure.getTime() + daysToWindow * DAY * 1000),
    transfer,
  };
}

/** Atraso de comunicação (s) para uma distância (m). */
export const lightTime = (distanceM: number): number => distanceM / SPEED_OF_LIGHT;

/** Distância Terra–Júpiter média (m), usada no enlace (aproximação: distância média ≈ 5,2 UA). */
export const earthJupiterMeanDistance = (): number => (BODIES.jupiter.semiMajorAxisSun ?? 5.2 * AU);

/** Elementos keplerianos a partir de estado 2D (r, v). */
export function elementsFromState(mu: number, x: number, y: number, vx: number, vy: number) {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);
  const h = x * vy - y * vx;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
  const rp = a * (1 - e);
  const ra = energy < 0 ? a * (1 + e) : Infinity;
  return { a, e, rp, ra, energy, h };
}
