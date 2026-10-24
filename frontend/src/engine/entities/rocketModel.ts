/**
 * Modelos procedurais dos veículos de lançamento, com proporções aproximadas de cada foguete
 * e grupos separáveis por estágio (para a separação visual sincronizada com a simulação).
 */
import { Mesh, MeshBuilder, type Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { LaunchVehicle } from '../../types/catalog';
import type { MaterialKey, MaterialLibrary } from './materials';

interface Segment { len: number; dia: number; mat: MaterialKey; group: number; topDia?: number }
interface VisualSpec {
  segments: Segment[];
  boosters?: { count: number; len: number; dia: number; mat: MaterialKey; group: number; nose: MaterialKey; offset: number };
  fairing?: { len: number; dia: number; mat: MaterialKey };
  engines: number;
  extras?: ('gridfins' | 'legs' | 'flaps' | 'soyuz-flare')[];
}

/** Comprimentos aproximados (m) a partir de dados públicos; valores visuais, não de engenharia. */
const SPECS: Record<string, VisualSpec> = {
  'falcon-9': { segments: [{ len: 41.2, dia: 3.7, mat: 'rocketWhite', group: 0 }, { len: 4.5, dia: 3.7, mat: 'rocketBlack', group: 1 }, { len: 11, dia: 3.7, mat: 'rocketWhite', group: 1 }], fairing: { len: 13.1, dia: 5.2, mat: 'rocketWhite' }, engines: 9, extras: ['gridfins', 'legs'] },
  'falcon-heavy': { segments: [{ len: 41.2, dia: 3.7, mat: 'rocketWhite', group: 1 }, { len: 4.5, dia: 3.7, mat: 'rocketBlack', group: 2 }, { len: 11, dia: 3.7, mat: 'rocketWhite', group: 2 }], boosters: { count: 2, len: 41.2, dia: 3.7, mat: 'rocketWhite', group: 0, nose: 'rocketWhite', offset: 4.1 }, fairing: { len: 13.1, dia: 5.2, mat: 'rocketWhite' }, engines: 9, extras: ['gridfins', 'legs'] },
  starship: { segments: [{ len: 71, dia: 9, mat: 'rocketGrey', group: 0 }, { len: 50, dia: 9, mat: 'rocketGrey', group: 1 }], engines: 33, extras: ['gridfins', 'flaps'] },
  soyuz: { segments: [{ len: 27.1, dia: 2.95, mat: 'paintedWhite', group: 1 }, { len: 6.7, dia: 2.66, mat: 'rocketGrey', group: 2 }], boosters: { count: 4, len: 19.6, dia: 2.68, mat: 'paintedWhite', group: 0, nose: 'orangePaint', offset: 2.6 }, fairing: { len: 11.4, dia: 4.1, mat: 'paintedWhite' }, engines: 4, extras: ['soyuz-flare'] },
  'new-glenn': { segments: [{ len: 57.5, dia: 7, mat: 'rocketWhite', group: 0 }, { len: 23, dia: 7, mat: 'rocketWhite', group: 1 }], fairing: { len: 21.9, dia: 7, mat: 'rocketWhite' }, engines: 7, extras: ['legs'] },
  sls: { segments: [{ len: 65, dia: 8.4, mat: 'orangePaint', group: 1 }, { len: 4, dia: 8.4, mat: 'paintedWhite', group: 2, topDia: 5 }, { len: 13.7, dia: 5, mat: 'paintedWhite', group: 2 }], boosters: { count: 2, len: 54, dia: 3.7, mat: 'paintedWhite', group: 0, nose: 'paintedWhite', offset: 6.3 }, fairing: { len: 12, dia: 8.4, mat: 'paintedWhite' }, engines: 4 },
};

export interface RocketModel {
  root: TransformNode;
  groups: TransformNode[];
  payload: TransformNode;
  fairing: TransformNode | null;
  enginePoints: { group: number; node: TransformNode }[];
  height: number;
  diameter: number;
  dispose(): void;
}

export function buildRocket(scene: Scene, mats: MaterialLibrary, vehicle: LaunchVehicle): RocketModel {
  const spec = SPECS[vehicle.id] ?? SPECS['falcon-9']!;
  const root = new TransformNode(`rocket-${vehicle.id}`, scene);
  const groupCount = Math.max(...spec.segments.map((s) => s.group), spec.boosters?.group ?? 0) + 1;
  const groups = Array.from({ length: groupCount }, (_, i) => {
    const g = new TransformNode(`rocket-group-${i}`, scene);
    g.parent = root;
    return g;
  });
  const enginePoints: RocketModel['enginePoints'] = [];
  let y = 0;
  spec.segments.forEach((seg, i) => {
    const m = MeshBuilder.CreateCylinder(`seg-${i}`, { height: seg.len, diameterBottom: seg.dia, diameterTop: seg.topDia ?? seg.dia, tessellation: 48 }, scene);
    m.material = mats.get(seg.mat);
    m.position.y = y + seg.len / 2;
    m.parent = groups[seg.group]!;
    // Faixas e detalhes de superfície
    if (seg.len > 10) {
      for (const f of [0.15, 0.85]) {
        const band = MeshBuilder.CreateCylinder(`band-${i}-${f}`, { height: 0.3, diameter: seg.dia * 1.01, tessellation: 48 }, scene);
        band.material = mats.get('darkSteel');
        band.position.y = y + seg.len * f;
        band.parent = groups[seg.group]!;
      }
      const raceway = MeshBuilder.CreateBox(`raceway-${i}`, { width: 0.25, depth: 0.25, height: seg.len * 0.9 }, scene);
      raceway.material = mats.get('rocketGrey');
      raceway.position = new Vector3(seg.dia / 2, y + seg.len / 2, 0);
      raceway.parent = groups[seg.group]!;
    }
    if (i === 0 || spec.segments[i - 1]!.group !== seg.group) {
      const engineNode = new TransformNode(`engines-${seg.group}`, scene);
      engineNode.parent = groups[seg.group]!;
      engineNode.position.y = y - 0.2;
      buildEngines(scene, mats, engineNode, seg.group === 0 ? spec.engines : 1, seg.dia, `g${seg.group}`);
      enginePoints.push({ group: seg.group, node: engineNode });
    }
    y += seg.len;
  });

  if (spec.boosters) {
    const b = spec.boosters;
    for (let k = 0; k < b.count; k++) {
      const a = (k / b.count) * Math.PI * 2;
      const pos = new Vector3(Math.cos(a) * b.offset, 0, Math.sin(a) * b.offset);
      const body = MeshBuilder.CreateCylinder(`booster-${k}`, { height: b.len, diameterBottom: spec.extras?.includes('soyuz-flare') ? b.dia * 1.15 : b.dia, diameterTop: spec.extras?.includes('soyuz-flare') ? b.dia * 0.45 : b.dia, tessellation: 32 }, scene);
      body.material = mats.get(b.mat);
      body.position = pos.add(new Vector3(0, b.len / 2, 0));
      body.parent = groups[b.group]!;
      const nose = MeshBuilder.CreateCylinder(`booster-nose-${k}`, { height: b.dia * 1.6, diameterBottom: spec.extras?.includes('soyuz-flare') ? b.dia * 0.45 : b.dia, diameterTop: 0.1, tessellation: 32 }, scene);
      nose.material = mats.get(b.nose);
      nose.position = pos.add(new Vector3(0, b.len + b.dia * 0.8, 0));
      nose.parent = groups[b.group]!;
      const eng = new TransformNode(`booster-eng-${k}`, scene);
      eng.parent = groups[b.group]!;
      eng.position = pos.add(new Vector3(0, -0.2, 0));
      buildEngines(scene, mats, eng, spec.engines === 9 ? 9 : 1, b.dia, `b${k}`);
      enginePoints.push({ group: b.group, node: eng });
    }
  }

  const payload = new TransformNode('payload-mount', scene);
  payload.parent = root;
  payload.position.y = y + 0.5;
  let fairing: TransformNode | null = null;
  if (spec.fairing) {
    const f = spec.fairing;
    fairing = new TransformNode('fairing', scene);
    fairing.parent = root;
    const cylLen = f.len * 0.45;
    const base = MeshBuilder.CreateCylinder('fairing-base', { height: cylLen, diameter: f.dia, tessellation: 48 }, scene);
    base.material = mats.get(f.mat);
    base.position.y = y + cylLen / 2;
    base.parent = fairing;
    const ogive = MeshBuilder.CreateCylinder('fairing-ogive', { height: f.len - cylLen, diameterBottom: f.dia, diameterTop: 0.6, tessellation: 48 }, scene);
    ogive.material = mats.get(f.mat);
    ogive.position.y = y + cylLen + (f.len - cylLen) / 2;
    ogive.parent = fairing;
    y += f.len;
  } else {
    const nose = MeshBuilder.CreateCylinder('nose', { height: 8, diameterBottom: spec.segments.at(-1)!.dia, diameterTop: 1, tessellation: 48 }, scene);
    nose.material = mats.get(spec.segments.at(-1)!.mat);
    nose.position.y = y + 4;
    nose.parent = groups[groups.length - 1]!;
    y += 8;
  }

  if (spec.extras?.includes('gridfins')) {
    const top = spec.segments[0]!;
    for (let k = 0; k < 4; k++) {
      const fin = MeshBuilder.CreateBox(`gridfin-${k}`, { width: top.dia * 0.35, height: top.dia * 0.3, depth: 0.12 }, scene);
      fin.material = mats.get('darkSteel');
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      fin.position = new Vector3(Math.cos(a) * (top.dia / 2 + 0.2), top.len - 1.5, Math.sin(a) * (top.dia / 2 + 0.2));
      fin.rotation.y = -a + Math.PI / 2;
      fin.parent = groups[top.group]!;
    }
  }
  if (spec.extras?.includes('legs')) {
    const bottom = spec.segments[0]!;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = MeshBuilder.CreateBox(`leg-${k}`, { width: 0.5, depth: 0.25, height: bottom.dia * 2.4 }, scene);
      leg.material = mats.get('rocketBlack');
      leg.position = new Vector3(Math.cos(a) * (bottom.dia / 2 + 0.1), bottom.dia * 1.2 + 0.5, Math.sin(a) * (bottom.dia / 2 + 0.1));
      leg.rotation.y = -a;
      leg.parent = groups[bottom.group]!;
    }
  }
  if (spec.extras?.includes('flaps')) {
    const upper = spec.segments[1]!;
    const base = spec.segments[0]!.len;
    for (const [dy, size] of [[upper.len - 8, 4], [3, 7]] as const) {
      for (const side of [-1, 1]) {
        const flap = MeshBuilder.CreateBox(`flap-${dy}-${side}`, { width: size * 0.5, height: size, depth: 0.2 }, scene);
        flap.material = mats.get('rocketGrey');
        flap.position = new Vector3(side * (upper.dia / 2 + size * 0.2), base + dy, 0);
        flap.parent = groups[upper.group]!;
      }
    }
  }

  return {
    root, groups, payload, fairing, enginePoints, height: y, diameter: Math.max(...spec.segments.map((s) => s.dia)) + (spec.boosters ? spec.boosters.offset * 2 : 0),
    dispose() { root.dispose(false, false); },
  };
}

function buildEngines(scene: Scene, mats: MaterialLibrary, parent: TransformNode, count: number, dia: number, key: string): void {
  const bell = (x: number, z: number, size: number, i: number) => {
    const m: Mesh = MeshBuilder.CreateCylinder(`bell-${key}-${i}`, { height: size * 1.2, diameterTop: size * 0.45, diameterBottom: size, tessellation: 20 }, scene);
    m.material = mats.get('sootBlack');
    m.position = new Vector3(x, -size * 0.6, z);
    m.parent = parent;
  };
  if (count === 1) { bell(0, 0, dia * 0.55, 0); return; }
  const size = Math.min(1.0, dia / Math.sqrt(count) * 0.9);
  if (count === 9) {
    bell(0, 0, size, 0);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; bell(Math.cos(a) * dia * 0.32, Math.sin(a) * dia * 0.32, size, k + 1); }
    return;
  }
  const rings = count > 12 ? [[3, 0.12], [10, 0.28], [20, 0.43]] as const : [[count, 0.3]] as const;
  let idx = 0;
  for (const [n, r] of rings) for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; bell(Math.cos(a) * dia * r, Math.sin(a) * dia * r, Math.min(size, 1.3), idx++); }
}
