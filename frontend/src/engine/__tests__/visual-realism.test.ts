/**
 * Garantias da rodada de realismo visual: o desenho nunca altera a física (amostras exatas da cônica, solver de
 * Kepler conservativo), as estrelas não estouram o bloom e os personagens têm a altura pedida na escala do mundo.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import { CrewKit, createWorker, measuredHeight } from '../entities/humans';
import { cross, dot, norm, propagate, type State } from '../orbital-mechanics/kepler';
import { conicSamples, maxTurnAngle } from '../orbital-mechanics/sampling';
import { parseCatalog, starPsf } from '../scenes/starfield';

const MU_JUP = 1.26686534e17;
const MU_EARTH = 3.986004418e14;
const energy = (mu: number, s: State) => dot(s.v, s.v) / 2 - mu / norm(s.r);
const hvec = (s: State) => cross(s.r, s.v);

describe('solver de Kepler (variável universal com bissecção de salvaguarda)', () => {
  // Órbita de captura em Júpiter muito excêntrica (perijove ~4.200 km acima das nuvens, apojove ~ 8 milhões de km):
  // antes da salvaguarda o Newton divergia em parte das amostras (posições de 1e38 m e NaN na tela)
  const rp = 71492e3 + 4.2e6, ra = 8e9;
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(MU_JUP * (2 / rp - 1 / a));
  const capture: State = { r: [rp, 0, 0], v: [0, vp, 0] };
  const period = 2 * Math.PI * Math.sqrt(a ** 3 / MU_JUP);

  it('conserva energia e momento angular ao longo da órbita inteira', () => {
    const e0 = energy(MU_JUP, capture), h0 = norm(hvec(capture));
    for (let k = 0; k <= 2000; k++) {
      const s = propagate(MU_JUP, capture, (period * k) / 2000);
      expect(Number.isFinite(s.r[0])).toBe(true);
      expect(Math.abs((energy(MU_JUP, s) - e0) / e0)).toBeLessThan(1e-7);
      expect(Math.abs(norm(hvec(s)) / h0 - 1)).toBeLessThan(1e-7);
    }
  });

  it('volta ao ponto de partida depois de um período', () => {
    const s = propagate(MU_JUP, capture, period);
    expect(norm([s.r[0] - rp, s.r[1], s.r[2]]) / rp).toBeLessThan(1e-7);
  });

  it('hipérbole de sobrevoo: energia conservada também com passos longos', () => {
    const flyby: State = { r: [-5e8, 2e8, 0], v: [9000, 0, 300] };
    const e0 = energy(MU_EARTH, flyby);
    for (const dt of [-3e6, -1e5, 1, 3600, 86400, 5e6]) {
      const s = propagate(MU_EARTH, flyby, dt);
      expect(Math.abs((energy(MU_EARTH, s) - e0) / e0)).toBeLessThan(1e-8);
    }
  });
});

describe('amostragem adaptativa das trajetórias (só o desenho)', () => {
  const rp = 71492e3 + 4.2e6, ra = 8e9, a = (rp + ra) / 2;
  const s0: State = { r: [rp, 0, 0], v: [0, Math.sqrt(MU_JUP * (2 / rp - 1 / a)), 0] };
  const period = 2 * Math.PI * Math.sqrt(a ** 3 / MU_JUP);
  const samples = conicSamples(MU_JUP, s0, 0, period);

  it('cada vértice é a posição exata da cônica no instante dele', () => {
    for (const p of samples.filter((_, i) => i % 7 === 0)) {
      const exact = propagate(MU_JUP, s0, p.t).r;
      expect(norm([p.r[0] - exact[0], p.r[1] - exact[1], p.r[2] - exact[2]])).toBe(0);
    }
  });

  it('o perijove fica liso (sem "bico") e a curva não usa pontos demais', () => {
    const tol = (0.35 * Math.PI) / 180;
    expect(maxTurnAngle(samples.map((s) => s.r))).toBeLessThan(2 * tol);
    expect(samples.length).toBeLessThan(6000);
    // Amostragem uniforme com o mesmo número de pontos deixaria o perijove com um ângulo grande
    const n = samples.length;
    const uniform = Array.from({ length: n }, (_, i) => propagate(MU_JUP, s0, (period * i) / (n - 1)).r);
    expect(maxTurnAngle(uniform)).toBeGreaterThan(10 * tol);
  });
});

describe('campo estelar', () => {
  it('nenhuma estrela passa do limiar do bloom (0,9) e o brilho cai com a magnitude', () => {
    const lim = 6.2;
    let prev = Infinity;
    for (const mag of [-1.46, 0, 1, 2, 3, 4, 5, 6, 6.5, 7]) {
      const { peak, sigmaPx } = starPsf(mag, lim);
      expect(peak).toBeLessThan(0.9);
      expect(peak).toBeLessThanOrEqual(prev);
      expect(sigmaPx).toBeLessThan(1.2);
      prev = peak;
    }
    expect(starPsf(7, lim).peak).toBe(0);
  });

  it('catálogo BSC5 empacotado: 9.096 estrelas, direções unitárias, Sírius a mais brilhante', () => {
    const buf = readFileSync(join(__dirname, '../../../public/data/stars/bsc5.bin'));
    const cat = parseCatalog(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
    expect(cat.count).toBe(9096);
    expect(cat.mag[0]).toBeCloseTo(-1.46, 1);
    for (let i = 0; i < cat.count; i += 97) {
      expect(Math.hypot(cat.dir[i * 3]!, cat.dir[i * 3 + 1]!, cat.dir[i * 3 + 2]!)).toBeCloseTo(1, 4);
      if (i) expect(cat.mag[i]!).toBeGreaterThanOrEqual(cat.mag[i - 1]!);
    }
  });
});

describe('técnicos em escala humana', () => {
  it.each([1.63, 1.75, 1.84])('personagem de %s m mede essa altura no mundo (sem escala manual)', (h) => {
    const scene = new Scene(new NullEngine());
    const kit = new CrewKit(scene);
    for (const outfit of ['cleanroom', 'coverall'] as const) {
      const w = createWorker(scene, kit, { height: h, outfit, position: new Vector3(3, 0, 2), activity: 'stand', seed: 5 });
      w.update(0.016);
      const measured = measuredHeight(w);
      // Capuz/capacete acrescentam alguns centímetros acima do topo da cabeça
      expect(measured).toBeGreaterThan(h * 0.97);
      expect(measured).toBeLessThan(h * 1.06);
      w.dispose();
    }
    scene.dispose();
  });
});
