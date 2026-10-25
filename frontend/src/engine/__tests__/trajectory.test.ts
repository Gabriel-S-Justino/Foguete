import { describe, expect, it } from 'vitest';
import { attitudeBasis, pointingErrorDeg } from '../orbital-mechanics/attitude';
import { planetPosition, SOLAR_SYSTEM, PLANETS, eclipticToEquatorial } from '../orbital-mechanics/ephemeris';
import { cross, dot, elementsOf, lambert, norm, propagate, sub, unit, type State, type V3 } from '../orbital-mechanics/kepler';
import {
  MU, RADIUS, altitudeAt, buildTimeline, centerState, revolutionTime, stateAt, type MissionTimeline, type TimelineInput,
} from '../orbital-mechanics/missionTrajectory';

const AU = 149597870700;
const DAY = 86400;
const ins = { altitudeM: 200e3, speedMS: 7784, flightPathDeg: 0.05, inclinationDeg: 28.5, downrangeM: 1.9e6 };
const lunar = (extra: Partial<TimelineInput> = {}): TimelineInput => ({
  kind: 'lunar', launchDate: '2027-09-10', insertion: ins, parkingAltitudeKm: 200, launchInclinationDeg: 28.5,
  lunarAltitudeKm: 50, lunarInclinationDeg: 90, apogeeFactor: 1, maneuverIds: ['tcm', 'loi'], ...extra,
});
const jupiter = (trajectory: 'direct' | 'dveega'): TimelineInput => ({
  kind: 'interplanetary', launchDate: trajectory === 'direct' ? '2031-03-06' : '2031-05-12', insertion: ins, parkingAltitudeKm: 200,
  launchInclinationDeg: 28.5, trajectory, c3KmS2: 31, loopYears: 2, perijoveAltitudeKm: 4200, orbitPeriodDays: 53,
  jupiterInclinationDeg: 90, maneuverIds: ['tcm', 'dsm', 'joi'],
});

/** Diferença de posição e de velocidade (heliocêntricas) entre o fim de um trecho e o começo do seguinte. */
function patchJumps(tl: MissionTimeline) {
  const out: { id: string; dp: number; dv: number; t: number }[] = [];
  for (let i = 1; i < tl.segments.length; i++) {
    const a = tl.segments[i - 1]!, b = tl.segments[i]!;
    const sa = propagate(MU[a.center], a.s0, b.t0 - a.t0);
    const ca = centerState(tl, a.center, b.t0), cb = centerState(tl, b.center, b.t0);
    const pa = sa.r.map((x, k) => x + ca.r[k]!) as V3, pb = b.s0.r.map((x, k) => x + cb.r[k]!) as V3;
    const va = sa.v.map((x, k) => x + ca.v[k]!) as V3, vb = b.s0.v.map((x, k) => x + cb.v[k]!) as V3;
    out.push({ id: b.id, dp: norm(sub(pa, pb)), dv: norm(sub(va, vb)), t: b.t0 });
  }
  return out;
}

/** Posição contínua em todas as trocas; velocidade só muda onde há uma queima listada. */
function expectContinuous(tl: MissionTimeline) {
  const burns = tl.milestones.filter((m) => m.kind === 'burn');
  for (const j of patchJumps(tl)) {
    expect(j.dp, `posição em ${j.id}`).toBeLessThan(1);
    const isBurn = burns.some((m) => Math.abs(m.t - j.t) < 1e-3);
    if (!isBurn) expect(j.dv, `velocidade em ${j.id}`).toBeLessThan(0.05);
  }
}

describe('Kepler e Lambert', () => {
  const mu = MU.earth;
  const s: State = { r: [7e6, 0, 0], v: [0, 7.2e3, 1.2e3] };
  it('o estado se repete depois de um período e a energia se conserva', () => {
    const el = elementsOf(mu, s);
    const back = propagate(mu, s, el.period);
    expect(norm(sub(back.r, s.r))).toBeLessThan(1e-3);
    const half = propagate(mu, s, el.period * 0.37);
    const e0 = norm(s.v) ** 2 / 2 - mu / norm(s.r), e1 = norm(half.v) ** 2 / 2 - mu / norm(half.r);
    expect(Math.abs(e1 - e0) / Math.abs(e0)).toBeLessThan(1e-12);
  });
  it('Lambert leva exatamente de r1 a r2 no tempo dado', () => {
    const r1: V3 = [7e6, 0, 0], r2: V3 = [-2e7, 3e7, 1e6];
    const sol = lambert(mu, r1, r2, 5 * 3600);
    const end = propagate(mu, { r: r1, v: sol.v1 }, 5 * 3600);
    expect(norm(sub(end.r, r2))).toBeLessThan(1e-2);
    expect(norm(sub(end.v, sol.v2))).toBeLessThan(1e-6);
  });
});

describe('efemérides (posições dos planetas)', () => {
  it('distâncias ao Sol dentro da faixa da órbita de cada planeta (NASA: distância média e excentricidade)', () => {
    for (const id of PLANETS) {
      const p = SOLAR_SYSTEM.planets[id];
      const r = norm(planetPosition(id, new Date('2030-01-01T00:00:00Z')));
      const mean = p.averageDistanceFromSunKm * 1000;
      const e = p.elementsJ2000.e;
      expect(r, id).toBeGreaterThan(mean * (1 - e) * 0.995);
      expect(r, id).toBeLessThan(mean * (1 + e) * 1.005);
    }
  });
  it('raios físicos são os da NASA (km)', () => {
    expect(SOLAR_SYSTEM.planets.earth.meanRadiusKm).toBe(6371);
    expect(SOLAR_SYSTEM.planets.jupiter.meanRadiusKm).toBe(69911);
    expect(RADIUS.moon).toBe(1737400);
  });
});

describe('atitude da sonda', () => {
  const r: V3 = [7e6, 1e5, -2e5], v: V3 = [100, 7.5e3, 300];
  const input = { r, v, toSun: unit([0.3, -1, 0.2]), toEarth: unit([-1, 0, 0]) };
  for (const mode of ['nadir', 'prograde', 'retrograde', 'sun'] as const) {
    it(`${mode}: base ortonormal e própria`, () => {
      const b = attitudeBasis(mode, input);
      for (const a of [b.x, b.y, b.z]) expect(norm(a)).toBeCloseTo(1, 12);
      expect(dot(b.x, b.y)).toBeCloseTo(0, 12);
      expect(dot(cross(b.x, b.y), b.z)).toBeCloseTo(1, 12);
    });
  }
  it('nadir: instrumentos (+Z) para o centro do corpo e painéis (X) na normal da órbita; não depende da velocidade para "cair"', () => {
    const b = attitudeBasis('nadir', input);
    expect(pointingErrorDeg(b.z, [-r[0], -r[1], -r[2]])).toBeLessThan(1e-5);
    expect(pointingErrorDeg(b.x, cross(r, v))).toBeLessThan(1e-5);
  });
  it('prógrada e retrógrada: eixo do motor alinhado com a velocidade', () => {
    expect(pointingErrorDeg(attitudeBasis('prograde', input).y, v)).toBeLessThan(1e-5);
    expect(pointingErrorDeg(attitudeBasis('retrograde', input).y, v)).toBeGreaterThan(180 - 1e-5);
  });
});

describe('volta completa na órbita da Terra', () => {
  it('é contada pelo ângulo percorrido: 360° em um período orbital', () => {
    const s0: State = { r: [6.578e6, 0, 0], v: [0, 7784.3 * Math.cos(0.5), 7784.3 * Math.sin(0.5)] };
    const el = elementsOf(MU.earth, s0);
    const t = revolutionTime(MU.earth, s0);
    expect(Math.abs(t - el.period) / el.period).toBeLessThan(1e-6);
    // Antes disso a posição ainda não voltou ao ponto inicial
    const before = propagate(MU.earth, s0, t * 0.98).r;
    expect(norm(sub(before, s0.r))).toBeGreaterThan(5e5);
  });
  it('a injeção translunar só acontece depois da volta completa e do comando', () => {
    const tl = buildTimeline(lunar());
    expect(tl.departure!.t).toBeGreaterThanOrEqual(tl.parking.revolutionT);
    const late = buildTimeline(lunar({ departureCommandT: 30000 }));
    expect(late.departure!.t).toBeGreaterThanOrEqual(30000);
    // A queima é na próxima passagem pelo ponto de queima (menos de um período depois do comando)
    expect(late.departure!.t - 30000).toBeLessThan(late.parking.period * 1.05);
  });
  it('inserção em velocidade de escape não quebra a linha do tempo: vira órbita circular na mesma altitude', () => {
    const tl = buildTimeline(lunar({ insertion: { ...ins, speedMS: 11500 } }));
    expect(Number.isFinite(tl.parking.period)).toBe(true);
    expect(Number.isFinite(tl.parking.revolutionT)).toBe(true);
    expect(tl.parking.perigeeAltM / 1000).toBeCloseTo(200, 0);
    expect(tl.departure!.t).toBeGreaterThan(tl.parking.revolutionT);
  });
  it('a missão de órbita terrestre não tem partida: só a volta antes do ajuste', () => {
    const tl = buildTimeline({ kind: 'earth-orbit', launchDate: '2027-06-15', insertion: { ...ins, altitudeM: 705e3, speedMS: 7504, inclinationDeg: 98.2 }, parkingAltitudeKm: 705, launchInclinationDeg: 98.2, localTimeOfNode: '10:30', maneuverIds: ['trim'] });
    expect(tl.departure).toBeNull();
    expect(tl.milestones.map((m) => m.id)).toEqual(['earth-orbit-rev']);
    // Nodo ascendente às 10:30 (heliossíncrona): ângulo horário de −22,5° em relação ao Sol
    const s0 = tl.segments[0]!.s0;
    const h = eclipticToEquatorial(cross(s0.r, s0.v));
    const node = unit([-h[1], h[0], 0]);
    const sun = eclipticToEquatorial(unit(planetPosition('earth', new Date(tl.epochMs)).map((x) => -x) as V3));
    const ha = Math.atan2(node[1], node[0]) - Math.atan2(sun[1], sun[0]);
    const deg = ((ha * 180) / Math.PI + 540) % 360 - 180;
    expect(deg).toBeCloseTo(-22.5, 0);
  });
});

describe('trajetória lunar (cônicas ajustadas)', () => {
  for (const apogeeFactor of [1, 1.6]) {
    it(`fator de apogeu ${apogeeFactor}: periselênio e inclinação planejados, posição contínua`, () => {
      const tl = buildTimeline(lunar({ apogeeFactor }));
      expect(tl.arrival!.periapsisAltM).toBeCloseTo(50e3, -1);
      expect(tl.arrival!.inclinationDeg).toBeCloseTo(90, 1);
      expect(tl.departure!.dvMS).toBeGreaterThan(3000);
      expect(tl.departure!.dvMS).toBeLessThan(3250);
      expectContinuous(tl);
    });
  }
  it('altitude é medida da superfície e distância do centro (a sonda nunca toca a Lua)', () => {
    const tl = buildTimeline(lunar());
    for (let t = tl.departure!.t; t < tl.arrival!.t + 6 * 3600; t += 600) {
      const a = altitudeAt(tl, t);
      expect(a.distance - a.altitude).toBeCloseTo(RADIUS[a.center], 3);
      expect(a.altitude).toBeGreaterThan(40e3);
    }
  });
  it('captura falha (sobrevoo): segue a hipérbole sem queima', () => {
    const tl = buildTimeline(lunar({ outcome: 'flyby' }));
    const last = tl.segments[tl.segments.length - 1]!;
    expect(last.phase).toBe('flyby');
    expect(elementsOf(MU.moon, last.s0).e).toBeGreaterThan(1);
  });
});

describe('trajetória até Júpiter', () => {
  for (const traj of ['direct', 'dveega'] as const) {
    it(`${traj}: perijove e inclinação planejados, posição contínua, órbita final presa a Júpiter`, () => {
      const tl = buildTimeline(jupiter(traj));
      expect(tl.arrival!.periapsisAltM / 1000).toBeCloseTo(4200, 0);
      expect(tl.arrival!.inclinationDeg).toBeCloseTo(90, 1);
      expectContinuous(tl);
      const final = tl.segments[tl.segments.length - 1]!;
      const el = elementsOf(MU.jupiter, final.s0);
      expect(el.e).toBeLessThan(1);
      expect(el.period / DAY).toBeCloseTo(53, 0);
      // Sonda nunca abaixo do perijove planejado na aproximação
      for (let t = tl.arrival!.t - 5 * DAY; t < tl.arrival!.t + 5 * DAY; t += 3600) {
        const a = altitudeAt(tl, t);
        if (a.center === 'jupiter') expect(a.altitude).toBeGreaterThan(4199e3);
      }
      const years = tl.arrival!.t / (365.25 * DAY);
      expect(years).toBeGreaterThan(traj === 'direct' ? 2 : 4);
      expect(years).toBeLessThan(traj === 'direct' ? 3.5 : 6.5);
    });
  }
  it('ΔV-EGA: DSM perto do afélio e sobrevoo da Terra acima da atmosfera', () => {
    const tl = buildTimeline(jupiter('dveega'));
    const dsm = tl.milestones.find((m) => m.id === 'dsm')!;
    expect(dsm.dvMS!).toBeGreaterThan(200);
    expect(dsm.dvMS!).toBeLessThan(1500);
    const r = norm(stateAt(tl, dsm.t).helio) / AU;
    expect(r).toBeGreaterThan(1.8);
    const ega = tl.segments.find((s) => s.id === 'ega')!;
    expect(elementsOf(MU.earth, ega.s0).rp - RADIUS.earth).toBeGreaterThan(300e3);
  });
});
