/**
 * Cenas: tela inicial, hangar de lançadores, briefing 3D e visualização orbital.
 */
import {
  Color3, Color4, Curve3, type Engine, GlowLayer, HighlightLayer, type Mesh, MeshBuilder, PointerEventTypes,
  StandardMaterial, type TransformNode, Vector3,
} from '@babylonjs/core';
import type { LaunchVehicle } from '../../types/catalog';
import type { InstalledComponent } from '../../types/campaign';
import type { SceneController } from '../core/SceneManager';
import { loadNasaModel } from '../entities/nasaModels';
import { ProbeModel } from '../entities/probeModel';
import { CrewKit, createWorker, type Worker } from '../entities/humans';
import { buildRocket, type RocketModel } from '../entities/rocketModel';
import { referenceConfig } from '../rules/presets';
import { buildHangar, createBaseScene, createPlanet } from './environment';
import { Members } from './integrationHall';
import { lattice, stairs } from './padStructures';
import { createStarfield } from './starfield';

/* ───────────────────────── Tela inicial ───────────────────────── */
export function createStartScene(engine: Engine): SceneController {
  const base = createBaseScene(engine, { clear: new Color4(0.005, 0.008, 0.015, 1), target: new Vector3(0, 0, 0), radius: 26, alpha: -2.2, beta: 1.35, shadows: false, exposure: 1.0, maxZ: 20000, environment: 'space', environmentIntensity: 0.35 });
  const { scene, mats, camera, sun } = base;
  camera.inputs.clear();
  sun.direction = new Vector3(-1, -0.15, 0.4);
  sun.intensity = 3;
  // Exposição de uma câmera com a Terra iluminada no quadro: só as estrelas mais brilhantes aparecem
  createStarfield(scene, { limitMag: 5.2 });
  const earth = createPlanet(scene, 'earth', 30);
  earth.position = new Vector3(6, -22, 18);
  const probe = new ProbeModel(scene, mats);
  probe.rebuild(referenceConfig('jupiter-system').installed);
  probe.root.scaling.setAll(0.9);
  probe.root.position = new Vector3(-2, 0.5, 0);
  probe.root.rotation = new Vector3(0.25, 0.6, -0.15);
  // Quando o modelo da Juno (NASA 3D Resources) termina de carregar, ele substitui a sonda procedural
  let hero: TransformNode = probe.root;
  let disposed = false;
  void loadNasaModel(scene, 'juno', 7).then((juno) => {
    if (!juno) return;
    if (disposed) { juno.dispose(); return; }
    // À direita do título, inclinada para mostrar os três painéis solares
    juno.position = new Vector3(3.6, 1.6, -4);
    juno.rotation = new Vector3(0.9, 0.6, -0.3);
    probe.root.setEnabled(false);
    hero = juno;
  });
  const glow = new GlowLayer('glow', scene);
  glow.intensity = 0.4;
  let t = 0;
  return {
    scene,
    update(dt) {
      t += dt;
      earth.rotation.y += dt * 0.01;
      hero.rotation.y += dt * 0.05;
      camera.alpha = -2.2 + Math.sin(t * 0.05) * 0.2;
    },
    setQuality: base.setQuality,
    dispose() { disposed = true; probe.dispose(); scene.dispose(); },
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
  // Transportador (berço com rodados) e torre de integração treliçada com plataformas de trabalho em balanço,
  // escada, guarda-corpos e umbilicais: o veículo fica na vertical ao lado da torre, como num prédio de
  // integração vertical (referência: VAB / prédios de integração de lançadores, docs/visual-references.md)
  const transporter = MeshBuilder.CreateBox('transporter', { width: 22, depth: 18, height: 2 }, scene);
  transporter.position.y = 1;
  transporter.material = mats.get('darkSteel');
  const mem = new Members(scene, mats);
  for (const x of [-9, -3, 3, 9]) for (const z of [-7.5, 7.5]) mem.bar(new Vector3(x, 0.55, z - 1), new Vector3(x, 0.55, z + 1), 1.1, 1.1, 'rubber', 'cyl');
  const towerH = H * 0.85;
  lattice(mem, new Vector3(-17, 0, 6), 6, 6, towerH, { panel: 5, col: 0.45, brace: 0.18, mat: 'padGrey', deckEvery: 2 });
  stairs(mem, new Vector3(-17, 0, 9.6), towerH - 4);
  // Plataformas de trabalho em balanço a cada ~10 m (grade, guarda-corpo amarelo, rodapé)
  for (let y = 10; y < towerH - 2; y += 10) {
    mem.block(new Vector3(-11.2, y, 6), new Vector3(5.6, 0.18, 3), 'grating');
    for (const z of [4.55, 7.45]) mem.bar(new Vector3(-14, y + 1.1, z), new Vector3(-8.4, y + 1.1, z), 0.06, 0.06, 'yellowSafety', 'cyl');
    mem.bar(new Vector3(-8.4, y + 1.1, 4.5), new Vector3(-8.4, y + 1.1, 7.5), 0.06, 0.06, 'yellowSafety', 'cyl');
    for (const z of [4.55, 7.45]) mem.bar(new Vector3(-14, y - 0.1, z), new Vector3(-14, y - 1.6, z), 0.2, 0.2, 'padGrey');
  }
  // Umbilicais e bandejas de cabos descendo pela torre
  mem.bar(new Vector3(-13.8, 0, 3.2), new Vector3(-13.8, towerH * 0.9, 3.2), 0.35, 0.35, 'rubber', 'cyl');
  mem.bar(new Vector3(-13.6, 0, 3.6), new Vector3(-13.6, towerH * 0.9, 3.6), 0.25, 0.25, 'galvanized', 'cyl');
  // Equipe em escala humana (macacão, capacete) junto ao transportador: referência de 1,75 m
  const crew = new CrewKit(scene);
  const workers: Worker[] = [
    createWorker(scene, crew, { outfit: 'coverall', helmet: 'white', position: new Vector3(12.5, 0, -4), yaw: -1.9, activity: 'clipboard', prop: 'clipboard', height: 1.76, seed: 71, lookAt: new Vector3(0, 6, 0) }),
    createWorker(scene, crew, { outfit: 'coverall', helmet: 'yellow', position: new Vector3(11.4, 0, -5.4), yaw: -1.6, activity: 'point', height: 1.7, seed: 73, lookAt: new Vector3(0, 14, 0) }),
    createWorker(scene, crew, { outfit: 'coverall', helmet: 'yellow', position: new Vector3(-9.5, 10.1, 6.2), yaw: Math.PI / 2, activity: 'inspect', prop: 'flashlight', height: 1.8, seed: 79, lookAt: new Vector3(-3, 11, 5) }),
    createWorker(scene, crew, { outfit: 'coverall', helmet: 'blue', position: new Vector3(-10, 0, -10), activity: 'walk', path: [new Vector3(-10, 0, -10), new Vector3(10, 0, -10), new Vector3(10, 0, -11), new Vector3(-10, 0, -11)], height: 1.74, seed: 83 }),
  ];
  for (const m of mem.all()) { m.receiveShadows = true; shadows?.addShadowCaster(m); }
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
      for (const w of workers) w.update(dt);
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
export { createOrbitScene, type ClockControl, type OrbitFocus, type OrbitInfo, type OrbitMission, type OrbitSceneController, type OrbitView, type ScaleMode } from './orbitScene';

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
