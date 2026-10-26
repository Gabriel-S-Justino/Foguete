/**
 * Plataforma de lançamento (ambiente distinto do hangar). As estruturas de solo dependem da família do veículo
 * (padStructures.ts): torre de serviço, braços de acesso, linhas de abastecimento, trincheira de chamas,
 * torre d'água, para-raios e área de segurança. A posição e a atitude
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
import { buildRocket, fitPayload } from '../entities/rocketModel';
import { greenwichSiderealAngle } from '../orbital-mechanics/ephemeris';
import type { V3 } from '../orbital-mechanics/kepler';
import { BODIES } from '../orbital-mechanics/orbits';
import { type DetachedBody, type PadFrame, separate, stepDetached } from '../physics/debris';
import type { LaunchController } from '../simulation/launchController';
import { createBaseScene } from './environment';
import { buildPadComplex, applyMover } from './padStructures';
import { createStarfield } from './starfield';
import { createPlanet, launchAzimuthDeg, siteOrientation } from './planets';
import { createGroupAssigner } from './renderGroups';
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
    /** Peças soltas (estágios, propulsores, coifa): posição no referencial da plataforma (m), velocidade (m/s). */
    detached: { name: string; pad: [number, number, number]; speed: number; landed: boolean }[];
    /** Grupo de renderização da Terra (1: separado do grupo local, sem disputa de profundidade com o terreno). */
    earthGroup: number;
  };
}

const PAD_H = 8;
/** Mesmo raio e μ da simulação de subida: a altitude mostrada é a altitude da física. */
const R_EARTH = BODIES.earth.radius;
const MU_EARTH = BODIES.earth.mu;
const OMEGA_EARTH = BODIES.earth.rotationRate ?? 7.2921159e-5;
/** Distância (m) do foguete à origem da cena que dispara a troca de origem flutuante. */
const REBASE_M = 2000;
/** Bases: inclinações altas (polar, heliossíncrona) saem de Vandenberg; as demais do Cabo Canaveral. */
const CAPE = { lat: 28.5, lon: -80.6 };
const VANDENBERG = { lat: 34.7, lon: -120.6 };
const ZOOM_MIN = 0.2, ZOOM_MAX = 12;
/** Grupos de renderização: céu, planeta e cena local. A profundidade é limpa entre eles. */
const G_SKY = 0, G_PLANET = 1, G_LOCAL = 2;
const FAR = 3e7;

/**
 * Peça solta: nó-pivô no centro da peça (gira em torno do próprio centro), estado físico no referencial da
 * plataforma e `fresh` no quadro da separação (a peça começa exatamente onde estava presa e só passa a ser
 * integrada no quadro seguinte, junto com o veículo).
 */
interface Falling { node: TransformNode; body: DetachedBody; spin: number; axis: Vector3; fresh: boolean }

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
  // Grupos com profundidade própria: a Terra (milhares de km) não divide o buffer de profundidade com o
  // terreno e a plataforma (detalhes de centímetros); sem isso a superfície da Terra, poucos metros abaixo
  // do terreno, "vencia" o teste de profundidade em quadros alternados durante a subida
  const groups = createGroupAssigner(scene, G_LOCAL);
  groups.reserve(earth, G_PLANET);
  for (const m of earth.getChildMeshes()) {
    // Casca da atmosfera: a oclusão pelo planeta é feita no shader (ver planets.ts)
    if (m.material) m.material.depthFunction = Constants.ALWAYS;
  }
  // Estrelas do catálogo BSC5 orientadas para o céu local da base (hora sideral no instante da cena). Só
  // aparecem quando a câmera sai da atmosfera; com o Sol e a Terra iluminada no quadro, a exposição limita a V ≈ 5
  const lst = greenwichSiderealAngle(new Date());
  const skyFor = (lat: number, lon: number, az: number) => {
    const m = siteOrientation(lat, lon, az).asArray();
    return (v: V3): V3 => {
      // Equador inercial → fixo na Terra (giro pela hora sideral) → convenção do corpo (y = polo) → cena
      const xe = v[0] * Math.cos(lst) + v[1] * Math.sin(lst), ye = -v[0] * Math.sin(lst) + v[1] * Math.cos(lst);
      const b: V3 = [xe, v[2], ye];
      const row = (r: number) => b[0] * m[r * 4]! + b[1] * m[r * 4 + 1]! + b[2] * m[r * 4 + 2]!;
      return [row(0), row(1), row(2)];
    };
  };
  const stars = createStarfield(scene, { limitMag: 5.0, toScene: skyFor(CAPE.lat, CAPE.lon, 90) });
  groups.reserve(stars.mesh, G_SKY);
  stars.setVisibility(0);

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
  // Superfícies quase coplanares com o terreno: deslocamento de profundidade (polygon offset), que se mede
  // em passos do próprio buffer e por isso continua valendo com a câmera a quilômetros de distância
  const apronMat = mats.variant('asphalt', 'apronMat');
  apronMat.zOffset = -2;
  apronMat.zOffsetUnits = -4;
  apron.material = apronMat;
  apron.receiveShadows = true;
  const fence = MeshBuilder.CreateTorus('perimeter', { diameter: 700, thickness: 1.2, tessellation: 96 }, scene);
  fence.position.y = 1;
  fence.material = mats.get('yellowSafety');

  // Complexo de lançamento da família do veículo (torre, mesa, trincheira, propelente, água, para-raios)
  const rocket = buildRocket(scene, mats, vehicle);
  const pad = buildPadComplex(scene, mats, vehicle.id, rocket, PAD_H);
  const { arms, clamps: clampNodes, trenchExit, towerH } = pad;

  // Todo o cenário fixo (inclusive a Terra) passa a ficar sob a raiz do mundo (origem flutuante)
  for (const m of scene.meshes) if (!m.parent && m !== stars.mesh) m.parent = worldRoot;
  for (const t of scene.transformNodes) if (!t.parent && t !== worldRoot && t !== rocket.root) t.parent = worldRoot;

  // Foguete e carga útil (dentro da coifa). O nó de voo fica perto do centro de massa, para a
  // inclinação girar o veículo em torno dele.
  const pivotH = rocket.height * 0.4;
  const restY = pad.deckY + pivotH;
  const flightNode = new TransformNode('flight', scene);
  flightNode.position.set(0, restY, 0);
  rocket.root.parent = flightNode;
  rocket.root.position.y = -pivotH;
  const probe = new ProbeModel(scene, mats, rocket.payload);
  probe.rebuild(installed);
  // Painéis solares e antenas dobrados: a sonda viaja dentro da coifa
  probe.setDeployment(0);
  fitPayload(rocket, probe.root);
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


  // ── Câmeras ──
  const groundCamPad = new Vector3(-420, PAD_H + 4, -560);
  const groundCam = new UniversalCamera('cam-ground', groundCamPad.clone(), scene);
  groundCam.minZ = 2;
  groundCam.maxZ = FAR;
  const mountedCam = (name: string, parent: TransformNode) => {
    const c = new UniversalCamera(name, Vector3.Zero(), scene);
    c.parent = parent;
    // A câmera fica a ~0,5 m do costado: plano próximo de 0,25 m (antes 0,05 m, que deixava o buffer de
    // profundidade sem resolução para o solo a poucos km)
    c.minZ = 0.25;
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
  const frame: PadFrame = { mu: MU_EARTH, radius: R_EARTH, rate: OMEGA_EARTH * Math.cos((28.5 * Math.PI) / 180) };
  const rho = (h: number) => atmosphere(Math.max(0, h)).densityKgM3;
  let armsRetract = 0;
  let clampsOpen = 0;
  let tilt = 0;
  /** Posição do nó de voo no referencial da plataforma (m, float64) e velocidade nesse referencial. */
  const padPos = new Vector3(0, restY, 0);
  const padVel = Vector3.Zero();
  let coast: 'none' | 'orbit' | 'ballistic' = 'none';
  /** Estado do veículo depois do fim da simulação de subida (órbita ou queda balística). */
  let coastBody: DetachedBody | null = null;
  let cinematicAlpha = -Math.PI / 1.6;
  let lastT = -1;
  /** Abertura dos painéis em andamento (fração inicial e início em relógio real; dura 8 s). */
  let deployT: { from: number; t0: number } | null = null;
  /** Depois do comando de abertura, o rastreio enquadra a sonda (painéis visíveis) em vez do veículo inteiro. */
  let probeFocus = false;

  const groupForStage = (stageIndex: number): number[] => {
    // Estágios paralelos (propulsores) queimam junto com o núcleo
    const stages = vehicle.stages;
    const active = [stageIndex];
    if (stages[stageIndex]?.parallel) active.push(stageIndex + 1);
    return active;
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

  /**
   * Solta uma peça sem mudar a posição dela no mundo: um nó-pivô é criado no centro da peça, sob a raiz do
   * mundo, e a peça passa a ser filha dele (setParent preserva a transformação global). A física começa
   * com a posição e a velocidade do veículo neste quadro, mais a velocidade relativa `push` do mecanismo.
   */
  const detach = (node: TransformNode, push: Vector3, spin: number, drag: number, axis = Axis.Z) => {
    worldRoot.computeWorldMatrix(true);
    node.computeWorldMatrix(true);
    const meshes = node.getChildMeshes();
    meshes.forEach((m) => m.computeWorldMatrix(true));
    const { min, max } = node.getHierarchyBoundingVectors(true);
    const center = meshes.length ? min.add(max).scale(0.5) : node.getAbsolutePosition().clone();
    const pivot = new TransformNode(`${node.name}-solto`, scene);
    pivot.parent = worldRoot;
    // Raiz do mundo em −origem: posição local da peça = posição na cena + origem (referencial da plataforma)
    pivot.position.copyFrom(center).addInPlace(origin);
    pivot.computeWorldMatrix(true);
    node.setParent(pivot);
    falling.push({ node: pivot, body: separate(pivot.position, padVel, push, drag), spin, axis, fresh: true });
  };
  /** Unidades separáveis de um grupo de estágio: cada propulsor lateral sai sozinho; o núcleo sai inteiro. */
  const unitsOf = (groupIndex: number): TransformNode[] => rocket.units[groupIndex] ?? [];

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
      stars.setOrientation(skyFor(site.lat, site.lon, launchAzimuthDeg(incl, site.lat)));
      frame.rate = OMEGA_EARTH * Math.cos((incl * Math.PI) / 180);
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
        detached: falling.map((f) => ({ name: f.node.name, pad: [f.body.p.x, f.body.p.y, f.body.p.z] as [number, number, number], speed: Math.hypot(f.body.v.x, f.body.v.y, f.body.v.z), landed: f.body.landed })),
        earthGroup: earth.renderingGroupId,
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
          // Fim da simulação de subida: o veículo segue pela mesma física (gravidade central e o referencial
          // girante da plataforma), partindo do estado do fim da queima. Em órbita isso é a própria órbita
          // (perigeu e apogeu da inserção); em aborto ou falha é uma queda balística
          coast = snap.state === 'orbit' ? 'orbit' : 'ballistic';
          coastBody = separate(padPos, padVel, Vector3.Zero(), coast === 'orbit' ? 0 : 4e-4);
        }
      } else if (!exploded) {
        simDt = dt * Math.max(1, snap.timeWarp);
        const body = coastBody!;
        const h = stepDetached(frame, body, simDt, rho);
        padPos.set(body.p.x, body.p.y, body.p.z);
        padVel.set(body.v.x, body.v.y, body.v.z);
        theta = Math.atan2(padPos.x, padPos.y + R_EARTH);
        if (coast === 'ballistic') {
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
        // Em órbita, o conjunto estágio superior + sonda mantém atitude prógrada (eixo no vetor velocidade),
        // como no costeio antes da separação: a atitude segue a velocidade calculada, não o contrário
        if (coast === 'orbit') target = Math.atan2(padVel.x, padVel.y);
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
        rocket.groups.forEach((g, i) => { if (g.isDescendantOf(flightNode)) detach(g, new Vector3((i - 1) * 6, 4 + i * 2, (i % 2 ? 1 : -1) * 4), (i % 2 ? 1 : -1) * 0.8, 4e-4); });
        if (rocket.fairing && !fairingDropped) detach(rocket.fairing, new Vector3(5, 6, -3), 1.2, 3e-3);
        exhausts.forEach((e) => e.fx.stop());
      }

      // Preparação: braços recolhem e garras liberam somente no lançamento
      if (['countdown', 'ignition', 'flight', 'orbit'].includes(snap.state)) armsRetract = Math.min(1, armsRetract + dt * 0.4);
      arms.forEach((a) => applyMover(a, armsRetract));
      if (tel.phase === 'liftoff' || alt > 1) clampsOpen = Math.min(1, clampsOpen + dt * 2);
      clampNodes.forEach((c) => (c.rotation.x = clampsOpen * 0.8));

      // Separação de estágios sincronizada com os eventos da simulação: o estágio mantém a velocidade
      // do veículo, recebe um empurrão para trás pelo eixo e fica para trás porque o resto continua acelerando
      const axisDir = new Vector3(Math.sin(tilt), Math.cos(tilt), 0);
      while (separated < snap.stageSeparatedCount && !exploded) {
        if (separated < rocket.groups.length - 1) {
          const units = unitsOf(separated);
          const lateral = new Vector3(Math.cos(tilt), -Math.sin(tilt), 0);
          units.forEach((u, k) => {
            if (units.length > 1) {
              // Propulsores laterais: empurrados para fora (radialmente) pelos mecanismos de separação,
              // girando para longe do núcleo
              const out = rocket.unitOffsets.get(u) ?? new Vector3(k % 2 ? -1 : 1, 0, 0);
              const radial = lateral.scale(out.x).add(new Vector3(0, 0, out.z)).normalize();
              detach(u, radial.scale(1.5).add(axisDir.scale(-0.5)), 0.05, 3e-4, Vector3.Cross(axisDir, radial).normalize());
            } else {
              // Estágio inteiro: molas/retrofoguetes dão ~1 m/s para trás pelo eixo
              detach(u, axisDir.scale(-1).add(new Vector3(0, 0, separated % 2 ? 0.15 : -0.15)), (separated % 2 ? 1 : -1) * 0.02, 2e-4);
            }
          });
        }
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
        if (!fl.node.isEnabled()) continue;
        // No quadro da separação a peça fica onde estava presa (o veículo já avançou neste quadro); daí em
        // diante ela é integrada com o mesmo passo de tempo simulado do veículo
        if (fl.fresh) { fl.fresh = false; continue; }
        if (simDt <= 0) continue;
        stepDetached(frame, fl.body, simDt, rho);
        fl.node.position.set(fl.body.p.x, fl.body.p.y, fl.body.p.z);
        fl.node.rotate(fl.axis, fl.spin * simDt, Space.LOCAL);
        if (fl.body.landed || Vector3.Distance(fl.node.position, padPos) > 600000) fl.node.setEnabled(false);
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
        const frameH = Math.max(rocket.height * 1.6, alt < 200 ? towerH * 2.2 : 0);
        groundCam.fov = Math.max(0.0015, Math.min(1.2, (2 * Math.atan(frameH / 2 / dist)) / zoomF));
        // Plano próximo proporcional à distância quando o campo de visão é estreito (só o foguete aparece):
        // a resolução de profundidade cai com z²/near, e com near = 2 m as peças do foguete a 100 km de
        // distância disputavam profundidade entre si
        groundCam.minZ = groundCam.fov < 0.3 ? Math.max(2, Math.min(dist * 0.02, 5000)) : 2;
      } else if (mode === 'tracking' || mode === 'cinematic') {
        // "Para cima" da câmera = vertical local sob o foguete: o horizonte fica nivelado e a inclinação
        // do veículo aparece em relação a ele durante toda a subida
        if (Vector3.Distance(arc.upVector, localUp) > 1e-4) arc.upVector = localUp;
        const focusProbe = probeFocus && mode === 'tracking';
        arc.setTarget(focusProbe ? probe.root.getAbsolutePosition().clone() : center.clone(), false, true, true);
        const baseR = focusProbe ? 32 : mode === 'tracking' ? Math.max(rocket.height * 2.6, 140) : rocket.height * 1.4;
        arc.radius = baseR / zoomF;
        arc.minZ = Math.max(0.1, arc.radius * 0.02);
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
      stars.setVisibility(Math.max(0, 1 - k * 3));
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
      groups.dispose();
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
