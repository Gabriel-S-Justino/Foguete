/**
 * Posições heliocêntricas dos planetas numa data, pelos elementos keplerianos aproximados do JPL ("Approximate
 * Positions of the Planets", E. M. Standish, tabela 1, válida de 1800 a 2050; erros de alguns minutos de arco
 * para os planetas internos, suficientes para a visualização). Referencial: eclíptica e equinócio J2000, em
 * metros, com Z para o polo norte da eclíptica.
 */
import solarSystem from '@data/scientific-sources/solar-system.json';
import { AU } from './orbits';
import { type V3, rotate } from './kepler';

export type PlanetId = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';
export const PLANETS: PlanetId[] = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

export interface PlanetData {
  name: string;
  meanRadiusKm: number;
  equatorialDiameterKm: number;
  averageDistanceFromSunKm: number;
  rotationPeriodH: number;
  obliquityDeg: number;
  elementsJ2000: { aAU: number; e: number; iDeg: number; LDeg: number; longPeriDeg: number; longNodeDeg: number };
  ratesPerCentury: { aAU: number; e: number; iDeg: number; LDeg: number; longPeriDeg: number; longNodeDeg: number };
}

export const SOLAR_SYSTEM = solarSystem as unknown as {
  sun: { name: string; radiusKm: number };
  moon: { name: string; meanRadiusKm: number; semiMajorAxisKm: number; inclinationToEclipticDeg: number; siderealPeriodDays: number };
  obliquityJ2000Deg: number;
  planets: Record<PlanetId, PlanetData>;
};

const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
/** Obliquidade da eclíptica J2000 (rad). */
export const OBLIQUITY = SOLAR_SYSTEM.obliquityJ2000Deg * DEG;

/** Séculos julianos desde J2000 (TT ≈ UTC para esta precisão). */
export const centuriesSinceJ2000 = (date: Date): number => (date.getTime() - J2000_MS) / (36525 * 86400 * 1000);

/** Resolve a equação de Kepler M = E − e·sin E (rad). */
export function eccentricAnomaly(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** Posição heliocêntrica (m, eclíptica J2000) do planeta na data. */
export function planetPosition(id: PlanetId, date: Date): V3 {
  const p = SOLAR_SYSTEM.planets[id];
  const T = centuriesSinceJ2000(date);
  const el = p.elementsJ2000, rt = p.ratesPerCentury;
  const a = (el.aAU + rt.aAU * T) * AU;
  const e = el.e + rt.e * T;
  const I = (el.iDeg + rt.iDeg * T) * DEG;
  const L = el.LDeg + rt.LDeg * T;
  const varpi = el.longPeriDeg + rt.longPeriDeg * T;
  const Omega = (el.longNodeDeg + rt.longNodeDeg * T) * DEG;
  const omega = varpi * DEG - Omega;
  let M = ((L - varpi) % 360) * DEG;
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  const E = eccentricAnomaly(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega), sw = Math.sin(omega), cO = Math.cos(Omega), sO = Math.sin(Omega), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Velocidade heliocêntrica (m/s) por diferença central de ±1 h. */
export function planetVelocity(id: PlanetId, date: Date): V3 {
  const h = 3600;
  const a = planetPosition(id, new Date(date.getTime() - h * 1000));
  const b = planetPosition(id, new Date(date.getTime() + h * 1000));
  return [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h), (b[2] - a[2]) / (2 * h)];
}

/** Pontos da órbita do planeta (uma volta, a partir da data), para desenhar a órbita na visualização. */
export function planetOrbitPoints(id: PlanetId, date: Date, n = 256): V3[] {
  const p = SOLAR_SYSTEM.planets[id];
  const periodDays = 365.25 * Math.pow(p.elementsJ2000.aAU, 1.5);
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) out.push(planetPosition(id, new Date(date.getTime() + (i / n) * periodDays * 86400 * 1000)));
  return out;
}

/** Ângulo sideral de Greenwich (rad, 0–2π) na data (fórmula do IAU 1982 em dias desde J2000). */
export function greenwichSiderealAngle(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const deg = (280.46061837 + 360.98564736629 * (jd - 2451545)) % 360;
  return ((deg + 360) % 360) * DEG;
}

/** Converte um vetor do equador J2000 (ECI) para a eclíptica J2000. */
export const equatorialToEcliptic = (v: V3): V3 => rotate(v, [1, 0, 0], -OBLIQUITY);
/** Converte um vetor da eclíptica J2000 para o equador J2000 (ECI). */
export const eclipticToEquatorial = (v: V3): V3 => rotate(v, [1, 0, 0], OBLIQUITY);
