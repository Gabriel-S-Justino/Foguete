import { NullEngine, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import type { MissionId } from '../../types/catalog';
import { getVehicle } from '../catalog';
import { ProbeModel } from '../entities/probeModel';
import { buildRocket, fitPayload } from '../entities/rocketModel';
import type { MaterialLibrary } from '../entities/materials';
import { referenceConfig } from '../rules/presets';

const MISSIONS: MissionId[] = ['leo-climate', 'lunar-he3', 'jupiter-system'];
const VEHICLES = ['falcon-9', 'falcon-heavy', 'soyuz', 'new-glenn', 'sls'];
/** Folga mínima entre a sonda e a parede interna da coifa (m), como a envoltória dinâmica das coifas reais. */
const MARGIN = 0.15;

function setup() {
  const scene = new Scene(new NullEngine());
  const mat = new StandardMaterial('m', scene);
  const mats = { get: () => mat, variant: () => mat } as unknown as MaterialLibrary;
  return { scene, mats };
}

/**
 * Monta o foguete e a sonda exatamente como a cena da plataforma (sonda presa ao suporte de carga, painéis
 * recolhidos) e mede o quanto cada canto das malhas visíveis da sonda passa da superfície interna da coifa.
 */
function worstExcess(vehicleId: string, missionId: MissionId) {
  const { scene, mats } = setup();
  const rocket = buildRocket(scene, mats, getVehicle(vehicleId));
  const probe = new ProbeModel(scene, mats, rocket.payload);
  probe.rebuild(referenceConfig(missionId).installed);
  probe.setDeployment(0);
  const scale = fitPayload(rocket, probe.root);
  // Envoltória medida nas próprias malhas da coifa (raio por altura)
  const shell = rocket.fairing!.getChildMeshes().filter((m) => m.name.startsWith('fairing-'));
  let base = Infinity, top = -Infinity, radius = 0;
  for (const m of shell) {
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    base = Math.min(base, bb.minimumWorld.y);
    top = Math.max(top, bb.maximumWorld.y);
    radius = Math.max(radius, bb.maximumWorld.x);
  }
  const cyl = base + (top - base) * 0.45;
  const inner = (y: number) => (y < cyl ? radius : radius + (0.3 - radius) * ((y - cyl) / (top - cyl))) - 0.08 - MARGIN;
  let worst = { name: '', excess: -Infinity, below: Infinity };
  for (const m of probe.root.getChildMeshes()) {
    if (!m.isVisible || !m.isEnabled()) continue;
    m.computeWorldMatrix(true);
    for (const c of m.getBoundingInfo().boundingBox.vectorsWorld) {
      const excess = Math.max(Math.hypot(c.x, c.z) - inner(c.y), c.y - (top - 0.3));
      if (excess > worst.excess) worst = { name: m.name, excess, below: worst.below };
      worst.below = Math.min(worst.below, c.y - base);
    }
  }
  scene.dispose();
  return { ...worst, scale };
}

describe('sonda recolhida cabe na coifa do lançador', () => {
  for (const missionId of MISSIONS) {
    for (const vehicleId of VEHICLES) {
      it(`${missionId} em ${vehicleId}`, () => {
        const w = worstExcess(vehicleId, missionId);
        expect(w.excess, `${w.name} passa ${w.excess.toFixed(2)} m da coifa`).toBeLessThan(0);
        // O bocal do motor principal pode descer até o adaptador de carga, não abaixo dele
        expect(w.below).toBeGreaterThan(-1.2);
        // A sonda só é reduzida o necessário (continua reconhecível dentro da coifa)
        expect(w.scale).toBeGreaterThan(0.6);
      });
    }
  }

  it('estendidos, os painéis abrem para fora do barramento', () => {
    const { scene, mats } = setup();
    const probe = new ProbeModel(scene, mats);
    probe.rebuild(referenceConfig('leo-climate').installed);
    const span = (d: number) => {
      probe.setDeployment(d);
      let max = 0;
      for (const m of probe.root.getChildMeshes()) { m.computeWorldMatrix(true); for (const c of m.getBoundingInfo().boundingBox.vectorsWorld) max = Math.max(max, Math.abs(c.x)); }
      return max;
    };
    expect(probe.hasSolarArrays).toBe(true);
    expect(span(1)).toBeGreaterThan(span(0) + 2);
    expect(Vector3.Zero()).toBeTruthy();
  });
});
