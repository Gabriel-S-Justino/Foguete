/**
 * Plataforma de lançamento (ambiente distinto do hangar): torre de serviço, braços de acesso, linhas de
 * abastecimento, trincheira de chamas, torre d'água, para-raios e área de segurança. A posição do foguete,
 * a pluma e as separações acompanham o estado calculado pelo LaunchController.
 */
import { Color3, Color4, type Engine, Matrix, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { LaunchVehicle } from '../../types/catalog';
import type { InstalledComponent } from '../../types/campaign';
import type { SceneController } from '../core/SceneManager';
import { atmosphere } from '../atmosphere/us76';
import { createExhaust, type ExhaustEffect } from '../effects/exhaust';
import { ProbeModel } from '../entities/probeModel';
import { buildRocket } from '../entities/rocketModel';
import type { LaunchController } from '../simulation/launchController';
import { createBaseScene } from './environment';

export type PadCamera = 'overview' | 'cinematic' | 'tracking' | 'onboard';

export interface LaunchPadController extends SceneController {
  bind(ctrl: LaunchController): void;
  setCamera(mode: PadCamera): void;
}

const PAD_H = 8;
const visualAlt = (alt: number) => (alt < 3000 ? alt : 3000 + (alt - 3000) * 0.08);

export function createLaunchPadScene(engine: Engine, vehicle: LaunchVehicle, installed: InstalledComponent[]): LaunchPadController {
  const base = createBaseScene(engine, { clear: new Color4(0.45, 0.62, 0.85, 1), target: new Vector3(0, 40, 0), radius: 230, alpha: -Math.PI / 2.6, beta: 1.38, maxZ: 60000, exposure: 1.15 });
  const { scene, mats, camera, sun, shadows } = base;
  camera.upperRadiusLimit = 4000;
  scene.fogMode = 2;
  scene.fogDensity = 0.00012;
  scene.fogColor = new Color3(0.62, 0.72, 0.85);
  sun.direction = new Vector3(-0.5, -0.8, 0.3);
  sun.intensity = 3.2;

  // Terreno, oceano e área de segurança
  const ground = MeshBuilder.CreateGround('ground', { width: 30000, height: 30000 }, scene);
  const gm = new StandardMaterial('groundMat', scene);
  gm.diffuseColor = new Color3(0.36, 0.42, 0.3);
  gm.specularColor = Color3.Black();
  ground.material = gm;
  const ocean = MeshBuilder.CreateGround('ocean', { width: 30000, height: 15000 }, scene);
  ocean.position = new Vector3(0, 0.3, 14000);
  const om = new StandardMaterial('oceanMat', scene);
  om.diffuseColor = new Color3(0.1, 0.25, 0.4);
  om.specularColor = new Color3(0.4, 0.4, 0.4);
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
    const t = MeshBuilder.CreateTube(name, { path: [from, from.add(new Vector3(0, 0, 0)).add(to.subtract(from).scale(0.5)).add(new Vector3(0, -2, 0)), to], radius: 0.5, tessellation: 12 }, scene);
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

  // Foguete e carga útil (dentro da coifa)
  rocket.root.position.y = PAD_H + 6;
  const probe = new ProbeModel(scene, mats, rocket.payload);
  probe.rebuild(installed);
  probe.root.scaling.setAll(0.9);
  rocket.root.getChildMeshes().forEach((m) => shadows?.addShadowCaster(m));
  const flightNode = new TransformNode('flight', scene);
  rocket.root.parent = flightNode;

  // Pluma por grupo de motores
  const exhausts = rocket.enginePoints.map((e) => ({ group: e.group, fx: createExhaust(scene, e.node, Math.max(0.6, rocket.diameter / 12), padBase) as ExhaustEffect }));
  let ctrl: LaunchController | null = null;
  let mode: PadCamera = 'overview';
  let separated = 0;
  let fairingDropped = false;
  const falling: { node: TransformNode; v: Vector3; spin: number }[] = [];
  let armsRetract = 0;
  let clampsOpen = 0;

  const groupForStage = (stageIndex: number): number[] => {
    // Estágios paralelos (propulsores) queimam junto com o núcleo
    const stages = vehicle.stages;
    const active = [stageIndex];
    if (stages[stageIndex]?.parallel) active.push(stageIndex + 1);
    return active;
  };

  return {
    scene,
    setQuality(level) { base.setQuality(level); exhausts.forEach((e) => e.fx.setQuality(level)); },
    bind(c) { ctrl = c; },
    setCamera(m) {
      mode = m;
      if (m === 'overview') { camera.radius = Math.max(230, rocket.height * 3); camera.beta = 1.38; }
      if (m === 'cinematic') { camera.radius = rocket.height * 1.2; camera.beta = 1.5; camera.alpha = -Math.PI / 1.6; }
      if (m === 'onboard') { camera.radius = rocket.diameter * 3; camera.beta = 1.1; }
    },
    update(dt) {
      if (!ctrl) return;
      ctrl.tick(dt);
      const snap = ctrl.snapshot();
      const tel = snap.telemetry;
      const alt = Math.max(0, tel.altitudeM);
      const vy = visualAlt(alt);
      const vx = visualAlt(Math.max(0, tel.downrangeM)) * 0.6;
      flightNode.position.set(vx, vy, 0);
      // Inclinação da trajetória (arfagem a partir da horizontal)
      const tilt = Math.max(0, Math.min(Math.PI / 2, Math.PI / 2 - (tel.pitchDeg * Math.PI) / 180));
      flightNode.rotation.z = alt > 200 ? -tilt * 0.9 : 0;

      // Preparação: braços recolhem e garras liberam somente no lançamento
      if (['countdown', 'ignition', 'flight', 'orbit'].includes(snap.state)) armsRetract = Math.min(1, armsRetract + dt * 0.4);
      arms.forEach((a) => (a.rotation.y = armsRetract * 1.4));
      if (tel.phase === 'liftoff' || alt > 1) clampsOpen = Math.min(1, clampsOpen + dt * 2);
      clampNodes.forEach((c) => (c.rotation.x = clampsOpen * 0.8));

      // Separação de estágios sincronizada com os eventos da simulação
      while (separated < snap.stageSeparatedCount) {
        const g = rocket.groups[separated];
        if (g) {
          const world = g.getAbsolutePosition().clone();
          g.parent = null;
          g.position = world;
          g.rotation.z = flightNode.rotation.z;
          falling.push({ node: g, v: new Vector3(-6, -2, 0), spin: (separated % 2 ? 1 : -1) * 0.1 });
        }
        separated++;
      }
      if (!fairingDropped && snap.events.some((e) => e.id === 'fairing') && rocket.fairing) {
        fairingDropped = true;
        const f = rocket.fairing;
        const world = f.getAbsolutePosition().clone();
        f.parent = null;
        f.position = world;
        falling.push({ node: f, v: new Vector3(4, -1, 6), spin: 0.3 });
      }
      for (const fl of falling) {
        fl.v.y -= 9.8 * dt * 0.3;
        fl.node.position.addInPlace(fl.v.scale(dt));
        fl.node.rotation.z += fl.spin * dt;
        if (fl.node.position.y < -50) fl.node.setEnabled(false);
      }

      // Pluma: empuxo e pressão ambiente vindos da simulação
      const atm = atmosphere(alt);
      const pressureRatio = atm.pressurePa / 101325;
      const activeGroups = groupForStage(tel.stageIndex);
      const throttle = tel.thrustN > 0 ? Math.min(1, 0.35 + (tel.engineState === 'startup' ? 0.4 * Math.min(1, tel.t / 2.5) : 0.65)) : 0;
      for (const e of exhausts) {
        const on = activeGroups.includes(e.group) && throttle > 0;
        e.fx.set(on ? throttle : 0, pressureRatio, alt < 120 ? 1 - alt / 120 : 0);
      }

      // Céu escurece com a densidade atmosférica
      const k = Math.min(1, atm.densityKgM3 / 1.225) ** 0.35;
      scene.clearColor.set(0.45 * k, 0.62 * k, 0.85 * k + 0.01, 1);
      scene.fogDensity = 0.00012 * k;

      // Câmeras
      const target = new Vector3(vx, vy + rocket.height * 0.5, 0);
      if (mode === 'tracking' || (mode !== 'overview' && alt > 50) || alt > 400) {
        camera.target = Vector3.Lerp(camera.target, target, Math.min(1, dt * 3));
        if (mode !== 'onboard') camera.radius = Math.min(4000, Math.max(rocket.height * 2.5, 230 + vy * 0.15));
      } else if (mode === 'overview') {
        camera.target = Vector3.Lerp(camera.target, new Vector3(0, PAD_H + rocket.height * 0.5, 0), Math.min(1, dt * 2));
      }
      if (snap.vibrationG > 1 && alt < 3000) {
        const s = Math.min(0.6, snap.vibrationG * 0.05) * (1 - alt / 3000);
        camera.alpha += (Math.random() - 0.5) * 0.004 * s;
        camera.beta += (Math.random() - 0.5) * 0.004 * s;
      }
    },
    dispose() {
      exhausts.forEach((e) => e.fx.dispose());
      probe.dispose();
      scene.dispose();
    },
  };
}
