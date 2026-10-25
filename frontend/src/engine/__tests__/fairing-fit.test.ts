import { NullEngine, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import { ProbeModel } from '../entities/probeModel';
import type { MaterialLibrary } from '../entities/materials';
import { referenceConfig } from '../rules/presets';

/** Coifas (diâmetro externo, comprimento) dos veículos de referência de cada missão, como em rocketModel.ts. */
const FAIRINGS = { 'leo-climate': { dia: 5.2, len: 13.1 }, 'lunar-he3': { dia: 5.2, len: 13.1 }, 'jupiter-system': { dia: 5.2, len: 13.1 } } as const;
/** Escala da sonda dentro da coifa (launchPadScene). */
const PROBE_SCALE = 0.9;

describe('sonda recolhida cabe na coifa', () => {
  for (const [missionId, f] of Object.entries(FAIRINGS)) {
    it(`${missionId}: painéis e antenas dobrados ficam dentro do envelope da coifa`, () => {
      const scene = new Scene(new NullEngine());
      const mat = new StandardMaterial('m', scene);
      const mats = { get: () => mat, variant: () => mat } as unknown as MaterialLibrary;
      const probe = new ProbeModel(scene, mats);
      probe.rebuild(referenceConfig(missionId as keyof typeof FAIRINGS).installed);
      probe.setDeployment(0);
      probe.root.scaling.setAll(PROBE_SCALE);
      probe.root.position.y = 0.5;
      const cylLen = f.len * 0.45;
      // Raio interno disponível em cada altura (parede de ~10 cm e folga dinâmica)
      const allowed = (h: number) => (h < cylLen ? f.dia / 2 : f.dia / 2 + (0.3 - f.dia / 2) * ((h - cylLen) / (f.len - cylLen))) - 0.25;
      let worst = { name: '', excess: -Infinity };
      for (const m of probe.root.getChildMeshes()) {
        if (!m.isVisible) continue;
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        for (const c of bb.vectorsWorld) {
          const excess = Math.hypot(c.x, c.z) - allowed(c.y);
          if (excess > worst.excess) worst = { name: m.name, excess };
          // O bocal do motor principal pode ficar dentro do adaptador de carga (abaixo da interface)
          expect(c.y).toBeGreaterThan(-1.2);
        }
      }
      expect(worst.excess, `${worst.name} passa ${worst.excess.toFixed(2)} m da coifa`).toBeLessThan(0);
      expect(Vector3.Zero()).toBeTruthy();
    });
  }
  it('estendidos, os painéis abrem para fora do barramento', () => {
    const scene = new Scene(new NullEngine());
    const mat = new StandardMaterial('m', scene);
    const probe = new ProbeModel(scene, { get: () => mat } as unknown as MaterialLibrary);
    probe.rebuild(referenceConfig('leo-climate').installed);
    const span = (d: number) => {
      probe.setDeployment(d);
      let max = 0;
      for (const m of probe.root.getChildMeshes()) { m.computeWorldMatrix(true); for (const c of m.getBoundingInfo().boundingBox.vectorsWorld) max = Math.max(max, Math.abs(c.x)); }
      return max;
    };
    expect(probe.hasSolarArrays).toBe(true);
    expect(span(1)).toBeGreaterThan(span(0) + 2);
  });
});
