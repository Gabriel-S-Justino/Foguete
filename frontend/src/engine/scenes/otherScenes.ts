/**
 * Cenas: tela inicial, hangar de lançadores, briefing 3D e visualização orbital.
 */
import {
  Color3, Color4, Curve3, type Engine, GlowLayer, HighlightLayer, type Mesh, MeshBuilder, PointerEventTypes,
  StandardMaterial, Vector3,
} from '@babylonjs/core';
import type { LaunchVehicle } from '../../types/catalog';
import type { InstalledComponent } from '../../types/campaign';
import type { SceneController } from '../core/SceneManager';
import { ProbeModel } from '../entities/probeModel';
import { buildRocket, type RocketModel } from '../entities/rocketModel';
import { referenceConfig } from '../rules/presets';
import { buildHangar, buildStarfield, createBaseScene, createPlanet } from './environment';

/* ───────────────────────── Tela inicial ───────────────────────── */
export function createStartScene(engine: Engine): SceneController {
  const base = createBaseScene(engine, { clear: new Color4(0.005, 0.008, 0.015, 1), target: new Vector3(0, 0, 0), radius: 26, alpha: -2.2, beta: 1.35, shadows: false, exposure: 1.0, maxZ: 20000, environment: 'space', environmentIntensity: 0.35 });
  const { scene, mats, camera, sun } = base;
  camera.inputs.clear();
  sun.direction = new Vector3(-1, -0.15, 0.4);
  sun.intensity = 3;
  buildStarfield(scene, 4000, 2000);
  const earth = createPlanet(scene, 'earth', 30);
  earth.position = new Vector3(6, -22, 18);
  const probe = new ProbeModel(scene, mats);
  probe.rebuild(referenceConfig('jupiter-system').installed);
  probe.root.scaling.setAll(0.9);
  probe.root.position = new Vector3(-2, 0.5, 0);
  probe.root.rotation = new Vector3(0.25, 0.6, -0.15);
  const glow = new GlowLayer('glow', scene);
  glow.intensity = 0.4;
  let t = 0;
  return {
    scene,
    update(dt) {
      t += dt;
      earth.rotation.y += dt * 0.01;
      probe.root.rotation.y += dt * 0.05;
      camera.alpha = -2.2 + Math.sin(t * 0.05) * 0.2;
    },
    setQuality: base.setQuality,
    dispose() { probe.dispose(); scene.dispose(); },
  };
}

/* ───────────────────────── Hangar de lançadores ───────────────────────── */
export interface RocketHangarController extends SceneController {
  showVehicle(vehicle: LaunchVehicle): void;
  currentHeight(): number;
}

export function createRocketHangarScene(engine: Engine, maxHeightM: number): RocketHangarController {
  // Galpão dimensionado para o maior veículo do catálogo
  const H = Math.ceil(maxHeightM * 1.18);
  const base = createBaseScene(engine, { clear: new Color4(0.05, 0.06, 0.07, 1), target: new Vector3(0, 30, 0), radius: 140, alpha: -Math.PI / 2.3, beta: 1.32, maxZ: 6000, exposure: 1.15, environment: 'hangar', environmentIntensity: 0.8 });
  const { scene, mats, camera, shadows } = base;
  buildHangar(base, { width: 120, depth: 140, height: H, bays: 7, withCrane: true, doorSide: 'back' });
  camera.lowerRadiusLimit = 20;
  camera.upperRadiusLimit = H * 2.2;
  // Plataforma de transporte e torre de serviço
  const transporter = MeshBuilder.CreateBox('transporter', { width: 22, depth: 18, height: 2 }, scene);
  transporter.position.y = 1;
  transporter.material = mats.get('darkSteel');
  const tower = MeshBuilder.CreateBox('serviceTower', { width: 5, depth: 5, height: H * 0.85 }, scene);
  tower.position = new Vector3(-16, H * 0.425, 6);
  tower.material = mats.get('steel');
  for (let k = 1; k < 8; k++) {
    const deck = MeshBuilder.CreateBox(`towerDeck${k}`, { width: 9, depth: 2.4, height: 0.25 }, scene);
    deck.position = new Vector3(-12, (k / 8) * H * 0.8, 6);
    deck.material = mats.get('yellowSafety');
  }
  let rocket: RocketModel | null = null;
  let targetY = 30;
  let targetR = 140;
  // Enquadramento animado só durante a transição: depois o zoom e a rotação ficam com o jogador
  // (antes o raio era forçado a cada quadro e a roda do mouse não tinha efeito)
  let framing = false;
  return {
    scene,
    setQuality: base.setQuality,
    update(dt) {
      if (!framing) return;
      const k = Math.min(1, dt * 2.5);
      camera.target.y += (targetY - camera.target.y) * k;
      camera.radius += (targetR - camera.radius) * k;
      if (Math.abs(targetR - camera.radius) < 0.5 && Math.abs(targetY - camera.target.y) < 0.1) framing = false;
    },
    showVehicle(vehicle) {
      rocket?.dispose();
      rocket = buildRocket(scene, mats, vehicle);
      rocket.root.position.y = 2;
      rocket.root.getChildMeshes().forEach((m) => shadows?.addShadowCaster(m));
      // Enquadramento automático: o foguete inteiro cabe no campo de visão vertical
      const h = rocket.height + 2;
      targetY = h * 0.5;
      targetR = Math.min(camera.upperRadiusLimit ?? Infinity, (h * 0.62) / Math.tan(camera.fov / 2));
      framing = true;
    },
    currentHeight: () => rocket?.height ?? 0,
    dispose() { rocket?.dispose(); scene.dispose(); },
  };
}

/* ───────────────────────── Briefing 3D ───────────────────────── */
export interface BriefingController extends SceneController {
  setup(installed: InstalledComponent[], vehicle: LaunchVehicle | undefined): void;
  setView(v: 'overview' | 'inspect'): void;
  onPick(cb: (componentId: string) => void): void;
  highlight(componentId: string | null): void;
}

export function createBriefingScene(engine: Engine): BriefingController {
  const base = createBaseScene(engine, { clear: new Color4(0.03, 0.04, 0.05, 1), target: new Vector3(0, 2, 0), radius: 16, alpha: -Math.PI / 2.1, beta: 1.25, maxZ: 3000, environment: 'hangar', environmentIntensity: 0.8 });
  const { scene, mats, camera, shadows } = base;
  const floor = MeshBuilder.CreateGround('floor', { width: 200, height: 200 }, scene);
  floor.material = mats.get('concrete');
  floor.receiveShadows = true;
  const ring = MeshBuilder.CreateTorus('ring', { diameter: 7, thickness: 0.05, tessellation: 64 }, scene);
  ring.position.y = 0.02;
  const rm = new StandardMaterial('ringMat', scene);
  rm.emissiveColor = new Color3(0.2, 0.6, 1);
  rm.disableLighting = true;
  ring.material = rm;
  const pedestal = MeshBuilder.CreateCylinder('pedestal', { diameter: 3.2, height: 0.8, tessellation: 48 }, scene);
  pedestal.position.y = 0.4;
  pedestal.material = mats.get('darkSteel');
  const probe = new ProbeModel(scene, mats);
  probe.root.position.y = 0.8;
  let rocket: RocketModel | null = null;
  const hl = new HighlightLayer('briefHl', scene);
  let hlMeshes: Mesh[] = [];
  let pickCb: ((id: string) => void) | null = null;
  scene.onPointerObservable.add((info) => {
    if (info.type !== PointerEventTypes.POINTERTAP) return;
    const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => Boolean(m.metadata?.componentId));
    const id = pick?.pickedMesh?.metadata?.componentId as string | undefined;
    if (id) pickCb?.(id);
  });
  let view: 'overview' | 'inspect' = 'overview';
  return {
    scene,
    setQuality: base.setQuality,
    setup(installed, vehicle) {
      probe.rebuild(installed);
      probe.root.getChildMeshes().forEach((m) => shadows?.addShadowCaster(m));
      rocket?.dispose();
      rocket = null;
      if (vehicle) {
        rocket = buildRocket(scene, mats, vehicle);
        rocket.root.position = new Vector3(24, 0, 30);
        rocket.root.getChildMeshes().forEach((m) => { m.isPickable = false; shadows?.addShadowCaster(m); });
      }
      if (view === 'overview') { camera.setTarget(new Vector3(8, Math.max(3, (rocket?.height ?? 10) * 0.25), 12)); camera.radius = Math.max(40, (rocket?.height ?? 30) * 1.3); }
    },
    setView(v) {
      view = v;
      if (v === 'inspect') { camera.setTarget(new Vector3(0, 0.8 + probe.height / 2, 0)); camera.radius = 9; camera.beta = 1.2; }
      else { camera.setTarget(new Vector3(8, Math.max(3, (rocket?.height ?? 10) * 0.25), 12)); camera.radius = Math.max(40, (rocket?.height ?? 30) * 1.3); }
    },
    onPick(cb) { pickCb = cb; },
    highlight(componentId) {
      hlMeshes.forEach((m) => hl.removeMesh(m));
      hlMeshes = [];
      if (!componentId) return;
      for (const p of probe.partNodes) if (p.componentId === componentId) for (const m of p.node.getChildMeshes() as Mesh[]) { hl.addMesh(m, Color3.FromHexString('#f2a33a')); hlMeshes.push(m); }
    },
    update(dt) { probe.root.rotation.y += view === 'overview' ? dt * 0.15 : 0; },
    dispose() { hl.dispose(); probe.dispose(); rocket?.dispose(); scene.dispose(); },
  };
}

/* ───────────────────────── Visualização orbital ───────────────────────── */
export { createOrbitScene, type OrbitConfig, type OrbitLeg, type OrbitPathSpec, type OrbitSceneController, type OrbitView } from './orbitScene';

/** Converte amostras [t, x, y, z] (m) em pontos de cena com escala (m por unidade). Babylon é y-up. */
export function samplesToPoints(samples: number[][], metersPerUnit: number): Vector3[] {
  return samples.map((s) => new Vector3(s[1]! / metersPerUnit, s[3]! / metersPerUnit, s[2]! / metersPerUnit));
}

export function ellipsePoints(a: number, e: number, metersPerUnit: number, n = 256, rotation = 0, inclinationDeg = 0): Vector3[] {
  const pts: Vector3[] = [];
  const inc = (inclinationDeg * Math.PI) / 180;
  for (let i = 0; i <= n; i++) {
    const nu = (i / n) * Math.PI * 2;
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
    const x = r * Math.cos(nu + rotation), y = r * Math.sin(nu + rotation);
    pts.push(new Vector3(x / metersPerUnit, (y * Math.sin(inc)) / metersPerUnit, (y * Math.cos(inc)) / metersPerUnit));
  }
  return pts;
}

export function arcPoints(from: Vector3, to: Vector3, height: number): Vector3[] {
  const mid = from.add(to).scale(0.5).add(new Vector3(0, height, 0));
  return Curve3.CreateQuadraticBezier(from, mid, to, 64).getPoints();
}
