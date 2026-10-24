import { describe, expect, it } from 'vitest';
import { atmosphere } from '../atmosphere/us76';
import { checkCatalogIntegrity } from '../catalog';
import { c3ToVinf, daysToS, degToRad, kmToM, mToKm, vinfToC3 } from '../core/units';
import { createRng } from '../core/rng';
import { nBodyDerivative, propagate, stateAtPeriapsis } from '../physics/integrator';
import {
  BODIES, captureDeltaV, circularVelocity, deorbitDeltaV, eclipseFraction, hohmann, interplanetaryHohmann,
  jupiterWindow, lunarTransfer, orbitalPeriod, semiMajorAxisFromPeriod, sunSynchronousInclination,
} from '../orbital-mechanics/orbits';
import { burnTime, G0, propellantForDeltaV, thrustToWeight, tsiolkovsky } from '../propulsion/rocket';

describe('conversão de unidades', () => {
  it('converte km, dias, graus e C3', () => {
    expect(kmToM(1.5)).toBe(1500);
    expect(mToKm(384400000)).toBe(384400);
    expect(daysToS(1)).toBe(86400);
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(c3ToVinf(16)).toBeCloseTo(4000, 9);
    expect(vinfToC3(c3ToVinf(31.1))).toBeCloseTo(31.1, 9);
  });
});

describe('equação do foguete', () => {
  it('reproduz caso de referência: Isp 300 s, razão de massa e → Δv = 300·g0', () => {
    expect(tsiolkovsky(300, Math.E * 1000, 1000)).toBeCloseTo(300 * 9.80665, 6);
  });
  it('propelente para Δv é o inverso de Tsiolkovsky', () => {
    const m0 = 1500;
    const prop = propellantForDeltaV(315, m0, 900);
    expect(tsiolkovsky(315, m0, m0 - prop)).toBeCloseTo(900, 6);
  });
  it('rejeita massas inválidas', () => {
    expect(() => tsiolkovsky(300, 100, 200)).toThrow();
  });
  it('relação empuxo-peso e tempo de queima', () => {
    expect(thrustToWeight(G0 * 1000, 1000)).toBeCloseTo(1, 12);
    const tb = burnTime(300, 1000, 1000, 100);
    const mdot = 1000 / (300 * G0);
    expect(tb * mdot).toBeCloseTo(propellantForDeltaV(300, 1000, 100), 9);
  });
});

describe('mecânica orbital', () => {
  it('velocidade circular em LEO de 400 km ≈ 7,67 km/s e período ≈ 92,6 min', () => {
    const r = BODIES.earth.radius + 400e3;
    expect(circularVelocity(BODIES.earth.mu, r)).toBeCloseTo(7669, -1);
    expect(orbitalPeriod(BODIES.earth.mu, r) / 60).toBeCloseTo(92.6, 0);
  });
  it('Hohmann LEO 300 km → GEO ≈ 3,9 km/s', () => {
    const h = hohmann(BODIES.earth.mu, BODIES.earth.radius + 300e3, 42164e3);
    expect(h.total).toBeGreaterThan(3850);
    expect(h.total).toBeLessThan(3950);
  });
  it('inclinação heliossíncrona a 705 km ≈ 98,2° (Landsat)', () => {
    expect(sunSynchronousInclination(705e3)!).toBeCloseTo(98.2, 0);
  });
  it('eclipse em LEO β=0 dura ~35–36 min', () => {
    const r = BODIES.earth.radius + 400e3;
    const f = eclipseFraction(BODIES.earth.radius, r, 0);
    expect((f * orbitalPeriod(BODIES.earth.mu, r)) / 60).toBeGreaterThan(34);
    expect((f * orbitalPeriod(BODIES.earth.mu, r)) / 60).toBeLessThan(37);
    expect(eclipseFraction(BODIES.earth.radius, r, 90)).toBe(0);
  });
  it('desorbitar de 700 km para perigeu 50 km custa ~170–190 m/s', () => {
    const dv = deorbitDeltaV(BODIES.earth.mu, BODIES.earth.radius + 700e3, BODIES.earth.radius + 50e3);
    expect(dv).toBeGreaterThan(160);
    expect(dv).toBeLessThan(195);
  });
  it('transferência lunar: TLI ≈ 3,1 km/s, ~5 dias, LOI de 50 km ≈ 0,8–0,95 km/s', () => {
    const t = lunarTransfer(200e3, 50e3, 1);
    expect(t.tliDeltaV).toBeGreaterThan(3050);
    expect(t.tliDeltaV).toBeLessThan(3200);
    expect(t.transferTimeS / 86400).toBeGreaterThan(4.5);
    expect(t.transferTimeS / 86400).toBeLessThan(5.5);
    expect(t.loiDeltaV).toBeGreaterThan(780);
    expect(t.loiDeltaV).toBeLessThan(960);
    expect(t.c3KmS2).toBeLessThan(0);
  });
  it('Hohmann Terra→Júpiter: ~2,7 anos, v∞ chegada ≈ 5,6 km/s, C3 ≈ 77 km²/s²', () => {
    const tr = interplanetaryHohmann(BODIES.earth.semiMajorAxisSun!, BODIES.jupiter.semiMajorAxisSun!, orbitalPeriod(BODIES.sun.mu, BODIES.jupiter.semiMajorAxisSun!));
    expect(tr.transferTimeS / (365.25 * 86400)).toBeCloseTo(2.73, 1);
    expect(tr.vInfArrival).toBeCloseTo(5640, -2);
    expect(tr.c3KmS2).toBeGreaterThan(70);
    expect(tr.c3KmS2).toBeLessThan(85);
    expect(tr.requiredPhaseDeg).toBeGreaterThan(90);
    expect(tr.requiredPhaseDeg).toBeLessThan(100);
  });
  it('JOI estilo Juno (perijove 4 200 km, 53 dias) ≈ 0,5–0,6 km/s', () => {
    const rp = BODIES.jupiter.radius + 4200e3;
    const a = semiMajorAxisFromPeriod(BODIES.jupiter.mu, 53 * 86400);
    const dv = captureDeltaV(BODIES.jupiter.mu, 5640, rp, a);
    expect(dv).toBeGreaterThan(480);
    expect(dv).toBeLessThan(620);
  });
  it('janela Júpiter: erro de fase é periódico e a janela sugerida tem erro ~0', () => {
    const w = jupiterWindow(new Date('2030-01-01T00:00:00Z'), 0);
    const w2 = jupiterWindow(w.nearestWindow, 0);
    expect(w2.windowErrorDays).toBeLessThan(3);
  });
});

describe('propagação numérica', () => {
  it('RK4 conserva a energia de uma órbita circular em 10 períodos (erro < 1e-6)', () => {
    const mu = BODIES.earth.mu;
    const r = BODIES.earth.radius + 500e3;
    const y0 = stateAtPeriapsis(mu, r, r, 97);
    const period = orbitalPeriod(mu, r);
    const samples = propagate(nBodyDerivative(mu), y0, period * 10, 10, 50);
    const last = samples[samples.length - 1]!;
    const radius = Math.hypot(last[1]!, last[2]!, last[3]!);
    expect(Math.abs(radius - r) / r).toBeLessThan(1e-6);
  });
});

describe('atmosfera US76', () => {
  it('nível do mar: 101 325 Pa, 1,225 kg/m³; 11 km ≈ 22,6 kPa', () => {
    expect(atmosphere(0).pressurePa).toBeCloseTo(101325, 0);
    expect(atmosphere(0).densityKgM3).toBeCloseTo(1.225, 3);
    expect(atmosphere(11019).pressurePa).toBeCloseTo(22632, -2);
  });
  it('densidade decresce monotonicamente até 1000 km', () => {
    let prev = Infinity;
    for (let h = 0; h <= 1_000_000; h += 5000) {
      const rho = atmosphere(h).densityKgM3;
      expect(rho).toBeLessThan(prev);
      prev = rho;
    }
  });
});

describe('gerador determinístico e catálogos', () => {
  it('mesma semente gera a mesma sequência', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
  it('catálogos íntegros (fontes, capacidades, pesos)', () => {
    expect(checkCatalogIntegrity()).toEqual([]);
  });
});
