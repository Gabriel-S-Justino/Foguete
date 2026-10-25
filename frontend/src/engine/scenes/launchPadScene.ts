/**
 * Plataforma de lançamento (ambiente distinto do hangar): torre de serviço, braços de acesso, linhas de
 * abastecimento, trincheira de chamas, torre d'água, para-raios e área de segurança. A posição e a atitude
 * do foguete, a pluma e as separações acompanham o estado calculado pelo LaunchController.
 *
 * Escala real: a Terra tem o raio verdadeiro e o foguete é colocado na posição (alcance, altitude) da
 * simulação sobre a superfície curva, com o eixo dado pela arfagem em relação ao horizonte local. Assim a
 * subida vertical, a curva de gravidade e a inserção em órbita aparecem exatamente como calculadas, sem
 * compressão de distâncias. Para não perder precisão em float32 a milhares de km, a cena usa origem
 * flutuante: todo o cenário fica sob `worldRoot`, que é deslocado quando o foguete se afasta da origem.
 *
 * Câmeras: geral (câmera de rastreio de longo alcance fixa no solo, com zoom óptico), rastreio (órbita em
 * volta do veículo, com o "para cima" no vertical local), cinemática (gira lentamente em volta do veículo)
 * e duas câmeras externas presas ao último estágio, uma olhando para baixo (motores, separação, Terra) e
 * outra para cima (corpo e coifa). O zoom do jogador (roda do mouse ou botões) é um fator que multiplica o
 * enquadramento automático de cada câmera, por isso não é desfeito no quadro seguinte.
 */
import {
  Axis, Color3, Color4, Constants, type Engine, Matrix, MeshBuilder, type ShaderMaterial,
  Space, StandardMaterial, TransformNode, UniversalCamera, Vector3,
} from '@babylonjs/core';
import type { LaunchVehicle } from '../../types/catalog';
import type { InstalledComponent } from '../../types/campaign';
import type { SceneController } from '../core/SceneManager';
import { atmosphere } from '../atmosphere/us76';
import { createExhaust, type ExhaustEffect, smokeTexture } from '../effects/exhaust';
import { createExplosion } from '../effects/explosion';
import { createSmokeTrail } from '../effects/smokeTrail';
import { ProbeModel } from '../entities/probeModel';
import { buildRocket } from '../entities/rocketModel';
import type { LaunchController } from '../simulation/launchController';
import { buildStarfield, createBaseScene } from './environment';
import { createPlanet, launchAzimuthDeg, siteOrientation } from './planets';
import { terrainTextures } from './terrain';

export type PadCamera = 'overview' | 'tracking' | 'cinematic' | 'externalDown' | 'externalUp';
export const PAD_CAMERAS: PadCamera[] = ['overview', 'tracking', 'cinematic', 'externalDown', 'externalUp'];

export interface LaunchPadController extends SceneController {
  bind(ctrl: LaunchController): void;
  setCamera(mode: PadCamera): void;
  /** Multiplica o zoom atual (>1 aproxima). */
  zoom(factor: number): void;
  resetZoom(): void;
  /** A sonda tem painéis solares (recolhidos no lançamento)? */
  readonly hasSolarArrays: boolean;
  /** Abre os painéis solares da sonda (com animação), visível pelas câmeras do veículo em órbita. */
  deployArrays(): void;
  /** Estado das câmeras para depuração e testes ponta a ponta (posições no referencial da plataforma, m). */
  cameraInfo(): {
    mode: PadCamera; zoom: number; position: [number, number, number]; fov: number;
    /** Posição do foguete e inclinação do eixo em relação à vertical da plataforma (graus). */
    rocketPad: [number, number, number]; tiltDeg: number;
    /** Partículas vivas no rastro de fumaça da trajetória. */
    smokeParticles: number;
  };
}

const PAD_H = 8;
const R_EARTH = 6_371_000;
const MU_EARTH = 3.986004418e14;
const OMEGA_EARTH = 7.2921159e-5;
/** Distância (m) do foguete à origem da cena que dispara a troca de origem flutuante. */
const REBASE_M = 2000;
/** Bases: inclinações altas (polar, heliossíncrona) saem de Vandenberg; as demais do Cabo Canaveral. */
const CAPE = { lat: 28.5, lon: -80.6 };
const VANDENBERG = { lat: 34.7, lon: -120.6 };
const ZOOM_MIN = 0.2, ZOOM_MAX = 12;
/** Grupos de renderização: céu, planeta e cena local. A profundidade é limpa entre eles. */
const G_SKY = 0, G_PLANET = 1, G_LOCAL = 2;
const FAR = 3e7;

interface Falling { node: TransformNode; v: Vector3; spin: number; axis: Vector3; drag: number }

export function createLaunchPadScene(engine: Engine, vehicle: LaunchVehicle, installed: InstalledComponent[]): LaunchPadController {
  const base = createBaseScene(engine, { clear: new Color4(0.45, 0.62, 0.85, 1), target: new Vector3(0, 40, 0), radius: 230, alpha: -Math.PI / 2.6, beta: 1.38, maxZ: FAR, exposure: 1.05, environment: 'outdoor', environmentIntensity: 0.6 });
  const { scene, mats, camera: arc, sun, shadows, pipeline } = base;
  arc.lowerRadiusLimit = null;
  arc.upperRadiusLimit = null;
  // O zoom é tratado pela cena (fator do jogador), não pela entrada padrão da câmera
  arc.inputs.removeByType('ArcRotateCameraMouseWheelInput');
  arc.pinchDeltaPercentage = 0;
  arc.pinchPrecision = 1e9;
  scene.fogMode = 2;
  scene.fogDensity = 0.0001;
  scene.fogColor = new Color3(0.62, 0.72, 0.85);
  sun.direction = new Vector3(-0.5, -0.8, 0.3);
  sun.intensity = 3.0;

  // Origem flutuante: posição (no referencial da plataforma) do ponto que está na origem da cena
  const worldRoot = new TransformNode('world-root', scene);
  const origin = Vector3.Zero();

  // Terra em tamanho real, centro a um raio abaixo da plataforma. A textura é orientada para a base e o
  // azimute do lançamento (o alcance da simulação corre sobre +X da cena).
  const earth = createPlanet(scene, 'earth', R_EARTH * 2, { orientation: siteOrientation(CAPE.lat, CAPE.lon), segments: 256 });
  const earthMat = earth.material as ShaderMaterial;
  earth.position.set(0, -R_EARTH, 0);
  earth.renderingGroupId = G_PLANET;
  for (const m of earth.getChildMeshes()) {
    m.renderingGroupId = G_PLANET;
    // Casca da atmosfera: a oclusão pelo planeta é feita no shader (ver planets.ts)
    if (m.material) m.material.depthFunction = Constants.ALWAYS;
  }
  const stars = buildStarfield(scene, 600000, 2600, 0.0011);
  stars.scaling.setAll(0.45);
  stars.renderingGroupId = G_SKY;
  stars.alwaysSelectAsActiveMesh = true;
  const starMat = stars.material as StandardMaterial;
  starMat.disableDepthWrite = true;

  // Terreno (vegetação de restinga), oceano a jusante e área de segurança
  const terrain = terrainTextures(scene);
  const ground = MeshBuilder.CreateGround('ground', { width: 21000, height: 30000 }, scene);
  ground.position.x = -4500;
  const gm = new StandardMaterial('groundMat', scene);
  gm.diffuseTexture = terrain.albedo;
  gm.bumpTexture = terrain.normal;
  gm.specularColor = new Color3(0.03, 0.03, 0.028);
  ground.material = gm;
  ground.receiveShadows = true;
  const ocean = MeshBuilder.CreateGround('ocean', { width: 24000, height: 30000 }, scene);
  ocean.position = new Vector3(18000, 0, 0);
  const om = new StandardMaterial('oceanMat', scene);
  om.diffuseColor = new Color3(0.04, 0.15, 0.24);
  om.specularColor = new Color3(0.4, 0.4, 0.38);
  om.specularPower = 140;
  om.bumpTexture = terrain.water;
  ocean.material = om;
  const apron = MeshBuilder.CreateGround('apron', { width: 280, height: 280 }, scene);
  apron.position.y = 0.08;
  apron.material = mats.get('asphalt');
  apron.receiveShadows = true;
  const padBase = MeshBuilder.CreateCylinder('padBase', { diameter: 120, height: PAD_H, tessellation: 8 }, scene);
  padBase.position.y = PAD_H / 2;
  padBase.material = mats.get('concrete');
  padBase.receiveShadows = true;
  const trench = MeshBuilder.CreateBox('flameTrench', { width: 14, depth: 70, height: 1 }, scene);
  trench.position = new Vector3(0, PAD_H - 0.4, 30);
  trench.material = mats.get('sootBlack');
  const mount = MeshBuilder.CreateBox('launchMount', { width: 26, depth: 26, height: 6 }, scene);
  mount.position.y = PAD_H + 3;
  mount.material = mats.get('darkSteel');
  const trenchExit = new TransformNode('trench-exit', scene);
  trenchExit.position = new Vector3(0, PAD_H + 1, 14);
  // Garras de sustentação
  const clampNodes: TransformNode[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const n = new TransformNode(`clamp${k}`, scene);
    n.position = new Vector3(Math.cos(a) * 5, PAD_H + 6, Math.sin(a) * 5);
    const c = MeshBuilder.CreateBox(`clampMesh${k}`, { width: 1.2, depth: 1.2, height: 3 }, scene);
    c.parent = n;
    c.position.y = 1.5;
    c.material = mats.get('yellowSafety');
    clampNodes.push(n);
  }
  const fence = MeshBuilder.CreateTorus('perimeter', { diameter: 700, thickness: 1.2, tessellation: 96 }, scene);
  fence.position.y = 1;
  fence.material = mats.get('yellowSafety');

  // Torre de serviço treliçada
  const rocket = buildRocket(scene, mats, vehicle);
  const towerH = rocket.height + 20;
  const towerX = -(rocket.diameter / 2 + 14);
  const leg = MeshBuilder.CreateBox('towerLeg', { width: 0.8, depth: 0.8, height: towerH }, scene);
  leg.material = mats.get('galvanized');
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as const) leg.thinInstanceAdd(Matrix.Translation(towerX + dx, PAD_H + towerH / 2, dz));
  const brace = MeshBuilder.CreateBox('towerBrace', { width: 0.35, depth: 0.35, height: 11.3 }, scene);
  brace.material = mats.get('galvanized');
  for (let y = PAD_H + 6; y < PAD_H + towerH; y += 8) {
    for (const z of [-4, 4]) brace.thinInstanceAdd(Matrix.RotationZ(0.78).multiply(Matrix.Translation(towerX, y, z)));
    for (const x of [-4, 4]) brace.thinInstanceAdd(Matrix.RotationX(0.78).multiply(Matrix.Translation(towerX + x, y, 0)));
  }
  const deck = MeshBuilder.CreateBox('towerDeck', { width: 9.5, depth: 9.5, height: 0.3 }, scene);
  deck.material = mats.get('grating');
  for (let y = PAD_H + 10; y < PAD_H + towerH; y += 10) deck.thinInstanceAdd(Matrix.Translation(towerX, y, 0));
  // Braços de acesso (recolhem antes da ignição)
  const arms: TransformNode[] = [];
  for (const frac of [0.35, 0.8]) {
    const pivot = new TransformNode(`accessArm${frac}`, scene);
    pivot.position = new Vector3(towerX + 4, PAD_H + rocket.height * frac, 0);
    const arm = MeshBuilder.CreateBox(`accessArmMesh${frac}`, { width: Math.abs(towerX) - rocket.diameter / 2 - 3, depth: 2.4, height: 2.4 }, scene);
    arm.position.x = (Math.abs(towerX) - rocket.diameter / 2 - 3) / 2;
    arm.material = mats.get('paintedWhite');
    arm.parent = pivot;
    arms.push(pivot);
  }
  // Linhas de abastecimento, tanques de solo, torre d'água e para-raios
  const line = (from: Vector3, to: Vector3, name: string, mat: 'steel' | 'paintedWhite') => {
    const t = MeshBuilder.CreateTube(name, { path: [from, from.add(to.subtract(from).scale(0.5)).add(new Vector3(0, -2, 0)), to], radius: 0.5, tessellation: 12 }, scene);
    t.material = mats.get(mat);
  };
  for (const [i, x] of [[0, -90], [1, -110]] as const) {
    const sph = MeshBuilder.CreateSphere(`groundTank${i}`, { diameter: 18, segments: 24 }, scene);
    sph.position = new Vector3(x, 9, -60);
    sph.material = mats.get('paintedWhite');
    line(new Vector3(x, 2, -52), new Vector3(towerX, PAD_H + 1, -3), `fuelLine${i}`, 'steel');
  }
  const water = MeshBuilder.CreateCylinder('waterTower', { diameter: 14, height: 30, tessellation: 24 }, scene);
  water.position = new Vector3(110, 15, 60);
  water.material = mats.get('paintedWhite');
  const mast = MeshBuilder.CreateCylinder('lightningMast', { diameterBottom: 1.4, diameterTop: 0.2, height: towerH + 30 }, scene);
  mast.material = mats.get('steel');
  for (const [x, z] of [[-60, -40], [60, -40], [0, 70]] as const) mast.thinInstanceAdd(Matrix.Translation(x, (towerH + 30) / 2, z));

  // Todo o cenário fixo (inclusive a Terra) passa a ficar sob a raiz do mundo (origem flutuante)
  for (const m of scene.meshes) if (!m.parent && m !== stars) m.parent = worldRoot;
  for (const t of scene.transformNodes) if (!t.parent && t !== worldRoot && t !== rocket.root) t.parent = worldRoot;

  // Foguete e carga útil (dentro da coifa). O nó de voo fica perto do centro de massa, para a
  // inclinação girar o veículo em torno dele.
  const pivotH = rocket.height * 0.4;
  const restY = PAD_H + 6 + pivotH;
  const flightNode = new TransformNode('flight', scene);
  flightNode.position.set(0, restY, 0);
  rocket.root.parent = flightNode;
  rocket.root.position.y = -pivotH;
  const probe = new ProbeModel(scene, mats, rocket.payload);
  probe.rebuild(installed);
  // Painéis solares e antenas dobrados: a sonda viaja dentro da coifa
  probe.setDeployment(0);
  const rocketMeshes = rocket.root.getChildMeshes();
  rocketMeshes.forEach((m) => { shadows?.addShadowCaster(m); m.applyFog = false; });
  let castersOn = true;

  // Pluma por grupo de motores (a nuvem da plataforma sai só do primeiro conjunto do primeiro estágio)
  const groundIdx = Math.max(0, rocket.enginePoints.findIndex((e) => e.group === 0));
  const exhausts = rocket.enginePoints.map((e, i) => ({
    group: e.group,
    dia: e.clusterDia,
    fx: createExhaust(scene, e.node, { clusterDia: e.clusterDia, exitY: e.exitY, kind: e.plume, groundEmitter: i === groundIdx ? trenchExit : undefined }) as ExhaustEffect,
  }));
  // Centro dos bocais de cada grupo no referencial do nó de voo (origem do rastro de fumaça da trajetória)
  flightNode.computeWorldMatrix(true);
  const flightInv = flightNode.getWorldMatrix().clone().invert();
  const groupNozzle = new Map<number, { offset: Vector3; dia: number }>();
  for (const e of exhausts) {
    const chain: TransformNode[] = [];
    for (let n: TransformNode | null = e.fx.nozzle; n; n = n.parent as TransformNode | null) chain.unshift(n);
    chain.forEach((n) => n.computeWorldMatrix(true));
    const local = Vector3.TransformCoordinates(e.fx.nozzle.getAbsolutePosition(), flightInv);
    const g = groupNozzle.get(e.group);
    if (!g) groupNozzle.set(e.group, { offset: local, dia: e.dia });
    else { g.offset = g.offset.add(local).scale(0.5); g.dia = Math.hypot(g.dia, e.dia); }
  }
  const firstPlume = exhausts[0]?.fx;
  const smokeColor = firstPlume ? firstPlume.smokeColor.clone() : new Color4(0.8, 0.78, 0.75, 0.5);
  smokeColor.a = Math.min(0.82, smokeColor.a * (0.95 + 0.5 * (firstPlume?.smokeAmount ?? 0.7)));
  const smoke = createSmokeTrail(scene, { texture: smokeTexture(scene), color: smokeColor, denseAltM: 15000, maxAltM: 45000 });

  // Grupos de renderização: tudo o que não é céu nem planeta é cena local
  const localGroup = (m: { renderingGroupId: number }) => { m.renderingGroupId = G_LOCAL; };
  for (const m of scene.meshes) if (m !== stars && m !== earth && m.parent !== earth) localGroup(m);
  const meshObs = scene.onNewMeshAddedObservable.add(localGroup);

  // ── Câmeras ──
  const groundCamPad = new Vector3(-420, PAD_H + 4, -560);
  const groundCam = new UniversalCamera('cam-ground', groundCamPad.clone(), scene);
  groundCam.minZ = 2;
  groundCam.maxZ = FAR;
  const mountedCam = (name: string, parent: TransformNode) => {
    const c = new UniversalCamera(name, Vector3.Zero(), scene);
    c.parent = parent;
    c.minZ = 0.05;
    c.maxZ = FAR;
    c.fov = 1.25;
    c.inputs.clear();
    return c;
  };
  const downCam = mountedCam('cam-external-down', rocket.cameraMounts.down);
  const upCam = mountedCam('cam-external-up', rocket.cameraMounts.up);
  for (const c of [groundCam, downCam, upCam]) {
    c.inputs.clear();
    try { pipeline?.addCamera(c); } catch { /* sem pós-processamento */ }
  }
  arc.maxZ = FAR;
  const canvas = engine.getRenderingCanvas();

  let ctrl: LaunchController | null = null;
  let mode: PadCamera = 'overview';
  let zoomF = 1;
  let quality = 2;
  let separated = 0;
  let fairingDropped = false;
  let exploded = false;
  const falling: Falling[] = [];
  let armsRetract = 0;
  let clampsOpen = 0;
  let tilt = 0;
  /** Posição do nó de voo no referencial da plataforma (m, float64) e velocidade nesse referencial. */
  const padPos = new Vector3(0, restY, 0);
  const padVel = Vector3.Zero();
  /** Rotação do referencial da plataforma no plano da órbita (ω·cos i), usada nas forças de Coriolis. */
  let padRate = OMEGA_EARTH * Math.cos((28.5 * Math.PI) / 180);
  let coast: 'none' | 'orbit' | 'ballistic' = 'none';
  let orbitRate = 0;
  let cinematicAlpha = -Math.PI / 1.6;
  let lastT = -1;
  /** Abertura dos painéis em andamento (fração inicial e início em relógio real; dura 8 s). */
  let deployT: { from: number; t0: number } | null = null;
  /** Depois do comando de abertura, o rastreio enquadra a sonda (painéis visíveis) em vez do veículo inteiro. */
  let probeFocus = false;
  const tmp = new Vector3();

  const groupForStage = (stageIndex: number): number[] => {
    // Estágios paralelos (propulsores) queimam junto com o núcleo
    const stages = vehicle.stages;
    const active = [stageIndex];
    if (stages[stageIndex]?.parallel) active.push(stageIndex + 1);
    return active;
  };

  /** Gravidade central + Coriolis e centrífuga do referencial da plataforma (que gira com a Terra). Devolve a altitude. */
  const accel = (p: Vector3, v: Vector3, out: Vector3) => {
    const cx = p.x, cy = p.y + R_EARTH, cz = p.z;
    const r = Math.hypot(cx, cy, cz);
    const g = -MU_EARTH / (r * r * r);
    const w = padRate;
    out.set(g * cx + w * w * cx - 2 * w * v.y, g * cy + w * w * cy + 2 * w * v.x, g * cz);
    return r - R_EARTH;
  };

  /** Troca de origem: o cenário, as partículas soltas no mundo e o rastro acompanham. */
  const rebase = () => {
    const rel = padPos.subtract(origin);
    if (rel.length() < REBASE_M) return;
    origin.addInPlace(rel);
    worldRoot.position.copyFrom(origin).scaleInPlace(-1);
    for (const ps of scene.particleSystems) {
      if (ps === smoke.system || ps.isLocal) continue;
      for (const p of (ps as unknown as { particles: { position: Vector3 }[] }).particles) p.position.subtractInPlace(rel);
      if (ps.emitter instanceof Vector3) ps.emitter.subtractInPlace(rel);
    }
    smoke.shift(rel);
    for (const l of scene.lights) if (!l.parent && l !== sun && 'position' in l) (l as unknown as { position: Vector3 }).position.subtractInPlace(rel);
  };

  const activate = (m: PadCamera) => {
    const cam = m === 'overview' ? groundCam : m === 'externalDown' ? downCam : m === 'externalUp' ? upCam : arc;
    if (scene.activeCamera !== cam) {
      if (scene.activeCamera === arc) arc.detachControl();
      scene.activeCamera = cam;
      if (cam === arc && canvas) arc.attachControl(canvas, true);
    }
  };

  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    zoomF = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomF * Math.exp(-ev.deltaY * 0.0012)));
  };
  canvas?.addEventListener('wheel', onWheel, { passive: false });

  /** Solta uma peça: ela passa a pertencer ao mundo e segue com a velocidade do veículo mais o empurrão. */
  const detach = (node: TransformNode, push: Vector3, spin: number, drag: number, axis = Axis.Z) => {
    node.setParent(worldRoot);
    falling.push({ node, v: padVel.add(push), spin, axis, drag });
  };

  const explode = (at: Vector3) => {
    exploded = true;
    createExplosion(scene, at, Math.max(20, rocket.height * 0.6));
  };

  const controller: LaunchPadController = {
    scene,
    setQuality(level) { base.setQuality(level); exhausts.forEach((e) => e.fx.setQuality(level)); quality = level; },
    bind(c) {
      ctrl = c;
      lastT = -1;
      // Base e azimute a partir da inclinação de lançamento: a Terra embaixo da trajetória é a verdadeira
      const incl = c.setup.profile.launchInclinationDeg;
      const site = incl > 60 ? VANDENBERG : CAPE;
      const o = siteOrientation(site.lat, site.lon, launchAzimuthDeg(incl, site.lat));
      earthMat.setMatrix('orient', o);
      earthMat.setMatrix('orientInv', o.clone().transpose());
      padRate = OMEGA_EARTH * Math.cos((incl * Math.PI) / 180);
    },
    setCamera(m) {
      mode = m;
      zoomF = 1;
      if (m === 'tracking') {
        // Com a sonda em foco: à frente dela (eixo do veículo), um pouco de lado, para ver os painéis de frente
        arc.alpha = probeFocus ? 0.45 : -Math.PI / 2.2;
        arc.beta = probeFocus ? 1.2 : 1.3;
      }
      if (m === 'cinematic') { cinematicAlpha = arc.alpha; arc.beta = 1.62; }
      activate(m);
    },
    zoom(f) { zoomF = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomF * f)); },
    resetZoom() { zoomF = 1; },
    hasSolarArrays: probe.hasSolarArrays,
    deployArrays() {
      if (!probeFocus && mode === 'tracking') { arc.alpha = 0.45; arc.beta = 1.2; }
      probeFocus = true;
      if (deployT === null && probe.deploymentFraction < 1) deployT = { from: probe.deploymentFraction, t0: performance.now() };
    },
    cameraInfo() {
      const cam = scene.activeCamera!;
      const p = cam.globalPosition;
      return {
        mode, zoom: zoomF, position: [p.x + origin.x, p.y + origin.y, p.z + origin.z], fov: cam.fov,
        rocketPad: [padPos.x, padPos.y, padPos.z], tiltDeg: (tilt * 180) / Math.PI,
        smokeParticles: smoke.system.getActiveCount(),
      };
    },
    update(dt) {
      if (!ctrl) return;
      ctrl.tick(dt);
      const snap = ctrl.snapshot();
      const tel = snap.telemetry;
      const alt = Math.max(0, tel.altitudeM);
      const active = snap.state === 'flight' || snap.state === 'ignition';
      const prelaunch = ['checks', 'ready', 'hold', 'countdown', 'scrubbed'].includes(snap.state);

      // Tempo simulado deste quadro: velocidades e objetos soltos usam o relógio da simulação, então a
      // aceleração de tempo e a pausa valem igualmente para o foguete e para estágios/coifa em queda
      let simDt = 0;
      let theta = Math.atan2(padPos.x, padPos.y + R_EARTH);
      if (coast === 'none') {
        // Posição sobre a Terra curva: ângulo central = alcance / raio; altura medida no vertical local
        theta = Math.max(-0.5, tel.downrangeM) / R_EARTH;
        const r = R_EARTH + restY + alt;
        padPos.set(r * Math.sin(theta), r * Math.cos(theta) - R_EARTH, 0);
        const vert = tel.verticalSpeedMS;
        const horiz = Math.sqrt(Math.max(0, tel.surfaceSpeedMS ** 2 - vert ** 2));
        padVel.set(Math.sin(theta) * vert + Math.cos(theta) * horiz, Math.cos(theta) * vert - Math.sin(theta) * horiz, 0);
        if (lastT >= 0 && tel.t > lastT) simDt = tel.t - lastT;
        lastT = tel.t;
        if (!active && !prelaunch && alt > 1) {
          // Fim da simulação de subida: em órbita o veículo segue em altitude constante; em aborto ou
          // falha cai em trajetória balística
          coast = snap.state === 'orbit' ? 'orbit' : 'ballistic';
          orbitRate = horiz / r;
        }
      } else if (!exploded) {
        simDt = dt * Math.max(1, snap.timeWarp);
        if (coast === 'orbit') {
          const r = Math.hypot(padPos.x, padPos.y + R_EARTH);
          theta += orbitRate * simDt;
          padPos.set(r * Math.sin(theta), r * Math.cos(theta) - R_EARTH, 0);
          const v = orbitRate * r;
          padVel.set(Math.cos(theta) * v, -Math.sin(theta) * v, 0);
        } else {
          const h = accel(padPos, padVel, tmp);
          padVel.addInPlace(tmp.scale(simDt));
          padPos.addInPlace(padVel.scale(simDt));
          flightNode.rotate(Axis.Z, 0.25 * dt, Space.LOCAL);
          if (h < PAD_H) {
            rebase();
            explode(padPos.subtract(origin));
            flightNode.setEnabled(false);
            exhausts.forEach((e) => e.fx.stop());
          }
        }
      } else {
        simDt = dt * Math.max(1, snap.timeWarp);
      }
      rebase();
      flightNode.position.copyFrom(padPos).subtractInPlace(origin);

      // Atitude: eixo do foguete = arfagem em relação ao horizonte local, somada à curvatura (o vertical
      // local a um alcance d está girado d/R em relação ao vertical da plataforma). Suavizado: sem saltos.
      if (!exploded && coast !== 'ballistic') {
        let target = tilt;
        if (coast === 'orbit') target = Math.PI / 2 + theta;
        else if (active && alt > 0.5) target = Math.PI / 2 - (tel.pitchDeg * Math.PI) / 180 + theta;
        tilt += (target - tilt) * Math.min(1, dt * 3);
        flightNode.rotation.z = -tilt;
      }

      // Sombras só fazem sentido perto da plataforma
      if (castersOn && alt > 400 && shadows) {
        castersOn = false;
        rocketMeshes.forEach((m) => shadows.removeShadowCaster(m));
      }

      // Terminação de voo: destruição controlada no ar
      if (!exploded && ctrl.flightOutcome === 'flight-terminated') {
        explode(flightNode.position.clone());
        rocket.groups.forEach((g, i) => detach(g, new Vector3((i - 1) * 6, 4 + i * 2, (i % 2 ? 1 : -1) * 4), (i % 2 ? 1 : -1) * 0.8, 4e-4));
        if (rocket.fairing) detach(rocket.fairing, new Vector3(5, 6, -3), 1.2, 3e-3);
        exhausts.forEach((e) => e.fx.stop());
      }

      // Preparação: braços recolhem e garras liberam somente no lançamento
      if (['countdown', 'ignition', 'flight', 'orbit'].includes(snap.state)) armsRetract = Math.min(1, armsRetract + dt * 0.4);
      arms.forEach((a) => (a.rotation.y = armsRetract * 1.4));
      if (tel.phase === 'liftoff' || alt > 1) clampsOpen = Math.min(1, clampsOpen + dt * 2);
      clampNodes.forEach((c) => (c.rotation.x = clampsOpen * 0.8));

      // Separação de estágios sincronizada com os eventos da simulação: o estágio mantém a velocidade
      // do veículo, recebe um empurrão para trás pelo eixo e fica para trás porque o resto continua acelerando
      const axisDir = new Vector3(Math.sin(tilt), Math.cos(tilt), 0);
      while (separated < snap.stageSeparatedCount && !exploded) {
        const g = rocket.groups[separated];
        if (g && separated < rocket.groups.length - 1) detach(g, axisDir.scale(-3).add(new Vector3(0, 0, separated % 2 ? 0.8 : -0.8)), (separated % 2 ? 1 : -1) * 0.06, 2e-4);
        separated++;
      }
      if (!fairingDropped && !exploded && snap.events.some((e) => e.id === 'fairing') && rocket.fairing) {
        fairingDropped = true;
        // As duas metades abrem para fora em torno da dobradiça e se afastam
        rocket.fairingHalves.forEach((h, i) => {
          const out = new Vector3(Math.cos(tilt), -Math.sin(tilt), 0).scale(i === 0 ? 1 : -1);
          detach(h, out.scale(4).add(axisDir.scale(-1)), i === 0 ? -0.5 : 0.5, 3e-3);
        });
      }
      for (const fl of falling) {
        if (!fl.node.isEnabled() || simDt <= 0) continue;
        const h = accel(fl.node.position, fl.v, tmp);
        fl.v.addInPlace(tmp.scale(simDt));
        // Arrasto proporcional à densidade do ar (coeficiente balístico aproximado de cada peça)
        const rho = atmosphere(Math.max(0, h)).densityKgM3;
        if (rho > 1e-7) fl.v.scaleInPlace(1 / (1 + fl.drag * rho * fl.v.length() * simDt));
        fl.node.position.addInPlace(fl.v.scale(simDt));
        fl.node.rotate(fl.axis, fl.spin * simDt, Space.LOCAL);
        if (h < 0 || Vector3.Distance(fl.node.position, padPos) > 600000) fl.node.setEnabled(false);
      }

      // Pluma: empuxo e pressão ambiente vindos da simulação
      const atm = atmosphere(alt);
      const pressureRatio = atm.pressurePa / 101325;
      const activeGroups = groupForStage(tel.stageIndex);
      const throttle = !active || exploded || tel.thrustN <= 0 ? 0
        : tel.engineState === 'startup' ? 0.35 + 0.65 * Math.min(1, tel.t / 2.5)
        : tel.engineState === 'throttled' ? 0.72 : tel.engineState === 'shutdown' ? 0 : 1;
      const groundK = alt < 150 ? 1 - alt / 150 : 0;
      exhausts.forEach((e, i) => {
        const on = activeGroups.includes(e.group) && throttle > 0;
        e.fx.set(on ? throttle : 0, pressureRatio, i === groundIdx ? groundK : 0);
      });
      // Rastro de fumaça ao longo da trajetória: sai do grupo de motores mais baixo que está queimando,
      // denso até ~15 km e encerrado a 45 km
      const trailGroup = activeGroups.map((g) => groupNozzle.get(g)).find(Boolean);
      if (trailGroup && throttle > 0 && alt > 2) {
        const nozzleWorld = Vector3.TransformCoordinates(trailGroup.offset, Matrix.RotationZ(flightNode.rotation.z)).addInPlace(flightNode.position);
        smoke.update(nozzleWorld, alt, true, simDt, trailGroup.dia, quality);
      } else smoke.update(flightNode.position, alt, false, simDt, 1, quality);
      for (const ps of scene.particleSystems) if (ps.renderingGroupId !== G_LOCAL) ps.renderingGroupId = G_LOCAL;

      // ── Câmeras ──
      const center = flightNode.position;
      const shake = snap.vibrationG > 1 && alt < 3000 && active ? Math.min(0.6, snap.vibrationG * 0.05) * (1 - alt / 3000) : 0;
      const localUp = new Vector3(Math.sin(theta), Math.cos(theta), 0);
      if (mode === 'overview') {
        // Câmera de rastreio de longo alcance: fixa no solo, aponta para o foguete e fecha o zoom com a distância
        groundCam.position.copyFrom(groundCamPad).subtractInPlace(origin);
        const aim = center.add(new Vector3((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2, 0));
        groundCam.setTarget(aim);
        const dist = Vector3.Distance(groundCam.position, center);
        const frame = Math.max(rocket.height * 1.6, alt < 200 ? towerH * 2.2 : 0);
        groundCam.fov = Math.max(0.0015, Math.min(1.2, (2 * Math.atan(frame / 2 / dist)) / zoomF));
      } else if (mode === 'tracking' || mode === 'cinematic') {
        // "Para cima" da câmera = vertical local sob o foguete: o horizonte fica nivelado e a inclinação
        // do veículo aparece em relação a ele durante toda a subida
        if (Vector3.Distance(arc.upVector, localUp) > 1e-4) arc.upVector = localUp;
        const focusProbe = probeFocus && mode === 'tracking';
        arc.setTarget(focusProbe ? probe.root.getAbsolutePosition().clone() : center.clone(), false, true, true);
        const baseR = focusProbe ? 32 : mode === 'tracking' ? Math.max(rocket.height * 2.6, 140) : rocket.height * 1.4;
        arc.radius = baseR / zoomF;
        arc.minZ = Math.max(0.1, arc.radius * 0.004);
        arc.upperBetaLimit = alt > 300 ? Math.PI - 0.15 : Math.PI / 2 - 0.02;
        if (mode === 'cinematic') {
          cinematicAlpha += dt * 0.08;
          arc.alpha = cinematicAlpha;
        }
        arc.targetScreenOffset.set((Math.random() - 0.5) * shake * 4, (Math.random() - 0.5) * shake * 4);
      } else {
        const cam = mode === 'externalDown' ? downCam : upCam;
        cam.fov = Math.max(0.25, Math.min(1.6, 1.25 / zoomF));
        cam.rotation.z = (Math.random() - 0.5) * shake * 0.02;
        cam.rotation.x = (Math.random() - 0.5) * shake * 0.02;
      }

      if (deployT !== null) {
        const f = Math.min(1, deployT.from + (performance.now() - deployT.t0) / 8000);
        probe.setDeployment(f);
        if (f >= 1) deployT = null;
      }

      // Céu escurece com a densidade do ar na altitude da câmera; estrelas aparecem; o solo dá lugar à Terra
      const activeCam = scene.activeCamera ?? arc;
      activeCam.computeWorldMatrix();
      const camPad = activeCam.globalPosition.add(origin);
      const viewAlt = Math.max(0, Math.hypot(camPad.x, camPad.y + R_EARTH, camPad.z) - R_EARTH);
      const k = Math.min(1, atmosphere(viewAlt).densityKgM3 / 1.225) ** 0.35;
      scene.clearColor.set(0.45 * k ** 1.3, 0.62 * k ** 1.1, 0.85 * k + 0.004, 1);
      scene.fogDensity = 0.0001 * k;
      starMat.alpha = Math.max(0, 1 - k * 3);
      stars.setEnabled(starMat.alpha > 0.01);
      stars.position.copyFrom(activeCam.globalPosition);
      const groundFade = Math.max(0, Math.min(1, 1 - (viewAlt - 4000) / 6000));
      gm.alpha = groundFade;
      om.alpha = groundFade;
      ground.setEnabled(groundFade > 0.01);
      ocean.setEnabled(groundFade > 0.01);
      // Perto do solo a Terra fica escondida pelo terreno: não desenhar economiza GPU
      earth.setEnabled(viewAlt > 1200);
    },
    dispose() {
      canvas?.removeEventListener('wheel', onWheel);
      scene.onNewMeshAddedObservable.remove(meshObs);
      arc.detachControl();
      exhausts.forEach((e) => e.fx.dispose());
      smoke.dispose();
      probe.dispose();
      scene.dispose();
    },
  };
  activate('overview');
  return controller;
}
