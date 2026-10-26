import { NullEngine, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import { getVehicle } from '../catalog';
import type { MaterialLibrary } from '../entities/materials';
import { buildRocket } from '../entities/rocketModel';
import { applyMover, buildPadComplex } from '../scenes/padStructures';

const VEHICLES = ['falcon-9', 'falcon-heavy', 'sls', 'starship', 'new-glenn', 'soyuz'];
const PAD_H = 8;

function build(id: string) {
  const scene = new Scene(new NullEngine());
  const mat = new StandardMaterial('m', scene);
  const mats = { get: () => mat, variant: () => mat } as unknown as MaterialLibrary;
  const rocket = buildRocket(scene, mats, getVehicle(id));
  const pad = buildPadComplex(scene, mats, id, rocket, PAD_H, { markings: false });
  return { scene, rocket, pad };
}

describe('complexo de lançamento por família', () => {
  it.each(VEHICLES)('%s: estrutura coerente com o veículo', (id) => {
    const { scene, rocket, pad } = build(id);
    expect(pad.root.getChildMeshes().length).toBeGreaterThan(10);
    // A base do foguete fica sobre a mesa (ou suspensa no poço, no caso da Soyuz) e nunca abaixo do terreno
    expect(pad.deckY).toBeGreaterThan(PAD_H - 2);
    expect(pad.deckY).toBeLessThan(PAD_H + 21);
    // Torres de serviço cobrem o veículo (a do New Glenn é o próprio transportador-eretor)
    expect(pad.towerH).toBeGreaterThanOrEqual(rocket.height);
    expect(pad.clamps.length).toBeGreaterThanOrEqual(4);
    expect(pad.arms.length).toBeGreaterThanOrEqual(1);
    scene.dispose();
  });

  it.each(VEHICLES)('%s: partes móveis giram só em torno do próprio eixo e terminam no ângulo máximo', (id) => {
    const { scene, pad } = build(id);
    for (const m of pad.arms) {
      const p0 = m.node.position.clone();
      applyMover(m, 0);
      const r0 = m.node.rotation[m.axis];
      applyMover(m, 1);
      expect(m.node.rotation[m.axis] - r0).toBeCloseTo(m.max, 9);
      expect(m.node.position.equals(p0)).toBe(true);
      // Recolher afasta a ponta do braço do eixo do foguete (mede pela posição da primeira malha filha)
      const tip = m.node.getChildMeshes()[0];
      if (tip && m.axis === 'y') {
        applyMover(m, 0);
        m.node.computeWorldMatrix(true);
        const before = Vector3.TransformCoordinates(new Vector3(8, 0, 0), m.node.getWorldMatrix());
        applyMover(m, 1);
        m.node.computeWorldMatrix(true);
        const after = Vector3.TransformCoordinates(new Vector3(8, 0, 0), m.node.getWorldMatrix());
        expect(Math.hypot(after.x, after.z)).toBeGreaterThanOrEqual(Math.hypot(before.x, before.z) - 1e-6);
      }
    }
    scene.dispose();
  });
});
