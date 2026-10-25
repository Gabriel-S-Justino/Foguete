/**
 * Plataforma de lançamento (ambiente distinto do hangar): torre de serviço, braços de acesso, linhas de
 * abastecimento, trincheira de chamas, torre d'água, para-raios e área de segurança. A posição e a atitude
 * do foguete, a pluma e as separações acompanham o estado calculado pelo LaunchController.
 *
 * Câmeras: geral (câmera de rastreio de longo alcance fixa no solo, com zoom óptico), rastreio (órbita em
 * volta do veículo), cinemática (gira lentamente em volta do veículo) e duas câmeras externas presas ao
 * último estágio, uma olhando para baixo (motores, separação, Terra) e outra para cima (corpo e coifa).
 * O zoom do jogador (roda do mouse ou botões) é um fator que multiplica o enquadramento automático de cada
 * câmera, por isso não é desfeito no quadro seguinte.
 */
import {
  Axis, Color3, Color4, DynamicTexture, type Engine, Matrix, MeshBuilder, Space, StandardMaterial,
  Texture, TransformNode, UniversalCamera, Vector3,
} from '@babylonjs/core';
import type { LaunchVehicle } from '../../types/catalog';
import type { InstalledComponent } from '../../types/campaign';
import type { SceneController } from '../core/SceneManager';
import { atmosphere } from '../atmosphere/us76';
import { createExhaust, type ExhaustEffect } from '../effects/exhaust';
import { createExplosion } from '../effects/explosion';
import { ProbeModel } from '../entities/probeModel';
import { buildRocket } from '../entities/rocketModel';
import type { LaunchController } from '../simulation/launchController';
import { buildStarfield, createBaseScene } from './environment';
import { createPlanet, siteOrientation } from './planets';

export type PadCamera = 'overview' | 'tracking' | 'cinematic' | 'externalDown' | 'externalUp';
export const PAD_CAMERAS: PadCamera[] = ['overview', 'tracking', 'cinematic', 'externalDown', 'externalUp'];

export interface LaunchPadController extends SceneController {
  bind(ctrl: LaunchController): void;
  setCamera(mode: PadCamera): void;
  /** Multiplica o zoom atual (>1 aproxima). */
  zoom(factor: number): void;
  resetZoom(): void;
  /** Estado das câmeras para depuração e testes ponta a ponta. */
  cameraInfo(): { mode: PadCamera; zoom: number; position: [number, number, number]; fov: number };
}

const PAD_H = 8;
/** Escala visual: 1:1 até 3 km de altitude; acima disso a distância é comprimida para caber na cena. */
const VISUAL_K = 0.08;
const visualAlt = (alt: number) => (alt < 3000 ? alt : 3000 + (alt - 3000) * VISUAL_K);
const visualDown = (d: number) => visualAlt(d) * 0.6;
/** Raio visual da Terra (unidades de cena) e base de lançamento usada para orientar a textura (Cabo Canaveral). */
const EARTH_R = 150000;
const SITE = { lat: 28.5, lon: -80.6 };
const ZOOM_MIN = 0.2, ZOOM_MAX = 12;

function groundTexture(engine: Engine, scene: import('@babylonjs/core').Scene): DynamicTexture {
  const size = 512;
  const tex = new DynamicTexture('groundTex', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#5d6b45';
  ctx.fillRect(0, 0, size, size);
  let seed = 41;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Manchas de vegetação rasteira, areia e solo exposto (litoral da Flórida)
  const palette = ['#6f7a4d', '#4f5e3a', '#857c5a', '#a29a78', '#3f4f32', '#6a6a48'];
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = palette[Math.floor(rnd() * palette.length)]!;
    ctx.globalAlpha = 0.12 + rnd() * 0.25;
    ctx.beginPath();
    ctx.ellipse(rnd() * size, rnd() * size, 4 + rnd() * 40, 3 + rnd() * 25, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = engine.getCaps().maxAnisotropy ? 8 : 1;
  return tex;
}

export function createLaunchPadScene(engine: Engine, vehicle: LaunchVehicle, installed: InstalledComponent[]): LaunchPadController {
  const base = createBaseScene(engine, { clear: new Color4(0.45, 0.62, 0.85, 1), target: new Vector3(0, 40, 0), radius: 230, alpha: -Math.PI / 2.6, beta: 1.38, maxZ: 800000, exposure: 1.15 });
  const { scene, mats, camera: arc, sun, shadows, pipeline } = base;
  arc.lowerRadiusLimit = null;
  arc.upperRadiusLimit = null;
  // O zoom é tratado pela cena (fator do jogador), não pela entrada padrão da câmera
  arc.inputs.removeByType('ArcRotateCameraMouseWheelInput');
  arc.pinchDeltaPercentage = 0;
  arc.pinchPrecision = 1e9;
  scene.fogMode = 2;
  scene.fogDensity = 0.00012;
  scene.fogColor = new Color3(0.62, 0.72, 0.85);
  sun.direction = new Vector3(-0.5, -0.8, 0.3);
  sun.intensity = 3.2;

  // Terra real abaixo da plataforma (aparece com a altitude) e estrelas acima da atmosfera
  const earth = createPlanet(scene, 'earth', EARTH_R * 2, { orientation: siteOrientation(SITE.lat, SITE.lon), segments: 128 });
  earth.position = new Vector3(0, -EARTH_R - 1.5, 0);
  const stars = buildStarfield(scene, 600000, 2600);
  stars.scaling.setAll(0.45);
  const starMat = stars.material as StandardMaterial;

  // Terreno, oceano e área de segurança
  const ground = MeshBuilder.CreateGround('ground', { width: 30000, height: 30000 }, scene);
  const gm = new StandardMaterial('groundMat', scene);
  gm.diffuseTexture = groundTexture(engine, scene);
  (gm.diffuseTexture as Texture).uScale = 60;
  (gm.diffuseTexture as Texture).vScale = 60;
  gm.specularColor = Color3.Black();
  ground.material = gm;
  ground.receiveShadows = true;
  const ocean = MeshBuilder.CreateGround('ocean', { width: 30000, height: 15000 }, scene);
  ocean.position = new Vector3(0, 0.3, 14000);
  const om = new StandardMaterial('oceanMat', scene);
  om.diffuseColor = new Color3(0.06, 0.2, 0.33);
  om.specularColor = new Color3(0.55, 0.55, 0.5);
  om.specularPower = 90;
  om.zOffset = -4; // evita cintilação com o terreno embaixo
  ocean.material = om;
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
  leg.material = mats.get('steel');
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as const) leg.thinInstanceAdd(Matrix.Translation(towerX + dx, PAD_H + towerH / 2, dz));
  const brace = MeshBuilder.CreateBox('towerBrace', { width: 0.35, depth: 0.35, height: 11.3 }, scene);
  brace.material = mats.get('steel');
  for (let y = PAD_H + 6; y < PAD_H + towerH; y += 8) {
    for (const z of [-4, 4]) brace.thinInstanceAdd(Matrix.RotationZ(0.78).multiply(Matrix.Translation(towerX, y, z)));
    for (const x of [-4, 4]) brace.thinInstanceAdd(Matrix.RotationX(0.78).multiply(Matrix.Translation(towerX + x, y, 0)));
  }
  const deck = MeshBuilder.CreateBox('towerDeck', { width: 9.5, depth: 9.5, height: 0.3 }, scene);
  deck.material = mats.get('darkSteel');
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

  // Foguete e carga útil (dentro da coifa). O nó de voo fica perto do centro de massa, para a
  // inclinação girar o veículo em torno dele (antes girava em torno do solo e "jogava" o foguete de lado).
  const pivotH = rocket.height * 0.4;
  const restY = PAD_H + 6 + pivotH;
  const flightNode = new TransformNode('flight', scene);
  flightNode.position.set(0, restY, 0);
  rocket.root.parent = flightNode;
  rocket.root.position.y = -pivotH;
  const probe = new ProbeModel(scene, mats, rocket.payload);
  probe.rebuild(installed);
  probe.root.scaling.setAll(0.9);
  rocket.root.getChildMeshes().forEach((m) => shadows?.addShadowCaster(m));

  // Pluma por grupo de motores (a nuvem da plataforma sai só do primeiro conjunto do primeiro estágio)
  const groundIdx = Math.max(0, rocket.enginePoints.findIndex((e) => e.group === 0));
  const exhausts = rocket.enginePoints.map((e, i) => ({
    group: e.group,
    fx: createExhaust(scene, e.node, { clusterDia: e.clusterDia, exitY: e.exitY, kind: e.plume, groundEmitter: i === groundIdx ? trenchExit : undefined }) as ExhaustEffect,
  }));

  // ── Câmeras ──
  const groundCam = new UniversalCamera('cam-ground', new Vector3(-420, PAD_H + 4, -560), scene);
  groundCam.minZ = 2;
  groundCam.maxZ = 800000;
  const mountedCam = (name: string, parent: TransformNode) => {
    const c = new UniversalCamera(name, Vector3.Zero(), scene);
    c.parent = parent;
    c.minZ = 0.05;
    c.maxZ = 800000;
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
  const canvas = engine.getRenderingCanvas();

  let ctrl: LaunchController | null = null;
  let mode: PadCamera = 'overview';
  let zoomF = 1;
  let separated = 0;
  let fairingDropped = false;
  let exploded = false;
  const falling: { node: TransformNode; v: Vector3; spin: number; axis: Vector3 }[] = [];
  let armsRetract = 0;
  let clampsOpen = 0;
  let tilt = 0;
  const lastPos = new Vector3(0, restY, 0);
  const vel = Vector3.Zero();
  let coastVel: Vector3 | null = null;
  let cinematicAlpha = -Math.PI / 1.6;
  let lastT = -1;

  const groupForStage = (stageIndex: number): number[] => {
    // Estágios paralelos (propulsores) queimam junto com o núcleo
    const stages = vehicle.stages;
    const active = [stageIndex];
    if (stages[stageIndex]?.parallel) active.push(stageIndex + 1);
    return active;
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

  const detach = (node: TransformNode, push: Vector3, spin: number, axis = Axis.Z) => {
    node.setParent(null);
    falling.push({ node, v: vel.add(push), spin, axis });
  };

  const controller: LaunchPadController = {
    scene,
    setQuality(level) { base.setQuality(level); exhausts.forEach((e) => e.fx.setQuality(level)); },
    bind(c) {
      ctrl = c;
      lastT = -1;
    },
    setCamera(m) {
      mode = m;
      zoomF = 1;
      if (m === 'tracking') { arc.alpha = -Math.PI / 2.2; arc.beta = 1.3; }
      if (m === 'cinematic') { cinematicAlpha = arc.alpha; arc.beta = 1.62; }
      activate(m);
    },
    zoom(f) { zoomF = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomF * f)); },
    resetZoom() { zoomF = 1; },
    cameraInfo() {
      const cam = scene.activeCamera!;
      const p = cam.globalPosition;
      return { mode, zoom: zoomF, position: [p.x, p.y, p.z], fov: cam.fov };
    },
    update(dt) {
      if (!ctrl) return;
      ctrl.tick(dt);
      const snap = ctrl.snapshot();
      const tel = snap.telemetry;
      const alt = Math.max(0, tel.altitudeM);
      const active = snap.state === 'flight' || snap.state === 'ignition';

      // Tempo simulado deste quadro: velocidades e objetos soltos usam o relógio da simulação, então a
      // aceleração de tempo e a pausa valem igualmente para o foguete e para estágios/coifa em queda
      let simDt = 0;
      // Posição: segue a simulação enquanto ela integra; depois (órbita, aborto, falha) segue balística
      if (active || coastVel === null) {
        flightNode.position.set(visualDown(Math.max(0, tel.downrangeM)), restY + visualAlt(alt), 0);
        if (lastT >= 0 && tel.t > lastT) {
          simDt = tel.t - lastT;
          const inst = flightNode.position.subtract(lastPos).scale(1 / simDt);
          Vector3.LerpToRef(vel, inst, Math.min(1, simDt * 4), vel);
        }
        lastT = tel.t;
        if (!active && alt > 1 && snap.state !== 'checks' && snap.state !== 'ready' && snap.state !== 'hold' && snap.state !== 'countdown') {
          coastVel = vel.clone();
          // Em órbita o veículo segue paralelo à superfície (sem cair nem subir na cena)
          if (snap.state === 'orbit') coastVel.y = 0;
        }
      } else if (!exploded) {
        simDt = dt * Math.max(1, snap.timeWarp);
        // Aborto/falha: queda balística com a gravidade na escala visual
        if (snap.state !== 'orbit') coastVel.y -= 9.8 * (flightNode.position.y > 3000 ? VISUAL_K : 1) * simDt;
        flightNode.position.addInPlace(coastVel.scale(simDt));
        vel.copyFrom(coastVel);
        if (snap.state !== 'orbit') flightNode.rotate(Axis.Z, 0.25 * dt, Space.LOCAL);
        if (flightNode.position.y < PAD_H) {
          exploded = true;
          createExplosion(scene, flightNode.position.clone(), Math.max(20, rocket.height * 0.6));
          flightNode.setEnabled(false);
        }
      } else {
        simDt = dt * Math.max(1, snap.timeWarp);
      }
      lastPos.copyFrom(flightNode.position);

      // Atitude: eixo do foguete a partir da arfagem simulada, com a mesma compressão de escala usada na
      // posição (assim o eixo coincide com a direção do movimento visto na tela). Suavizado: sem saltos.
      if (active && alt > 0.5) {
        const p = (tel.pitchDeg * Math.PI) / 180;
        const sx = (tel.downrangeM < 3000 ? 1 : VISUAL_K) * 0.6;
        const sy = alt < 3000 ? 1 : VISUAL_K;
        const target = Math.atan2(sx * Math.cos(p), sy * Math.sin(p));
        tilt += (Math.max(0, Math.min(Math.PI / 2, target)) - tilt) * Math.min(1, dt * 3);
        flightNode.rotation.z = -tilt;
      }

      // Terminação de voo: destruição controlada no ar
      if (!exploded && ctrl.flightOutcome === 'flight-terminated') {
        exploded = true;
        createExplosion(scene, flightNode.position.clone(), Math.max(20, rocket.height * 0.6));
        rocket.groups.forEach((g, i) => detach(g, new Vector3((i - 1) * 6, 4 + i * 2, (i % 2 ? 1 : -1) * 4), (i % 2 ? 1 : -1) * 0.8));
        if (rocket.fairing) detach(rocket.fairing, new Vector3(5, 6, -3), 1.2);
        exhausts.forEach((e) => e.fx.stop());
      }

      // Preparação: braços recolhem e garras liberam somente no lançamento
      if (['countdown', 'ignition', 'flight', 'orbit'].includes(snap.state)) armsRetract = Math.min(1, armsRetract + dt * 0.4);
      arms.forEach((a) => (a.rotation.y = armsRetract * 1.4));
      if (tel.phase === 'liftoff' || alt > 1) clampsOpen = Math.min(1, clampsOpen + dt * 2);
      clampNodes.forEach((c) => (c.rotation.x = clampsOpen * 0.8));

      // Separação de estágios sincronizada com os eventos da simulação: o estágio mantém a velocidade
      // do veículo, recebe um empurrão para trás pelo eixo e vai ficando para trás girando
      const axisDir = new Vector3(Math.sin(tilt), Math.cos(tilt), 0);
      while (separated < snap.stageSeparatedCount && !exploded) {
        const g = rocket.groups[separated];
        if (g && separated < rocket.groups.length - 1) detach(g, axisDir.scale(-6).add(new Vector3(0, 0, separated % 2 ? 1.5 : -1.5)), (separated % 2 ? 1 : -1) * 0.12);
        separated++;
      }
      if (!fairingDropped && !exploded && snap.events.some((e) => e.id === 'fairing') && rocket.fairing) {
        fairingDropped = true;
        // As duas metades abrem para fora em torno da dobradiça e se afastam
        rocket.fairingHalves.forEach((h, i) => {
          const out = new Vector3(Math.cos(tilt), -Math.sin(tilt), 0).scale(i === 0 ? 1 : -1);
          detach(h, out.scale(5).add(axisDir.scale(-1.5)), i === 0 ? -0.5 : 0.5);
        });
      }
      for (const fl of falling) {
        const k = fl.node.position.y > 3000 ? VISUAL_K : 1;
        fl.v.y -= 9.8 * k * simDt;
        // Arrasto só no ar denso; no vácuo o objeto só fica para trás porque o foguete continua acelerando
        if (fl.node.position.y < 3000) fl.v.scaleInPlace(1 - Math.min(0.5, 0.15 * simDt));
        fl.node.position.addInPlace(fl.v.scale(simDt));
        fl.node.rotate(fl.axis, fl.spin * simDt, Space.LOCAL);
        if (fl.node.position.y < -50) fl.node.setEnabled(false);
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

      // Céu escurece com a densidade atmosférica; estrelas aparecem; o solo dá lugar à Terra
      const viewAlt = Math.max(0, (scene.activeCamera?.globalPosition.y ?? 0) - PAD_H);
      const realViewAlt = viewAlt < 3000 ? viewAlt : 3000 + (viewAlt - 3000) / VISUAL_K;
      const k = Math.min(1, atmosphere(realViewAlt).densityKgM3 / 1.225) ** 0.35;
      scene.clearColor.set(0.45 * k ** 1.3, 0.62 * k ** 1.1, 0.85 * k + 0.01, 1);
      scene.fogDensity = 0.00012 * k;
      starMat.alpha = Math.max(0, 1 - k * 3);
      stars.setEnabled(starMat.alpha > 0.01);
      const groundFade = Math.max(0, Math.min(1, 1 - (viewAlt - 4000) / 6000));
      gm.alpha = groundFade;
      om.alpha = groundFade;
      ground.setEnabled(groundFade > 0.01);
      ocean.setEnabled(groundFade > 0.01);
      // Perto do solo a Terra fica escondida pelo terreno: não desenhar economiza GPU
      earth.setEnabled(viewAlt > 1200);

      // ── Câmeras ──
      const center = flightNode.position.clone();
      const shake = snap.vibrationG > 1 && alt < 3000 && active ? Math.min(0.6, snap.vibrationG * 0.05) * (1 - alt / 3000) : 0;
      if (mode === 'overview') {
        // Câmera de rastreio de longo alcance: fixa no solo, aponta para o foguete e fecha o zoom com a distância
        const aim = center.add(new Vector3((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2, 0));
        groundCam.setTarget(aim);
        const dist = Vector3.Distance(groundCam.position, center);
        const frame = Math.max(rocket.height * 1.6, alt < 200 ? towerH * 2.2 : 0);
        groundCam.fov = Math.max(0.004, Math.min(1.2, (2 * Math.atan(frame / 2 / dist)) / zoomF));
      } else if (mode === 'tracking' || mode === 'cinematic') {
        arc.setTarget(center, false, true, true);
        const baseR = mode === 'tracking' ? Math.max(rocket.height * 2.6, 140) : rocket.height * 1.4;
        arc.radius = baseR / zoomF;
        arc.minZ = Math.max(0.1, arc.radius * 0.004);
        arc.upperBetaLimit = center.y > PAD_H + 300 ? Math.PI - 0.15 : Math.PI / 2 - 0.02;
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
    },
    dispose() {
      canvas?.removeEventListener('wheel', onWheel);
      arc.detachControl();
      exhausts.forEach((e) => e.fx.dispose());
      probe.dispose();
      scene.dispose();
    },
  };
  activate('overview');
  return controller;
}

