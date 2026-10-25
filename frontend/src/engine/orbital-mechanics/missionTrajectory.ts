/**
 * Linha do tempo física da missão em cônicas ajustadas (patched conics), da inserção em órbita até a órbita
 * final. Todos os estados estão no referencial inercial da eclíptica J2000 (m, m/s), relativos ao corpo
 * central de cada trecho; o tempo é contado em segundos a partir da inserção em órbita (época da missão).
 *
 * - Órbita de estacionamento (ou operacional): construída a partir do estado real de fim da subida
 *   (altitude, velocidade, ângulo de trajetória e inclinação), não de valores fixos.
 * - Volta completa: o instante em que a posição percorreu 360° em torno da Terra (ângulo varrido).
 * - Partida: a queima acontece na próxima passagem pelo ponto de queima depois da volta completa e do comando.
 * - Encontros (Lua, Terra na assistência gravitacional, Júpiter): hipérbole no corpo dentro da esfera de
 *   influência (SOI), ligada ao trecho anterior por Lambert com posição e velocidade contínuas na fronteira.
 *   O periapse e a inclinação são escolhidos pelo vetor B (plano B), como no projeto de missões reais.
 * - Manobras são impulsivas; a velocidade só muda nos instantes de manobra listados em `milestones`.
 */
import { BODIES } from './orbits';
import { add, cross, dot, elementsOf, lambert, norm, propagate, rotate, scale, sub, sweptAngle, unit, type State, type V3 } from './kepler';
import { equatorialToEcliptic, planetPosition, planetVelocity, eclipticToEquatorial } from './ephemeris';
import type { AttitudeMode } from './attitude';

export type CenterId = 'sun' | 'earth' | 'moon' | 'jupiter';
export type PhaseId = 'earth-orbit' | 'transfer' | 'cruise' | 'flyby' | 'approach' | 'final';

export const MU: Record<CenterId, number> = {
  sun: BODIES.sun.mu, earth: BODIES.earth.mu, moon: BODIES.moon.mu, jupiter: BODIES.jupiter.mu,
};
export const RADIUS: Record<CenterId, number> = {
  sun: BODIES.sun.radius, earth: BODIES.earth.radius, moon: BODIES.moon.radius, jupiter: BODIES.jupiter.radius,
};
/** Raio da esfera de influência (Laplace): a·(μ/μ_primário)^(2/5). */
export const SOI: Record<Exclude<CenterId, 'sun'>, number> = {
  earth: (BODIES.earth.semiMajorAxisSun ?? 1.496e11) * Math.pow(BODIES.earth.mu / BODIES.sun.mu, 0.4),
  moon: BODIES.moon.soiRadius ?? 66.1e6,
  jupiter: BODIES.jupiter.soiRadius ?? 48.2e9,
};

const DAY = 86400;
const YEAR = 365.25 * DAY;
const DEG = Math.PI / 180;

export interface Segment {
  id: string;
  label: string;
  center: CenterId;
  /** Início e fim (s desde a época); fim infinito para a órbita final. */
  t0: number;
  t1: number;
  /** Estado no início, relativo ao centro. */
  s0: State;
  phase: PhaseId;
  attitude: AttitudeMode;
}

export interface Milestone {
  id: string;
  t: number;
  label: string;
  /** burn: manobra (o relógio para até o jogador executar, se tiver `maneuverId`); patch: troca de corpo central. */
  kind: 'burn' | 'patch' | 'arrival' | 'revolution';
  maneuverId?: string;
  /** Δv geométrico desta trajetória (m/s), quando a manobra muda a velocidade. */
  dvMS?: number;
  center: CenterId;
}

/** Órbita circular da Lua usada na missão (plano e fase definidos pela janela de lançamento). */
export interface MoonOrbit { radius: number; rate: number; p: V3; q: V3; phase0: number }

export interface Insertion {
  /** Estado de fim da subida, do simulador de lançamento. */
  altitudeM: number;
  speedMS: number;
  flightPathDeg: number;
  inclinationDeg: number;
  downrangeM?: number;
}

export interface MissionTimeline {
  /** Época (ms UTC) do instante t = 0 (inserção em órbita). */
  epochMs: number;
  segments: Segment[];
  milestones: Milestone[];
  parking: { period: number; revolutionT: number; perigeeAltM: number; apogeeAltM: number; inclinationDeg: number };
  departure: { t: number; dvMS: number; c3KmS2: number; maneuverId: string; label: string } | null;
  destination: CenterId | null;
  arrival: { t: number; periapsisAltM: number; inclinationDeg: number; vInfMS: number } | null;
  moon: MoonOrbit;
  notes: string[];
}

export interface TimelineInput {
  kind: 'earth-orbit' | 'lunar' | 'interplanetary';
  /** Data de lançamento (AAAA-MM-DD). */
  launchDate: string;
  insertion: Insertion;
  /** Órbita de estacionamento: altitude alvo e inclinação de lançamento (para estados sem telemetria). */
  parkingAltitudeKm: number;
  launchInclinationDeg: number;
  /** Heliossíncrona: horário local do nodo ascendente (define o RAAN pelo Sol). */
  localTimeOfNode?: string;
  /** Lua: altitude e inclinação da órbita lunar, fator de apogeu da transferência. */
  lunarAltitudeKm?: number;
  lunarInclinationDeg?: number;
  apogeeFactor?: number;
  /** Júpiter. */
  trajectory?: 'dveega' | 'direct';
  c3KmS2?: number | null;
  loopYears?: number;
  perijoveAltitudeKm?: number;
  orbitPeriodDays?: number;
  jupiterInclinationDeg?: number;
  /** Manobras executáveis da sonda (para marcar as paradas do relógio). */
  maneuverIds: string[];
  /** Instante em que o jogador comandou a partida (s); sem comando, usa a primeira janela após a volta. */
  departureCommandT?: number | null;
  /** Resultado da inserção final (afeta só o trecho depois do periapse). */
  outcome?: 'captured' | 'high-orbit' | 'flyby';
}

// ---------------------------------------------------------------------------------------------------------
// Corpos

const dateAt = (epochMs: number, t: number) => new Date(epochMs + t * 1000);

/** Lua "real" aproximada para as missões que não vão à Lua: longitude média e nodo (Meeus, termos médios). */
export function meanMoonOrbit(epochMs: number): MoonOrbit {
  const d = (epochMs - Date.UTC(2000, 0, 1, 12)) / (DAY * 1000);
  const L = (218.316 + 13.176396 * d) * DEG;
  const node = (125.08 - 0.0529539 * d) * DEG;
  const inc = 5.145 * DEG;
  const nodeDir: V3 = [Math.cos(node), Math.sin(node), 0];
  const q0: V3 = rotate([-Math.sin(node), Math.cos(node), 0], nodeDir, inc);
  const radius = BODIES.moon.semiMajorAxisEarth ?? 384.4e6;
  return { radius, rate: Math.sqrt((BODIES.earth.mu + BODIES.moon.mu) / radius ** 3), p: nodeDir, q: q0, phase0: L - node };
}

export function moonState(m: MoonOrbit, t: number): State {
  const th = m.phase0 + m.rate * t;
  const c = Math.cos(th), s = Math.sin(th);
  return {
    r: add(scale(m.p, m.radius * c), scale(m.q, m.radius * s)),
    v: add(scale(m.p, -m.radius * m.rate * s), scale(m.q, m.radius * m.rate * c)),
  };
}

/** Estado heliocêntrico do centro de um trecho. */
export function centerState(tl: Pick<MissionTimeline, 'epochMs' | 'moon'>, center: CenterId, t: number): State {
  if (center === 'sun') return { r: [0, 0, 0], v: [0, 0, 0] };
  const date = dateAt(tl.epochMs, t);
  if (center === 'jupiter') return { r: planetPosition('jupiter', date), v: planetVelocity('jupiter', date) };
  const earth = { r: planetPosition('earth', date), v: planetVelocity('earth', date) };
  if (center === 'earth') return earth;
  const m = moonState(tl.moon, t);
  return { r: add(earth.r, m.r), v: add(earth.v, m.v) };
}

/** Estado de um corpo relativo a outro (ex.: Lua relativa à Terra). */
function relativeState(tl: Pick<MissionTimeline, 'epochMs' | 'moon'>, body: CenterId, center: CenterId, t: number): State {
  if (body === 'moon' && center === 'earth') return moonState(tl.moon, t);
  const a = centerState(tl, body, t), b = centerState(tl, center, t);
  return { r: sub(a.r, b.r), v: sub(a.v, b.v) };
}

// ---------------------------------------------------------------------------------------------------------
// Cônicas

/** Tempo até o próximo periapse (s); negativo se já passou do periapse numa hipérbole. */
export function timeToPeriapsis(mu: number, s: State): number {
  const el = elementsOf(mu, s);
  const e = el.e, nu = el.nu;
  if (e < 1) {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    let M = E - e * Math.sin(E);
    if (M < 0) M += 2 * Math.PI;
    const n = Math.sqrt(mu / el.a ** 3);
    return (2 * Math.PI - M) / n;
  }
  const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
  const M = e * Math.sinh(F) - F;
  const n = Math.sqrt(mu / (-el.a) ** 3);
  return -M / n;
}

/** Tempo de voo do periapse até o raio r numa hipérbole (s). */
function hyperbolicTimeFromPeri(mu: number, rp: number, vInf: number, r: number): number {
  const a = -mu / (vInf * vInf);
  const e = 1 - rp / a;
  const coshF = (1 - r / a) / e;
  const F = Math.acosh(Math.max(1, coshF));
  const n = Math.sqrt(mu / (-a) ** 3);
  return (e * Math.sinh(F) - F) / n;
}

export interface Hyperbola { peri: State; entry: State; dtEntryToPeri: number; rp: number; e: number; h: V3 }

/**
 * Hipérbole de chegada a partir da velocidade de excesso (vInf, sentido de chegada), do raio do periapse e da
 * normal do plano da trajetória (perpendicular a vInf). Devolve o estado no periapse e na entrada da SOI.
 */
export function hyperbolaFromAsymptote(mu: number, vInf: V3, rp: number, hHat: V3, soi: number): Hyperbola {
  const S = unit(vInf);
  const vi = norm(vInf);
  const e = 1 + (rp * vi * vi) / mu;
  const nuInf = Math.acos(-1 / e);
  const h = unit(sub(hHat, scale(S, dot(hHat, S))));
  // A posição chega de −S (no infinito); o periapse fica a ν∞ adiante, girando em torno da normal
  const pHat = rotate(scale(S, -1), h, nuInf);
  const vp = Math.sqrt(vi * vi + (2 * mu) / rp);
  const peri: State = { r: scale(pHat, rp), v: scale(cross(h, pHat), vp) };
  const dt = hyperbolicTimeFromPeri(mu, rp, vi, soi);
  return { peri, entry: propagate(mu, peri, -dt), dtEntryToPeri: dt, rp, e, h };
}

/** Normal do plano da hipérbole para uma inclinação desejada em relação a um plano de referência (normal n). */
export function normalForInclination(vInf: V3, n: V3, inclDeg: number): V3 {
  const S = unit(vInf);
  let T = cross(S, n);
  if (norm(T) < 1e-9) T = cross(S, [1, 0, 0]);
  T = unit(T);
  const R = cross(S, T);
  const i = inclDeg * DEG;
  const B = add(scale(T, Math.cos(i)), scale(R, Math.sin(i)));
  return unit(cross(B, S));
}

/** Raio de periapse para girar vIn até a direção de vOut num sobrevoo sem propulsão. */
function flybyPeriapsis(mu: number, vIn: V3, vOut: V3): number {
  const delta = Math.acos(Math.max(-1, Math.min(1, dot(unit(vIn), unit(vOut)))));
  const e = 1 / Math.sin(Math.max(1e-6, delta / 2));
  const v = (norm(vIn) + norm(vOut)) / 2;
  return (mu * (e - 1)) / (v * v);
}

/** Primeiro instante em [t0, t1] em que f(t) ≤ 0 (amostragem + bissecção); null se não houver. */
function firstRoot(f: (t: number) => number, t0: number, t1: number, n: number): number | null {
  let a = t0, fa = f(t0);
  if (fa <= 0) return t0;
  for (let i = 1; i <= n; i++) {
    const b = t0 + ((t1 - t0) * i) / n;
    const fb = f(b);
    if (fb <= 0) {
      let lo = a, hi = b;
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        if (f(m) <= 0) hi = m; else lo = m;
      }
      return hi;
    }
    a = b; fa = fb;
  }
  void fa;
  return null;
}

/**
 * Trecho que termina num encontro: Lambert de (r0, t0) até a entrada da SOI de uma hipérbole projetada para
 * o periapse em tPeri. Itera a velocidade de excesso até a velocidade de chegada do Lambert coincidir com a
 * da hipérbole na fronteira da SOI (posição e velocidade contínuas).
 */
function legToEncounter(
  tl: Pick<MissionTimeline, 'epochMs' | 'moon'>, center: CenterId, body: Exclude<CenterId, 'sun'>, r0: V3, t0: number,
  tPeri: number, rp: number | ((vInf: V3) => number), normalFor: (vInf: V3) => V3,
): { v1: V3; hyp: Hyperbola; tIn: number } {
  const rpOf = (v: V3) => (typeof rp === 'number' ? rp : rp(v));
  const mu = MU[center], muB = MU[body], soi = SOI[body];
  const bodyAt = (t: number) => relativeState(tl, body, center, t);
  const b0 = bodyAt(tPeri);
  let vInf = sub(lambert(mu, r0, b0.r, tPeri - t0).v2, b0.v);
  let out: { v1: V3; hyp: Hyperbola; tIn: number } | null = null;
  for (let k = 0; k < 40; k++) {
    const hyp = hyperbolaFromAsymptote(muB, vInf, rpOf(vInf), normalFor(vInf), soi);
    const tIn = tPeri - hyp.dtEntryToPeri;
    const b = bodyAt(tIn);
    const sol = lambert(mu, r0, add(b.r, hyp.entry.r), tIn - t0);
    const vRel = sub(sol.v2, b.v);
    const err = sub(vRel, hyp.entry.v);
    out = { v1: sol.v1, hyp, tIn };
    if (norm(err) < 1e-4) break;
    vInf = add(vInf, err);
  }
  return out!;
}

// ---------------------------------------------------------------------------------------------------------
// Órbita de estacionamento

function hhmmToHours(s: string | undefined): number {
  const [h = '10', m = '30'] = (s ?? '10:30').split(':');
  return Number(h) + Number(m) / 60;
}

/** Direção da Terra para o Sol (eclíptica) na data. */
function sunDirection(epochMs: number, t: number): V3 {
  return unit(scale(planetPosition('earth', dateAt(epochMs, t)), -1));
}

/**
 * Estado na inserção (Terra, eclíptica J2000). RAAN: heliossíncrona pelo horário local do nodo; nas demais,
 * o plano escolhido pela missão (Júpiter: contém a direção de partida).
 */
function parkingState(input: TimelineInput, epochMs: number, raanDeg: number): State {
  const ins = input.insertion;
  const i = ins.inclinationDeg * DEG;
  const raan = raanDeg * DEG;
  const node: V3 = [Math.cos(raan), Math.sin(raan), 0];
  const nrm: V3 = [Math.sin(i) * Math.sin(raan), -Math.sin(i) * Math.cos(raan), Math.cos(i)];
  // Argumento de latitude na inserção: a subida parte perto do nodo ascendente e percorre o alcance
  const u = (ins.downrangeM ?? 1.8e6) / BODIES.earth.radius + 0.35;
  const rHat = rotate(node, nrm, u);
  const tHat = cross(nrm, rHat);
  const r = BODIES.earth.radius + ins.altitudeM;
  // Estado não ligado (velocidade de escape) não tem volta a contar: vira órbita circular na mesma altitude
  const bound = Number.isFinite(ins.speedMS) && ins.speedMS ** 2 < (2 * BODIES.earth.mu) / r;
  const speed = bound ? ins.speedMS : Math.sqrt(BODIES.earth.mu / r);
  const g = bound ? ins.flightPathDeg * DEG : 0;
  const rEq = scale(rHat, r);
  const vEq = add(scale(tHat, speed * Math.cos(g)), scale(rHat, speed * Math.sin(g)));
  void epochMs;
  return { r: equatorialToEcliptic(rEq), v: equatorialToEcliptic(vEq) };
}

/** RAAN (graus, equador J2000) com o nodo ascendente no horário local dado. */
function sunSyncRaan(epochMs: number, localTime: string | undefined): number {
  const s = eclipticToEquatorial(sunDirection(epochMs, 0));
  const raSun = Math.atan2(s[1], s[0]) / DEG;
  return raSun + (hhmmToHours(localTime) - 12) * 15;
}

/** RAAN para que o plano (inclinação i) contenha a direção d (equador); a mais próxima se impossível. */
function raanContaining(d: V3, inclDeg: number): number {
  const i = inclDeg * DEG;
  let best = 0, bestErr = Infinity;
  for (let k = 0; k < 3600; k++) {
    const raan = (k / 10) * DEG;
    const n: V3 = [Math.sin(i) * Math.sin(raan), -Math.sin(i) * Math.cos(raan), Math.cos(i)];
    const err = Math.abs(dot(n, d));
    if (err < bestErr) { bestErr = err; best = raan; }
  }
  return best / DEG;
}

/** Instante em que a posição completa 360° a partir de t0 (ângulo varrido, não período nominal). */
export function revolutionTime(mu: number, s0: State, t0 = 0): number {
  const h = cross(s0.r, s0.v);
  const period = elementsOf(mu, s0).period;
  // Acumula o ângulo varrido em passos curtos e refina por bissecção no fim
  const n = 720;
  let swept = 0, prev = s0.r, t = t0;
  const dt = period / n;
  for (let k = 1; k <= n + 10; k++) {
    const cur = propagate(mu, s0, k * dt).r;
    const d = sweptAngle(prev, cur, h);
    if (swept + d >= 2 * Math.PI) {
      let lo = (k - 1) * dt, hi = k * dt;
      for (let j = 0; j < 50; j++) {
        const m = (lo + hi) / 2;
        const ang = swept + sweptAngle(prev, propagate(mu, s0, m).r, h);
        if (ang >= 2 * Math.PI) hi = m; else lo = m;
      }
      return t0 + hi;
    }
    swept += d;
    prev = cur;
    t = t0 + k * dt;
  }
  return t;
}

/** Próxima passagem (t ≥ tMin) pela direção dHat no plano da órbita. */
function nextPassage(mu: number, s0: State, dHat: V3, tMin: number): number {
  const h = unit(cross(s0.r, s0.v));
  const d = unit(sub(dHat, scale(h, dot(dHat, h))));
  const ang = (t: number) => {
    const r = propagate(mu, s0, t).r;
    return sweptAngle(r, d, h); // quanto falta para chegar à direção
  };
  const period = elementsOf(mu, s0).period;
  // Ângulo restante decresce com o tempo; a raiz é onde ele "salta" de ~0 para ~2π
  const n = 400;
  let prev = ang(tMin);
  for (let k = 1; k <= n; k++) {
    const t = tMin + (period * k) / n;
    const a = ang(t);
    if (a > prev + Math.PI) {
      let lo = t - period / n, hi = t;
      for (let j = 0; j < 60; j++) {
        const m = (lo + hi) / 2;
        if (ang(m) > Math.PI) hi = m; else lo = m;
      }
      return lo;
    }
    prev = a;
  }
  return tMin;
}

// ---------------------------------------------------------------------------------------------------------
// Construção

/** Monta a linha do tempo da missão. Função pura e determinística (mesma entrada, mesma trajetória). */
export function buildTimeline(input: TimelineInput): MissionTimeline {
  const epochMs = Date.parse(`${input.launchDate}T00:00:00Z`) + 12 * 3600 * 1000;
  const tlBase = { epochMs, moon: meanMoonOrbit(epochMs) };
  const notes: string[] = [];
  const muE = MU.earth;
  const has = (id: string) => input.maneuverIds.includes(id);

  // Plano da órbita de estacionamento
  let raanDeg = 0;
  let jupiterPlan: ReturnType<typeof planJupiter> | null = null;
  if (input.kind === 'earth-orbit') raanDeg = sunSyncRaan(epochMs, input.localTimeOfNode);
  if (input.kind === 'interplanetary') {
    jupiterPlan = planJupiter(input, epochMs);
    raanDeg = raanContaining(eclipticToEquatorial(unit(jupiterPlan.vInf)), input.insertion.inclinationDeg);
  }
  const s0 = parkingState(input, epochMs, raanDeg);
  const el0 = elementsOf(muE, s0);
  const revT = revolutionTime(muE, s0);
  const parking = {
    period: el0.period, revolutionT: revT,
    perigeeAltM: el0.rp - RADIUS.earth, apogeeAltM: el0.ra - RADIUS.earth, inclinationDeg: input.insertion.inclinationDeg,
  };
  const parkingSeg = (t1: number, label: string, attitude: AttitudeMode): Segment => ({
    id: 'parking', label, center: 'earth', t0: 0, t1, s0, phase: 'earth-orbit', attitude,
  });
  const milestones: Milestone[] = [{ id: 'earth-orbit-rev', t: revT, label: 'Primeira volta completa em torno da Terra', kind: 'revolution', center: 'earth' }];

  if (input.kind === 'earth-orbit') {
    return {
      epochMs, segments: [parkingSeg(Infinity, 'Órbita operacional', 'nadir')], milestones,
      parking, departure: null, destination: 'earth', arrival: null, moon: tlBase.moon, notes,
    };
  }
  const tReady = Math.max(revT, input.departureCommandT ?? revT);

  if (input.kind === 'lunar') return buildLunar(input, epochMs, s0, parking, milestones, tReady, notes, has);
  return buildJupiter(input, epochMs, tlBase.moon, s0, parking, milestones, tReady, notes, has, jupiterPlan!);
}

type Parking = MissionTimeline['parking'];

function buildLunar(
  input: TimelineInput, epochMs: number, s0: State, parking: Parking, milestones: Milestone[], tReady: number,
  notes: string[], has: (id: string) => boolean,
): MissionTimeline {
  const muE = MU.earth, muM = MU.moon;
  const d = BODIES.moon.semiMajorAxisEarth ?? 384.4e6;
  const hPark = unit(cross(s0.r, s0.v));
  const rPark = norm(s0.r);
  // Transferência: apogeu um pouco além da Lua (a sonda cruza a órbita lunar antes do apogeu, sem a geometria
  // degenerada de 180° de uma Hohmann exata)
  const ra = Math.max(input.apogeeFactor ?? 1, 1.08) * d;
  const a = (rPark + ra) / 2, e = (ra - rPark) / (ra + rPark);
  const nuStar = Math.acos(((a * (1 - e * e)) / d - 1) / e);
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nuStar / 2));
  const tof = (E - e * Math.sin(E)) / Math.sqrt(muE / a ** 3);
  const rpL = RADIUS.moon + (input.lunarAltitudeKm ?? 50) * 1000;
  const inclL = input.lunarInclinationDeg ?? 90;

  // Janela de lançamento: a Lua (órbita circular) fica no plano da órbita de estacionamento, na fase em que a
  // primeira oportunidade depois da volta completa leva a sonda até ela. O plano é inclinado de δ em torno da
  // linha a 90° do ponto de chegada para que o vetor B fora do plano não exija mudança de plano na injeção.
  const tDnom = nextPassage(muE, s0, s0.r, tReady) + parking.period * 0.25;
  const rB = propagate(muE, s0, tDnom).r;
  const uArr = unit(rotate(rB, hPark, nuStar));
  const qArr = cross(hPark, uArr);
  const rate = Math.sqrt((muE + muM) / d ** 3);
  const moonFor = (delta: number): MoonOrbit => {
    const p = unit(add(scale(uArr, Math.cos(delta)), scale(hPark, Math.sin(delta))));
    return { radius: d, rate, p, q: qArr, phase0: -rate * (tDnom + tof) };
  };
  let moon = moonFor(0);
  const tlOf = (m: MoonOrbit) => ({ epochMs, moon: m });
  const nMoon = () => unit(cross(moon.p, moon.q));
  // δ: o ponto de entrada na SOI deve ficar no plano de estacionamento
  for (let k = 0; k < 4; k++) {
    const leg = legToEncounter(tlOf(moon), 'earth', 'moon', rB, tDnom, tDnom + tof, rpL, (v) => normalForInclination(v, nMoon(), inclL));
    const target = add(moonState(moon, leg.tIn).r, leg.hyp.entry.r);
    const z = dot(target, hPark);
    const delta = Math.asin(Math.max(-0.2, Math.min(0.2, Math.asin(dot(moon.p, hPark)) - z / d)));
    moon = moonFor(delta);
  }

  // Oportunidade real: a primeira em que o ângulo sonda → Lua na chegada vale ν* (depois de tReady)
  const angleErr = (t: number) => {
    const r = propagate(muE, s0, t).r;
    const m = moonState(moon, t + tof).r;
    const mIn = sub(m, scale(hPark, dot(m, hPark)));
    let ang = sweptAngle(r, mIn, hPark) - nuStar;
    while (ang > Math.PI) ang -= 2 * Math.PI;
    while (ang < -Math.PI) ang += 2 * Math.PI;
    return ang;
  };
  let tD = tDnom;
  if (tReady > tDnom - 1) {
    const step = parking.period / 60;
    let t = tReady, prev = angleErr(t);
    for (let k = 0; k < 600; k++) {
      const t2 = t + step;
      const cur = angleErr(t2);
      if (prev > 0 && cur <= 0 && prev - cur < Math.PI) {
        let lo = t, hi = t2;
        for (let j = 0; j < 60; j++) { const m = (lo + hi) / 2; if (angleErr(m) > 0) lo = m; else hi = m; }
        tD = hi;
        break;
      }
      t = t2; prev = cur;
    }
  }
  const tl = tlOf(moon);
  const park = propagate(muE, s0, tD);
  const leg = legToEncounter(tl, 'earth', 'moon', park.r, tD, tD + tof, rpL, (v) => normalForInclination(v, nMoon(), inclL));
  const tliDv = norm(sub(leg.v1, park.v));
  const tPeri = leg.tIn + leg.hyp.dtEntryToPeri;
  const segments: Segment[] = [
    { id: 'parking', label: 'Órbita de estacionamento (sonda acoplada ao estágio superior)', center: 'earth', t0: 0, t1: tD, s0, phase: 'earth-orbit', attitude: 'prograde' },
    { id: 'tli', label: 'Transferência translunar', center: 'earth', t0: tD, t1: leg.tIn, s0: { r: park.r, v: leg.v1 }, phase: 'transfer', attitude: 'sun' },
  ];
  milestones.push({ id: 'departure-burn', t: tD, label: `Injeção translunar pelo estágio superior (Δv ${tliDv.toFixed(0)} m/s)`, kind: 'burn', dvMS: tliDv, center: 'earth' });
  milestones.push({ id: 'separation', t: tD + 600, label: 'Separação da sonda', kind: 'patch', center: 'earth' });
  if (has('tcm')) milestones.push({ id: 'tcm', t: tD + DAY, label: 'Correção de trajetória', kind: 'burn', maneuverId: 'tcm', center: 'earth' });
  milestones.push({ id: 'soi-moon', t: leg.tIn, label: 'Entrada na esfera de influência da Lua', kind: 'patch', center: 'moon' });
  const out = arrivalSegments('moon', leg.hyp, leg.tIn, input.outcome ?? 'captured', 'loi', has('loi'), 'Inserção na órbita lunar', 'nadir', null, milestones);
  segments.push(...out);
  notes.push(`Injeção translunar calculada: Δv ${tliDv.toFixed(0)} m/s a partir de ${(parking.perigeeAltM / 1000).toFixed(0)} km, voo de ${((tPeri - tD) / DAY).toFixed(1)} dias.`);
  const el = elementsOf(muM, leg.hyp.peri);
  return {
    epochMs, segments, milestones, parking,
    departure: { t: tD, dvMS: tliDv, c3KmS2: (norm(leg.v1) ** 2 - (2 * muE) / norm(park.r)) / 1e6, maneuverId: 'departure-burn', label: 'Injeção translunar (estágio superior)' },
    destination: 'moon',
    arrival: { t: tPeri, periapsisAltM: el.rp - RADIUS.moon, inclinationDeg: Math.acos(Math.max(-1, Math.min(1, dot(unit(el.h), nMoon())))) / DEG, vInfMS: Math.sqrt(Math.max(0, -muM / el.a)) },
    moon, notes,
  };
}

/**
 * Trechos depois da entrada na SOI do destino: hipérbole até o periapse e, conforme o resultado da queima de
 * inserção, órbita capturada (planejada ou mais alta) ou sobrevoo.
 */
function arrivalSegments(
  body: 'moon' | 'jupiter', hyp: Hyperbola, tIn: number, outcome: 'captured' | 'high-orbit' | 'flyby', maneuverId: string,
  executable: boolean, label: string, attitude: AttitudeMode, captureA: number | null, milestones: Milestone[],
): Segment[] {
  const mu = MU[body];
  const tPeri = tIn + hyp.dtEntryToPeri;
  const deName = body === 'moon' ? 'da Lua' : 'de Júpiter';
  const segs: Segment[] = [{ id: 'approach', label: `Aproximação ${deName}`, center: body, t0: tIn, t1: tPeri, s0: hyp.entry, phase: 'approach', attitude: 'sun' }];
  const vp = norm(hyp.peri.v), rp = hyp.rp;
  const vEsc = Math.sqrt((2 * mu) / rp);
  // Órbita planejada: circular (Lua) ou elipse com o período escolhido (Júpiter)
  const vPlan = captureA ? Math.sqrt(mu * (2 / rp - 1 / captureA)) : Math.sqrt(mu / rp);
  const dir = unit(hyp.peri.v);
  let vAfter = vPlan;
  if (outcome === 'high-orbit') vAfter = vPlan + 0.6 * (vEsc - vPlan);
  if (outcome === 'flyby') vAfter = vp;
  milestones.push({ id: maneuverId, t: tPeri, label, kind: 'burn', maneuverId: executable ? maneuverId : undefined, dvMS: vp - vPlan, center: body });
  const finalState: State = { r: hyp.peri.r, v: scale(dir, vAfter) };
  segs.push({
    id: outcome === 'flyby' ? 'flyby' : 'final', label: outcome === 'flyby' ? `Sobrevoo ${deName} (captura falhou)` : outcome === 'high-orbit' ? `Órbita ${deName} mais alta que a planejada` : `Órbita ${deName}`,
    center: body, t0: tPeri, t1: Infinity, s0: finalState, phase: outcome === 'flyby' ? 'flyby' : 'final', attitude,
  });
  return segs;
}

interface EgaPick { tDsm: number; tEga: number; tA: number; vOut: V3; cost: number }

/** Transferências Terra → Júpiter (Lambert) partindo em tEga, para cada tempo de voo; guardadas por data. */
function transfersFrom(epochMs: number, tEga: number, cache: Map<number, { tA: number; vo: V3; va: number }[]>) {
  const key = Math.round(tEga / 3600);
  let list = cache.get(key);
  if (!list) {
    list = [];
    const E = { r: planetPosition('earth', dateAt(epochMs, tEga)), v: planetVelocity('earth', dateAt(epochMs, tEga)) };
    for (let days = 500; days <= 1400; days += 10) {
      const tA = tEga + days * DAY;
      const rJ = planetPosition('jupiter', dateAt(epochMs, tA));
      if (Math.abs(sweptAngle(E.r, rJ, [0, 0, 1]) - Math.PI) < 6 * DEG) continue;
      try {
        const sol = lambert(MU.sun, E.r, rJ, tA - tEga);
        list.push({ tA, vo: sub(sol.v1, E.v), va: norm(sub(sol.v2, planetVelocity('jupiter', dateAt(epochMs, tA)))) });
      } catch { /* geometria degenerada */ }
    }
    cache.set(key, list);
  }
  return list;
}

/**
 * Busca do ΔV-EGA: instante da DSM (fração do período do laço) e data do sobrevoo da Terra. Custo: Δv da DSM
 * mais o que o sobrevoo sem propulsão não consegue fazer (diferença de módulo de v∞ e giro além do possível
 * com periapse ≥ 800 km) mais uma parcela do v∞ de chegada a Júpiter (custo da JOI).
 */
function searchEga(epochMs: number, t0: number, helio0: State, years: number[], fracs: number[], cache: Map<number, { tA: number; vo: V3; va: number }[]>): EgaPick | null {
  const muS = MU.sun, muE = MU.earth;
  const rpE = RADIUS.earth + 800e3;
  const period = elementsOf(muS, helio0).period;
  let pick: EgaPick | null = null;
  for (const y of years) {
    const tEga = y;
    const E = { r: planetPosition('earth', dateAt(epochMs, tEga)), v: planetVelocity('earth', dateAt(epochMs, tEga)) };
    const outs = transfersFrom(epochMs, tEga, cache);
    if (!outs.length) continue;
    for (const f of fracs) {
      const t = t0 + period * f;
      if (t > tEga - 30 * DAY) continue;
      const st = propagate(muS, helio0, t - t0);
      if (Math.abs(sweptAngle(st.r, E.r, [0, 0, 1]) - Math.PI) < 6 * DEG) continue;
      let sol: { v1: V3; v2: V3 };
      try { sol = lambert(muS, st.r, E.r, tEga - t); } catch { continue; }
      const vIn = sub(sol.v2, E.v);
      const v = norm(vIn);
      const dsm = norm(sub(sol.v1, st.v));
      const turnMax = 2 * Math.asin(1 / (1 + (rpE * v * v) / muE));
      for (const o of outs) {
        const turn = Math.acos(Math.max(-1, Math.min(1, dot(unit(vIn), unit(o.vo)))));
        const cost = dsm + Math.abs(v - norm(o.vo)) + Math.max(0, turn - turnMax) * v + 0.15 * o.va;
        if (!pick || cost < pick.cost) pick = { tDsm: t, tEga, tA: o.tA, vOut: o.vo, cost };
      }
    }
  }
  return pick;
}

const range = (a: number, b: number, step: number) => { const out: number[] = []; for (let x = a; x <= b + 1e-9; x += step) out.push(x); return out; };

/** Projeto heliocêntrico preliminar de Júpiter (para escolher o plano da órbita de estacionamento). */
function planJupiter(input: TimelineInput, epochMs: number): { tD: number; vInf: V3; tA: number; ega: EgaPick | null } {
  const tD = 2 * 3600;
  const date = (t: number) => dateAt(epochMs, t);
  const rE = planetPosition('earth', date(tD));
  const vE = planetVelocity('earth', date(tD));
  if (input.trajectory !== 'direct') {
    // C3 do perfil; a direção do v∞ no plano da eclíptica ajusta o período do laço (alavancagem de v∞)
    const vi = Math.sqrt((input.c3KmS2 ?? 31) * 1e6);
    const loop = (input.loopYears ?? 2) * YEAR;
    const cache = new Map<number, { tA: number; vo: V3; va: number }[]>();
    let best: { vInf: V3; ega: EgaPick } | null = null;
    for (let a = -45; a <= 45; a += 5) {
      const vInf = rotate(scale(unit(vE), vi), [0, 0, 1], a * DEG);
      const ega = searchEga(epochMs, tD, { r: rE, v: add(vE, vInf) }, range(tD + loop - 0.4 * YEAR, tD + loop + 0.6 * YEAR, 0.05 * YEAR), range(0.3, 0.7, 0.02), cache);
      if (ega && (!best || ega.cost < best.ega.cost)) best = { vInf, ega };
    }
    if (!best) return { tD, vInf: scale(unit(vE), vi), tA: 0, ega: null };
    return { tD, vInf: best.vInf, tA: best.ega.tA, ega: best.ega };
  }
  const best = bestTransfer(epochMs, tD, rE, vE, null);
  return { tD, vInf: best.vInfDep, tA: best.tA, ega: null };
}

/** Escolhe o tempo de voo Terra → Júpiter (Lambert) com menor v∞ somado (ou v∞ de partida próximo do alvo). */
function bestTransfer(epochMs: number, t0: number, r0: V3, v0: V3, vInfTarget: number | null): { tA: number; vInfDep: V3; vInfArr: V3 } {
  const muS = MU.sun;
  let best: { tA: number; vInfDep: V3; vInfArr: V3; cost: number } | null = null;
  for (let days = 500; days <= 1400; days += 5) {
    const tA = t0 + days * DAY;
    const rJ = planetPosition('jupiter', dateAt(epochMs, tA));
    const dth = sweptAngle(r0, rJ, [0, 0, 1]);
    if (Math.abs(dth - Math.PI) < 6 * DEG) continue;
    try {
      const sol = lambert(muS, r0, rJ, tA - t0);
      const vInfDep = sub(sol.v1, v0);
      const vInfArr = sub(sol.v2, planetVelocity('jupiter', dateAt(epochMs, tA)));
      const cost = vInfTarget === null ? norm(vInfDep) + norm(vInfArr) : Math.abs(norm(vInfDep) - vInfTarget) * 4 + norm(vInfArr) * 0.3;
      if (!best || cost < best.cost) best = { tA, vInfDep, vInfArr, cost };
    } catch { /* geometria degenerada: ignora este tempo de voo */ }
  }
  if (!best) throw new Error('Sem transferência Terra → Júpiter');
  return best;
}

function buildJupiter(
  input: TimelineInput, epochMs: number, moon: MoonOrbit, s0: State, parking: Parking, milestones: Milestone[], tReady: number,
  notes: string[], has: (id: string) => boolean, plan: ReturnType<typeof planJupiter>,
): MissionTimeline {
  const tl = { epochMs, moon };
  const muE = MU.earth, muS = MU.sun, muJ = MU.jupiter;
  const date = (t: number) => dateAt(epochMs, t);
  const earth = (t: number) => centerState(tl, 'earth', t);
  const rpJ = RADIUS.jupiter + (input.perijoveAltitudeKm ?? 4200) * 1000;
  const aJ = Math.cbrt(muJ * ((input.orbitPeriodDays ?? 53) * DAY / (2 * Math.PI)) ** 2);
  const jNormal = unit(cross(planetPosition('jupiter', date(0)), planetVelocity('jupiter', date(0))));
  const jNormalFor = (v: V3) => normalForInclination(v, jNormal, input.jupiterInclinationDeg ?? 90);
  const hPark = unit(cross(s0.r, s0.v));
  const rPark = norm(s0.r);
  const dveega = input.trajectory !== 'direct';

  /** Hipérbole de partida: queima tangencial no ponto que leva a assíntota para vInf (projetada no plano). */
  /**
   * Hipérbole de partida com o periapse na órbita de estacionamento e a assíntota em vInf. Se vInf sai do plano
   * da órbita, o plano da hipérbole é girado em torno do ponto de queima (a queima inclui a mudança de plano).
   */
  const departFor = (vInf: V3, tMin: number) => {
    const vi = norm(vInf);
    const S = unit(vInf);
    const e = 1 + (rPark * vi * vi) / muE;
    const nuInf = Math.acos(-1 / e);
    const hPerp = sub(hPark, scale(S, dot(hPark, S)));
    const e1 = unit(hPerp), e2 = cross(S, e1);
    const alpha = Math.max(-0.999, Math.min(0.999, (-dot(S, hPark) / Math.tan(nuInf)) / Math.max(1e-9, norm(hPerp))));
    let w = add(scale(e1, alpha), scale(e2, Math.sqrt(1 - alpha * alpha)));
    if (dot(cross(w, S), hPark) < 0) w = add(scale(e1, alpha), scale(e2, -Math.sqrt(1 - alpha * alpha)));
    const nHyp = unit(cross(w, S));
    const pHat = unit(add(scale(S, Math.cos(nuInf)), scale(w, Math.sin(nuInf))));
    const tD = nextPassage(muE, s0, pHat, tMin);
    const st = propagate(muE, s0, tD);
    const vp = Math.sqrt(vi * vi + (2 * muE) / norm(st.r));
    const v = scale(unit(cross(nHyp, st.r)), vp);
    const dt = hyperbolicTimeFromPeri(muE, norm(st.r), vi, SOI.earth);
    // Saída da SOI: propaga a hipérbole real até o raio da SOI
    const tOut = firstRoot((t) => SOI.earth - norm(propagate(muE, { r: st.r, v }, t - tD).r), tD, tD + 3 * dt, 200) ?? tD + dt;
    const exit = propagate(muE, { r: st.r, v }, tOut - tD);
    const E = earth(tOut);
    return { tD, burn: { r: st.r, v }, dv: norm(sub(v, st.v)), tOut, helio: { r: add(E.r, exit.r), v: add(E.v, exit.v) } };
  };

  const tTcmOffset = 60 * DAY;
  let vInf = plan.vInf;
  let tA = plan.tA;
  let dep = departFor(vInf, tReady);
  const segments: Segment[] = [];
  let tcmT = 0, tcmDv = 0, arrival: { v1: V3; hyp: Hyperbola; tIn: number } | null = null;
  let helioStart: State = dep.helio, helioT0 = dep.tOut;
  const extra: Segment[] = [];
  const extraMilestones: Milestone[] = [];

  if (!dveega) {
    // Direta: Lambert até Júpiter; o v∞ de partida é refinado (Newton) até a correção a 60 dias ficar mínima
    const tcmFor = (v: V3) => {
      const d = departFor(v, tReady);
      const t = d.tOut + tTcmOffset;
      const st = propagate(muS, d.helio, t - d.tOut);
      const leg = legToEncounter(tl, 'sun', 'jupiter', st.r, t, tA, rpJ, jNormalFor);
      return { dep: d, t, leg, dv: sub(leg.v1, st.v) };
    };
    dep = departFor(vInf, tReady);
    tA = bestTransfer(epochMs, dep.tOut, dep.helio.r, earth(dep.tOut).v, null).tA;
    let cur = tcmFor(vInf);
    for (let k = 0; k < 6 && norm(cur.dv) > 0.05; k++) {
      const J: V3[] = [];
      for (let j = 0; j < 3; j++) {
        const dv: V3 = [0, 0, 0];
        dv[j] = 1;
        const f = tcmFor(add(vInf, dv)).dv;
        J.push(sub(f, cur.dv));
      }
      // Resolve J·x = −f (colunas de J = derivadas em relação a cada componente de v∞)
      const det = dot(J[0]!, cross(J[1]!, J[2]!));
      if (Math.abs(det) < 1e-12) break;
      const f = scale(cur.dv, -1);
      const x: V3 = [dot(f, cross(J[1]!, J[2]!)) / det, dot(J[0]!, cross(f, J[2]!)) / det, dot(J[0]!, cross(J[1]!, f)) / det];
      const next = tcmFor(add(vInf, x));
      if (norm(next.dv) >= norm(cur.dv)) break;
      vInf = add(vInf, x);
      cur = next;
    }
    dep = cur.dep;
    tcmT = cur.t;
    arrival = cur.leg;
    tcmDv = norm(cur.dv);
    helioStart = dep.helio; helioT0 = dep.tOut;
  } else {
    // ΔV-EGA: partida com o C3 do perfil, DSM perto do afélio (Lambert até a Terra), assistência gravitacional
    // da Terra e correção depois do sobrevoo até Júpiter
    dep = departFor(vInf, tReady);
    const rpE = RADIUS.earth + 800e3;
    // Refina a busca do plano preliminar com o estado real depois da saída da SOI da Terra
    const p0 = plan.ega;
    const loop = (input.loopYears ?? 2) * YEAR;
    const yC = p0 ? p0.tEga - plan.tD + dep.tD : dep.tD + loop;
    const fC = p0 ? (p0.tDsm - plan.tD) / elementsOf(muS, { r: planetPosition('earth', date(plan.tD)), v: add(planetVelocity('earth', date(plan.tD)), plan.vInf) }).period : 0.5;
    const cache = new Map<number, { tA: number; vo: V3; va: number }[]>();
    const pick = searchEga(epochMs, dep.tOut, dep.helio, range(yC - 0.06 * YEAR, yC + 0.06 * YEAR, 0.01 * YEAR), range(Math.max(0.2, fC - 0.08), fC + 0.08, 0.01), cache)
      ?? searchEga(epochMs, dep.tOut, dep.helio, range(dep.tD + loop - 0.4 * YEAR, dep.tD + loop + 0.6 * YEAR, 0.05 * YEAR), range(0.3, 0.7, 0.02), cache);
    if (!pick) throw new Error('Sem DSM viável');
    const tEga = pick.tEga;
    tA = pick.tA;
    const vOutReq = pick.vOut;
    const egaNormal = (v: V3) => unit(cross(v, vOutReq));
    const rpFor = (v: V3) => Math.max(rpE, flybyPeriapsis(muE, v, vOutReq));
    const stDsm = propagate(muS, dep.helio, pick.tDsm - dep.tOut);
    const legE = legToEncounter(tl, 'sun', 'earth', stDsm.r, pick.tDsm, tEga, rpFor, egaNormal);
    const bestDsm = { t: pick.tDsm, leg: legE, dv: norm(sub(legE.v1, stDsm.v)), st: stDsm };
    const ega = bestDsm.leg;
    const tEgaPeri = ega.tIn + ega.hyp.dtEntryToPeri;
    const egaOutT = tEgaPeri + ega.hyp.dtEntryToPeri;
    const egaOut = propagate(muE, ega.hyp.entry, egaOutT - ega.tIn);
    const E2 = earth(egaOutT);
    const helio2: State = { r: add(E2.r, egaOut.r), v: add(E2.v, egaOut.v) };
    tcmT = egaOutT + 30 * DAY;
    const st = propagate(muS, helio2, tcmT - egaOutT);
    arrival = legToEncounter(tl, 'sun', 'jupiter', st.r, tcmT, tA, rpJ, jNormalFor);
    tcmDv = norm(sub(arrival.v1, st.v));
    helioStart = dep.helio; helioT0 = dep.tOut;
    extra.push(
      { id: 'cruise-1', label: 'Cruzeiro heliocêntrico (laço de 2 anos)', center: 'sun', t0: dep.tOut, t1: bestDsm.t, s0: dep.helio, phase: 'cruise', attitude: 'sun' },
      { id: 'cruise-2', label: 'Retorno à Terra depois da DSM', center: 'sun', t0: bestDsm.t, t1: ega.tIn, s0: { r: bestDsm.st.r, v: ega.v1 }, phase: 'cruise', attitude: 'sun' },
      { id: 'ega', label: 'Assistência gravitacional da Terra', center: 'earth', t0: ega.tIn, t1: egaOutT, s0: ega.hyp.entry, phase: 'flyby', attitude: 'sun' },
      { id: 'cruise-3', label: 'Cruzeiro heliocêntrico até Júpiter', center: 'sun', t0: egaOutT, t1: tcmT, s0: helio2, phase: 'cruise', attitude: 'sun' },
    );
    extraMilestones.push(
      { id: 'dsm', t: bestDsm.t, label: 'Manobra de espaço profundo (DSM)', kind: 'burn', maneuverId: has('dsm') ? 'dsm' : undefined, dvMS: bestDsm.dv, center: 'sun' },
      { id: 'soi-earth-in', t: ega.tIn, label: 'Volta à esfera de influência da Terra', kind: 'patch', center: 'earth' },
      { id: 'ega-peri', t: tEgaPeri, label: `Sobrevoo da Terra a ${((ega.hyp.rp - RADIUS.earth) / 1000).toFixed(0)} km`, kind: 'patch', center: 'earth' },
      { id: 'soi-earth-out', t: egaOutT, label: 'Saída da esfera de influência da Terra', kind: 'patch', center: 'sun' },
    );
    notes.push(`DSM calculada para esta data: Δv ${bestDsm.dv.toFixed(0)} m/s; sobrevoo da Terra a ${((ega.hyp.rp - RADIUS.earth) / 1000).toFixed(0)} km.`);
  }

  const arr = arrival!;
  segments.push({ id: 'parking', label: 'Órbita de estacionamento (sonda acoplada ao estágio superior)', center: 'earth', t0: 0, t1: dep.tD, s0, phase: 'earth-orbit', attitude: 'prograde' });
  segments.push({ id: 'departure', label: 'Hipérbole de partida da Terra', center: 'earth', t0: dep.tD, t1: dep.tOut, s0: dep.burn, phase: 'transfer', attitude: 'sun' });
  if (dveega) segments.push(...extra);
  else segments.push({ id: 'cruise-1', label: 'Cruzeiro heliocêntrico até Júpiter', center: 'sun', t0: helioT0, t1: tcmT, s0: helioStart, phase: 'cruise', attitude: 'sun' });
  const tcmState = propagate(muS, segments[segments.length - 1]!.s0, tcmT - segments[segments.length - 1]!.t0);
  segments.push({ id: 'cruise-tcm', label: 'Cruzeiro final até Júpiter', center: 'sun', t0: tcmT, t1: arr.tIn, s0: { r: tcmState.r, v: arr.v1 }, phase: 'cruise', attitude: 'sun' });

  const c3 = (2 * (0.5 * norm(dep.burn.v) ** 2 - muE / norm(dep.burn.r))) / 1e6;
  milestones.push({ id: 'departure-burn', t: dep.tD, label: `Injeção de partida pelo estágio superior (C3 ${c3.toFixed(1)} km²/s²)`, kind: 'burn', dvMS: dep.dv, center: 'earth' });
  milestones.push({ id: 'separation', t: dep.tD + 600, label: 'Separação da sonda', kind: 'patch', center: 'earth' });
  milestones.push({ id: 'soi-earth', t: dep.tOut, label: 'Saída da esfera de influência da Terra', kind: 'patch', center: 'sun' });
  milestones.push(...extraMilestones);
  milestones.push({ id: 'tcm', t: tcmT, label: 'Correção de trajetória', kind: 'burn', maneuverId: has('tcm') ? 'tcm' : undefined, dvMS: tcmDv, center: 'sun' });
  milestones.push({ id: 'soi-jupiter', t: arr.tIn, label: 'Entrada na esfera de influência de Júpiter', kind: 'patch', center: 'jupiter' });
  segments.push(...arrivalSegments('jupiter', arr.hyp, arr.tIn, input.outcome ?? 'captured', 'joi', has('joi'), 'Inserção na órbita de Júpiter', 'sun', aJ, milestones));
  milestones.sort((x, y) => x.t - y.t);
  notes.push(`Correção de trajetória calculada: Δv ${tcmDv.toFixed(1)} m/s.`);
  const el = elementsOf(muJ, arr.hyp.peri);
  return {
    epochMs, segments, milestones, parking,
    departure: { t: dep.tD, dvMS: dep.dv, c3KmS2: c3, maneuverId: 'departure-burn', label: 'Injeção de partida (estágio superior)' },
    destination: 'jupiter',
    arrival: { t: arr.tIn + arr.hyp.dtEntryToPeri, periapsisAltM: el.rp - RADIUS.jupiter, inclinationDeg: Math.acos(Math.max(-1, Math.min(1, dot(unit(el.h), jNormal)))) / DEG, vInfMS: Math.sqrt(-muJ / el.a) },
    moon, notes,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Consulta

export interface ProbeState {
  segment: Segment;
  index: number;
  /** Relativo ao centro do trecho. */
  r: V3;
  v: V3;
  /** Heliocêntrico. */
  helio: V3;
}

export function segmentAt(tl: MissionTimeline, t: number): number {
  for (let i = tl.segments.length - 1; i >= 0; i--) if (t >= tl.segments[i]!.t0) return i;
  return 0;
}

export function stateAt(tl: MissionTimeline, t: number): ProbeState {
  const index = segmentAt(tl, t);
  const segment = tl.segments[index]!;
  const s = propagate(MU[segment.center], segment.s0, Math.min(t, segment.t1) - segment.t0);
  const c = centerState(tl, segment.center, t);
  return { segment, index, r: s.r, v: s.v, helio: add(c.r, s.r) };
}

/** Pontos de um trecho relativos ao seu centro (para desenhar). */
export function segmentPoints(seg: Segment, n = 256, maxSpan?: number): V3[] {
  const mu = MU[seg.center];
  let t1 = seg.t1;
  if (!Number.isFinite(t1)) {
    const p = elementsOf(mu, seg.s0).period;
    t1 = seg.t0 + (Number.isFinite(p) ? p : maxSpan ?? 30 * DAY);
  }
  if (maxSpan) t1 = Math.min(t1, seg.t0 + maxSpan);
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) pts.push(propagate(mu, seg.s0, ((t1 - seg.t0) * i) / n).r);
  return pts;
}

/** Distância ao centro do corpo e altitude acima da superfície (m) no instante t. */
export function altitudeAt(tl: MissionTimeline, t: number): { center: CenterId; distance: number; altitude: number } {
  const s = stateAt(tl, t);
  const d = norm(s.r);
  return { center: s.segment.center, distance: d, altitude: d - RADIUS[s.segment.center] };
}
