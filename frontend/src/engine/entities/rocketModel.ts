/**
 * Modelos procedurais dos veículos de lançamento, com proporções aproximadas de cada foguete
 * e grupos separáveis por estágio (para a separação visual sincronizada com a simulação).
 */
import { Matrix, Mesh, MeshBuilder, type Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { LaunchVehicle } from '../../types/catalog';
import type { PlumeKind } from '../effects/exhaust';
import type { MaterialKey, MaterialLibrary } from './materials';

interface Segment { len: number; dia: number; mat: MaterialKey; group: number; topDia?: number }
interface VisualSpec {
  segments: Segment[];
  boosters?: { count: number; len: number; dia: number; mat: MaterialKey; group: number; nose: MaterialKey; offset: number };
  fairing?: { len: number; dia: number; mat: MaterialKey };
  engines: number;
  extras?: ('gridfins' | 'legs' | 'flaps' | 'soyuz-flare')[];
  /** Propelente por grupo (define a cor e a opacidade da pluma). */
  plume?: PlumeKind[];
}

/** Comprimentos aproximados (m) a partir de dados públicos; valores visuais, não de engenharia. */
const SPECS: Record<string, VisualSpec> = {
  'falcon-9': { segments: [{ len: 41.2, dia: 3.7, mat: 'rocketWhite', group: 0 }, { len: 4.5, dia: 3.7, mat: 'rocketBlack', group: 1 }, { len: 11, dia: 3.7, mat: 'rocketWhite', group: 1 }], fairing: { len: 13.1, dia: 5.2, mat: 'rocketWhite' }, engines: 9, extras: ['gridfins', 'legs'], plume: ['kerolox', 'kerolox'] },
  'falcon-heavy': { segments: [{ len: 41.2, dia: 3.7, mat: 'rocketWhite', group: 1 }, { len: 4.5, dia: 3.7, mat: 'rocketBlack', group: 2 }, { len: 11, dia: 3.7, mat: 'rocketWhite', group: 2 }], boosters: { count: 2, len: 41.2, dia: 3.7, mat: 'rocketWhite', group: 0, nose: 'rocketWhite', offset: 4.1 }, fairing: { len: 13.1, dia: 5.2, mat: 'rocketWhite' }, engines: 9, extras: ['gridfins', 'legs'], plume: ['kerolox', 'kerolox', 'kerolox'] },
  starship: { segments: [{ len: 71, dia: 9, mat: 'rocketGrey', group: 0 }, { len: 50, dia: 9, mat: 'rocketGrey', group: 1 }], engines: 33, extras: ['gridfins', 'flaps'], plume: ['methalox', 'methalox'] },
  soyuz: { segments: [{ len: 27.1, dia: 2.95, mat: 'paintedWhite', group: 1 }, { len: 6.7, dia: 2.66, mat: 'rocketGrey', group: 2 }], boosters: { count: 4, len: 19.6, dia: 2.68, mat: 'paintedWhite', group: 0, nose: 'orangePaint', offset: 2.6 }, fairing: { len: 11.4, dia: 4.1, mat: 'paintedWhite' }, engines: 4, extras: ['soyuz-flare'], plume: ['kerolox', 'kerolox', 'kerolox'] },
  'new-glenn': { segments: [{ len: 57.5, dia: 7, mat: 'rocketWhite', group: 0 }, { len: 23, dia: 7, mat: 'rocketWhite', group: 1 }], fairing: { len: 21.9, dia: 7, mat: 'rocketWhite' }, engines: 7, extras: ['legs'], plume: ['methalox', 'hydrolox'] },
  sls: { segments: [{ len: 65, dia: 8.4, mat: 'orangePaint', group: 1 }, { len: 4, dia: 8.4, mat: 'paintedWhite', group: 2, topDia: 5 }, { len: 13.7, dia: 5, mat: 'paintedWhite', group: 2 }], boosters: { count: 2, len: 54, dia: 3.7, mat: 'paintedWhite', group: 0, nose: 'paintedWhite', offset: 6.3 }, fairing: { len: 12, dia: 8.4, mat: 'paintedWhite' }, engines: 4, plume: ['solid', 'hydrolox', 'hydrolox'] },
};

export interface EnginePoint {
  group: number;
  node: TransformNode;
  /** Diâmetro do conjunto de motores (m) e posição da saída das tubeiras no nó (y local, negativo). */
  clusterDia: number;
  exitY: number;
  plume: PlumeKind;
}

export interface RocketModel {
  root: TransformNode;
  groups: TransformNode[];
  payload: TransformNode;
  fairing: TransformNode | null;
  /** Metades da coifa, articuladas na base (abrem para fora na separação). */
  fairingHalves: TransformNode[];
  /** Envoltória da coifa no referencial do foguete (base, comprimento e diâmetro externo, m). */
  fairingEnvelope: { baseY: number; len: number; dia: number } | null;
  enginePoints: EnginePoint[];
  /** Suportes das câmeras externas, presos ao último estágio (permanecem até a órbita). */
  cameraMounts: { down: TransformNode; up: TransformNode };
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
      const count = seg.group === 0 ? spec.engines : 1;
      const bellH = buildEngines(scene, mats, engineNode, count, seg.dia, `g${seg.group}`);
      enginePoints.push({ group: seg.group, node: engineNode, clusterDia: count === 1 ? seg.dia * 0.55 : seg.dia * 0.82, exitY: -bellH, plume: spec.plume?.[seg.group] ?? 'kerolox' });
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
      const count = spec.engines === 9 ? 9 : 1;
      const bellH = buildEngines(scene, mats, eng, count, b.dia, `b${k}`);
      enginePoints.push({ group: b.group, node: eng, clusterDia: count === 1 ? b.dia * 0.55 : b.dia * 0.82, exitY: -bellH, plume: spec.plume?.[b.group] ?? 'kerolox' });
    }
  }

  const payload = new TransformNode('payload-mount', scene);
  payload.parent = root;
  payload.position.y = y + 0.5;
  let fairing: TransformNode | null = null;
  const fairingHalves: TransformNode[] = [];
  let fairingEnvelope: RocketModel['fairingEnvelope'] = null;
  if (spec.fairing) {
    const f = spec.fairing;
    fairingEnvelope = { baseY: y, len: f.len, dia: f.dia };
    fairing = new TransformNode('fairing', scene);
    fairing.parent = root;
    const cylLen = f.len * 0.45;
    // Duas metades (arco de 180°) com dobradiça na base, como nas coifas reais
    for (const side of [0, 1]) {
      const hinge = new TransformNode(`fairing-half-${side}`, scene);
      hinge.parent = fairing;
      hinge.position = new Vector3(side ? -f.dia / 2 : f.dia / 2, y, 0);
      const base = MeshBuilder.CreateCylinder(`fairing-base-${side}`, { height: cylLen, diameter: f.dia, tessellation: 48, arc: 0.5, enclose: true }, scene);
      const ogive = MeshBuilder.CreateCylinder(`fairing-ogive-${side}`, { height: f.len - cylLen, diameterBottom: f.dia, diameterTop: 0.6, tessellation: 48, arc: 0.5, enclose: true }, scene);
      for (const [m, cy] of [[base, cylLen / 2], [ogive, cylLen + (f.len - cylLen) / 2]] as const) {
        m.material = mats.get(f.mat);
        m.parent = hinge;
        m.rotation.y = side ? Math.PI / 2 : -Math.PI / 2;
        m.position = new Vector3(side ? f.dia / 2 : -f.dia / 2, cy, 0);
      }
      fairingHalves.push(hinge);
    }
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

  // Câmeras externas no último estágio: uma no topo olhando para baixo (motores, separação, Terra)
  // e outra na base olhando para cima (corpo do estágio e coifa)
  const lastGroup = groups.length - 1;
  const upperSegs = spec.segments.filter((s) => s.group === lastGroup);
  let upperStart = 0;
  for (const s of spec.segments) { if (s.group === lastGroup) break; upperStart += s.len; }
  const upperLen = upperSegs.reduce((a, s) => a + s.len, 0);
  const upperDia = Math.max(...upperSegs.map((s) => s.topDia ?? s.dia));
  // Montadas a 90° do duto de cabos (raceway, em +X). A guinada de 90° deixa o corpo do foguete à
  // esquerda do quadro, como nas câmeras reais presas ao estágio.
  const mount = (name: string, yy: number, look: 1 | -1) => {
    const n = new TransformNode(name, scene);
    n.parent = groups[lastGroup]!;
    n.position = new Vector3(0, yy, -(upperDia / 2 + 0.55));
    n.rotation.y = Math.PI / 2;
    const tilt = new TransformNode(`${name}-tilt`, scene);
    tilt.parent = n;
    tilt.rotation.x = look === -1 ? Math.PI / 2 - 0.05 : -Math.PI / 2 + 0.07;
    // Carenagem da câmera
    const housing = MeshBuilder.CreateBox(`${name}-housing`, { width: 0.35, height: 0.5, depth: 0.35 }, scene);
    housing.material = mats.get('darkSteel');
    housing.parent = groups[lastGroup]!;
    housing.position = new Vector3(0, yy - look * 0.35, -(upperDia / 2 + 0.2));
    return tilt;
  };
  const cameraMounts = {
    down: mount('camera-mount-down', upperStart + upperLen - 0.6, -1),
    up: mount('camera-mount-up', upperStart + Math.min(2, upperLen * 0.1), 1),
  };

  return {
    root, groups, payload, fairing, fairingHalves, fairingEnvelope, enginePoints, cameraMounts, height: y, diameter: Math.max(...spec.segments.map((s) => s.dia)) + (spec.boosters ? spec.boosters.offset * 2 : 0),
    dispose() { root.dispose(false, false); },
  };
}

/**
 * Garante que a carga útil (sonda recolhida) caiba dentro da coifa: mede as malhas visíveis no referencial do
 * foguete e reduz a escala da sonda, se preciso, até sobrar a folga pedida entre ela e a parede interna (parede
 * de ~8 cm; trecho cilíndrico em 45% do comprimento, depois ogiva). Devolve a escala aplicada.
 */
export function fitPayload(rocket: RocketModel, payload: TransformNode, margin = 0.2): number {
  const env = rocket.fairingEnvelope;
  if (!env) return payload.scaling.x;
  const cyl = env.len * 0.45;
  const rOut = env.dia / 2;
  const inner = (h: number) => (h < cyl ? rOut : rOut + (0.3 - rOut) * ((h - cyl) / (env.len - cyl))) - 0.08 - margin;
  const excess = () => {
    rocket.root.computeWorldMatrix(true);
    const inv = Matrix.Invert(rocket.root.getWorldMatrix());
    let worst = -Infinity;
    for (const m of payload.getChildMeshes()) {
      if (!m.isVisible || !m.isEnabled()) continue;
      m.computeWorldMatrix(true);
      for (const c of m.getBoundingInfo().boundingBox.vectorsWorld) {
        const l = Vector3.TransformCoordinates(c, inv);
        const h = l.y - env.baseY;
        worst = Math.max(worst, Math.hypot(l.x, l.z) - inner(h), h - (env.len - 0.4));
      }
    }
    return worst;
  };
  let s = payload.scaling.x;
  for (let i = 0; i < 30 && excess() > 0 && s > 0.4; i++) {
    s *= 0.97;
    payload.scaling.setAll(s);
  }
  return s;
}

/** Cria as tubeiras e devolve a altura da maior (saída das tubeiras abaixo do nó). */
function buildEngines(scene: Scene, mats: MaterialLibrary, parent: TransformNode, count: number, dia: number, key: string): number {
  const bell = (x: number, z: number, size: number, i: number) => {
    const m: Mesh = MeshBuilder.CreateCylinder(`bell-${key}-${i}`, { height: size * 1.2, diameterTop: size * 0.45, diameterBottom: size, tessellation: 20 }, scene);
    m.material = mats.get('sootBlack');
    m.position = new Vector3(x, -size * 0.6, z);
    m.parent = parent;
  };
  if (count === 1) { bell(0, 0, dia * 0.55, 0); return dia * 0.55 * 1.2; }
  const size = Math.min(1.0, dia / Math.sqrt(count) * 0.9);
  if (count === 9) {
    bell(0, 0, size, 0);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; bell(Math.cos(a) * dia * 0.32, Math.sin(a) * dia * 0.32, size, k + 1); }
    return size * 1.2;
  }
  const rings = count > 12 ? [[3, 0.12], [10, 0.28], [20, 0.43]] as const : [[count, 0.3]] as const;
  let idx = 0;
  for (const [n, r] of rings) for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; bell(Math.cos(a) * dia * r, Math.sin(a) * dia * r, Math.min(size, 1.3), idx++); }
  return Math.min(size, 1.3) * 1.2;
}
