/**
 * Visualização orbital (planejamento e operações) em escala física: Sol e os oito planetas nas posições das
 * efemérides do JPL, a Lua, a trajetória calculada em cônicas ajustadas (missionTrajectory) e a sonda montada
 * no hangar em tamanho real, com a atitude da fase da missão. Todas as posições são em metros.
 *
 * Precisão numérica:
 * - Origem flutuante: a cada quadro a cena é posicionada em relação ao ponto em foco (sonda, corpo ou Sol),
 *   calculado em precisão dupla; perto da câmera os números são pequenos.
 * - Dois grupos de renderização com projeções diferentes: o grupo 1 (corpos, órbitas e trajetória) usa um
 *   plano near proporcional à distância da superfície mais próxima; o grupo 2 (sonda, estágio e rastro local)
 *   usa near de 5 cm e limpa a profundidade. Assim o buffer de 24 bits não precisa cobrir de centímetros a UA.
 *
 * Escala: no modo "física" todos os corpos têm o raio real e marcadores na tela indicam onde estão; no modo
 * "didática" cada corpo é ampliado só o necessário para aparecer (fator mostrado no rótulo). As distâncias, a
 * trajetória e os dados da simulação nunca mudam com o modo.
 *
 * A sonda não tem esfera marcadora: longe dela, um rótulo HTML indica a posição; perto, aparece o modelo 3D.
 */
import {
  Color3, Color4, Constants, DynamicTexture, type LinesMesh, Matrix, type Mesh, MeshBuilder, Quaternion, StandardMaterial,
  Texture, TransformNode, Vector3, type Engine,
} from '@babylonjs/core';
import type { InstalledComponent } from '../../types/campaign';
import type { LaunchVehicle } from '../../types/catalog';
import type { SceneController } from '../core/SceneManager';
import { ProbeModel } from '../entities/probeModel';
import { buildRocket, type RocketModel } from '../entities/rocketModel';
import { attitudeBasis, type AttitudeMode, type Basis } from '../orbital-mechanics/attitude';
import { OBLIQUITY, PLANETS, SOLAR_SYSTEM, planetOrbitPoints, planetPosition, type PlanetId } from '../orbital-mechanics/ephemeris';
import { cross, norm, propagate, rotate, scale, sub, sweptAngle, unit, type V3 } from '../orbital-mechanics/kepler';
import {
  MU, RADIUS, meanMoonOrbit, moonState, segmentPoints, stateAt, type CenterId, type MissionTimeline, type Segment,
} from '../orbital-mechanics/missionTrajectory';
import { buildStarfield, createBaseScene } from './environment';
import { createPlanet, createSaturnRings, type PlanetKind } from './planets';

export type OrbitFocus = 'system' | 'trajectory' | 'destination' | 'probe';
export type ScaleMode = 'physical' | 'didactic';
/** Compatibilidade com a interface anterior (Trajetória / Sonda). */
export type OrbitView = OrbitFocus;

export interface OrbitMission {
  timeline: MissionTimeline;
  /** Veículo lançador: o último estágio fica acoplado à sonda até a separação. */
  vehicle: LaunchVehicle | null;
  /** Instante da separação (s desde a inserção); null = sonda já separada na inserção. */
  separationT: number | null;
}

export interface ClockControl {
  running: boolean;
  /** Multiplicador do tempo (s de missão por s real) ou automático (até o próximo evento em poucos segundos). */
  warp: number | 'auto';
  /** O relógio para neste instante (manobra pendente). */
  holdAt: number | null;
}

export interface OrbitInfo {
  t: number;
  dateIso: string;
  warp: number;
  holding: boolean;
  segmentId: string;
  segmentLabel: string;
  center: CenterId;
  centerName: string;
  altitudeM: number;
  distanceM: number;
  speedMS: number;
  attitude: AttitudeMode;
  revolution: { swept: number; fraction: number; complete: boolean };
  focus: OrbitFocus;
  focusName: string;
  cameraDistanceM: number;
  scale: ScaleMode;
  /** Fatores de ampliação em uso no modo didático (corpo → fator). */
  enlarged: { name: string; factor: number }[];
  deployment: number;
  hasArrays: boolean;
  /** A sonda aparece como modelo 3D (true) ou só como rótulo na tela (false). */
  probeModelVisible: boolean;
  /** Não existe esfera marcadora da sonda na cena (verificado pelos testes). */
  markerMeshes: number;
  stackAttached: boolean;
}

export interface OrbitSceneController extends SceneController {
  setMission(m: OrbitMission | null): void;
  setClock(c: Partial<ClockControl>): void;
  setTime(t: number): void;
  setFocus(f: OrbitFocus): void;
  setScale(s: ScaleMode): void;
  setProbe(installed: InstalledComponent[], deployed: boolean): void;
  deployArrays(): void;
  info(): OrbitInfo;
}

type BodyId = 'sun' | PlanetId | 'moon';
interface BodyView {
  id: BodyId;
  name: string;
  mesh: Mesh;
  radius: number;
  /** Posição heliocêntrica (m, eclíptica J2000) no instante atual. */
  pos: V3;
  factor: number;
  label: HTMLDivElement;
}

const NAMES: Record<BodyId, string> = {
  sun: 'Sol', mercury: 'Mercúrio', venus: 'Vênus', earth: 'Terra', mars: 'Marte', jupiter: 'Júpiter', saturn: 'Saturno',
  uranus: 'Urano', neptune: 'Netuno', moon: 'Lua',
};
const CENTER_NAMES: Record<CenterId, string> = { sun: 'Sol', earth: 'Terra', moon: 'Lua', jupiter: 'Júpiter' };
const AU = 149597870700;
const DEG = Math.PI / 180;
/** Ângulo mínimo (rad) que um corpo ocupa na tela no modo didático. */
const DIDACTIC_ANGLE = 0.0045;
const NEAR_TRAIL_M = 1e5;

/** Física (eclíptica, Z para o polo) → cena (Y para cima): troca Y e Z. */
const toScene = (p: V3, o: V3, out: Vector3): Vector3 => out.set(p[0] - o[0], p[2] - o[2], p[1] - o[1]);
const swapV = (p: V3): V3 => [p[0], p[2], p[1]];

/** Matriz de rotação (convenção de linhas do Babylon) a partir de uma base na cena (colunas X, Y, Z do corpo). */
function basisMatrix(b: Basis): Matrix {
  return Matrix.FromValues(b.x[0], b.x[1], b.x[2], 0, b.y[0], b.y[1], b.y[2], 0, b.z[0], b.z[1], b.z[2], 0, 0, 0, 0, 1);
}

/** Rotação física (corpo → eclíptica, colunas) levada à cena: S·R·S com S = troca de Y e Z. */
function physicalToSceneRotation(cols: [V3, V3, V3]): Quaternion {
  // Base local da esfera do Babylon = S(base do corpo): X → X, Y(local, norte) → Z(corpo), Z(local) → Y(corpo)
  const b: Basis = { x: swapV(cols[0]), y: swapV(cols[2]), z: swapV(cols[1]) };
  return Quaternion.FromRotationMatrix(basisMatrix(b));
}

/** Sol: esfera emissiva com a textura da fotosfera e um halo suave. */
function createSun(scene: import('@babylonjs/core').Scene): Mesh {
  const sun = MeshBuilder.CreateSphere('sun', { diameter: 2, segments: 48 }, scene);
  const m = new StandardMaterial('sunMat', scene);
  m.emissiveColor = new Color3(1, 0.9, 0.7);
  m.emissiveTexture = new Texture(`${import.meta.env?.BASE_URL ?? '/'}textures/planets/sun_1k.jpg`, scene);
  m.disableLighting = true;
  sun.material = m;
  const size = 128;
  const tex = new DynamicTexture('sunGlowTex', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,230,180,0.55)');
  g.addColorStop(0.25, 'rgba(255,200,120,0.18)');
  g.addColorStop(1, 'rgba(255,160,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  const glow = MeshBuilder.CreatePlane('sunGlow', { size: 10 }, scene);
  glow.billboardMode = Constants.PARTICLES_BILLBOARDMODE_ALL;
  const gm = new StandardMaterial('sunGlowMat', scene);
  gm.diffuseTexture = tex;
  gm.opacityTexture = tex;
  gm.emissiveColor = new Color3(1, 0.85, 0.6);
  gm.disableLighting = true;
  gm.alphaMode = Constants.ALPHA_ADD;
  gm.disableDepthWrite = true;
  glow.material = gm;
  // Sem pai: com o Sol como pai (rotação própria + escala de 1e10) o billboard saía de lado e virava uma "gravata".
  // A cena copia posição e escala do Sol a cada quadro.
  glow.isPickable = false;
  glow.renderingGroupId = 1;
  sun.metadata = { glow };
  return sun;
}

/** Ângulo sideral de Greenwich (rad) na data. */
function gmst(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return ((280.46061837 + 360.98564736629 * (jd - 2451545)) % 360) * DEG;
}

const SEGMENT_COLORS: Record<Segment['phase'], Color3> = {
  'earth-orbit': new Color3(0.36, 0.89, 0.54),
  transfer: new Color3(0.95, 0.64, 0.23),
  cruise: new Color3(0.95, 0.64, 0.23),
  approach: new Color3(0.98, 0.75, 0.3),
  flyby: new Color3(1, 0.37, 0.34),
  final: new Color3(0.36, 0.89, 0.54),
};

export function createOrbitScene(engine: Engine): OrbitSceneController {
  const base = createBaseScene(engine, { clear: new Color4(0, 0.002, 0.008, 1), target: Vector3.Zero(), radius: 3e7, alpha: -Math.PI / 3, beta: 1.15, shadows: false, maxZ: 1e15, exposure: 0.95, environment: 'space', environmentIntensity: 0.3 });
  const { scene, camera, sun: light, pipeline } = base;
  camera.upperBetaLimit = Math.PI - 0.05;
  camera.lowerBetaLimit = 0.05;
  camera.lowerRadiusLimit = 3;
  camera.upperRadiusLimit = 2e13;
  camera.wheelDeltaPercentage = 0.02;
  camera.pinchDeltaPercentage = 0.004;
  light.intensity = 2.4;
  const hemi = scene.lights.find((l) => l.name === 'hemi');
  if (hemi) hemi.intensity = 0.06;
  if (pipeline) { pipeline.bloomThreshold = 0.97; pipeline.bloomWeight = 0.12; }

  // Estrelas no infinito (seguem a câmera)
  const stars = buildStarfield(scene, 1e14, 5000, 0.0016);
  (stars.material as StandardMaterial).emissiveColor = new Color3(0.75, 0.75, 0.78);
  stars.infiniteDistance = true;
  stars.renderingGroupId = 0;

  // Projeções por grupo: a seleção de malhas usa o intervalo inteiro; cada grupo desenha com o seu
  let farMinZ = 1e3;
  const setProjection = (minZ: number, maxZ: number) => {
    camera.minZ = minZ;
    camera.maxZ = maxZ;
    scene.setTransformMatrix(camera.getViewMatrix(), camera.getProjectionMatrix(true));
  };
  scene.onBeforeRenderObservable.add(() => { camera.minZ = 0.05; camera.maxZ = 1e15; });
  scene.onBeforeRenderingGroupObservable.add((g) => {
    if (g.renderingGroupId === 2) setProjection(0.05, 5 * NEAR_TRAIL_M);
    else setProjection(farMinZ, 1e15);
  });

  // Rótulos HTML (nomes dos corpos e posição da sonda)
  const canvas = engine.getRenderingCanvas();
  const overlay = document.createElement('div');
  overlay.className = 'orbit-labels';
  overlay.setAttribute('data-testid', 'orbit-labels');
  Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  canvas?.parentElement?.insertBefore(overlay, canvas.nextSibling);
  const makeLabel = (text: string, cls: string): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = `orbit-label ${cls}`;
    el.innerHTML = `<span class="dot"></span><span class="txt"></span>`;
    (el.querySelector('.txt') as HTMLSpanElement).textContent = text;
    overlay.appendChild(el);
    return el;
  };

  // Corpos
  const bodies = new Map<BodyId, BodyView>();
  const addBody = (id: BodyId, mesh: Mesh, radius: number) => {
    mesh.renderingGroupId = 1;
    for (const c of mesh.getChildMeshes()) c.renderingGroupId = 1;
    bodies.set(id, { id, name: NAMES[id], mesh, radius, pos: [0, 0, 0], factor: 1, label: makeLabel(NAMES[id], `body body-${id}`) });
  };
  addBody('sun', createSun(scene), RADIUS.sun);
  for (const id of PLANETS) {
    const r = SOLAR_SYSTEM.planets[id].meanRadiusKm * 1000;
    const mesh = createPlanet(scene, id as PlanetKind, 2, { segments: id === 'earth' ? 128 : 64 });
    if (id === 'saturn') createSaturnRings(scene, mesh);
    addBody(id, mesh, id === 'earth' ? RADIUS.earth : id === 'jupiter' ? RADIUS.jupiter : r);
  }
  addBody('moon', createPlanet(scene, 'moon', 2, { segments: 64 }), RADIUS.moon);

  // Órbitas dos planetas (cinza) e da Lua, desenhadas em relação ao Sol / à Terra
  let orbitLines: { mesh: LinesMesh; center: BodyId }[] = [];
  const buildPlanetOrbits = (date: Date, moonPts: V3[]) => {
    orbitLines.forEach((l) => l.mesh.dispose());
    orbitLines = [];
    for (const id of PLANETS) {
      const pts = planetOrbitPoints(id, date, 360).map((p) => new Vector3(p[0], p[2], p[1]));
      const l = MeshBuilder.CreateLines(`orbit-${id}`, { points: pts }, scene);
      l.color = new Color3(0.32, 0.38, 0.46);
      l.alpha = 0.7;
      l.renderingGroupId = 1;
      l.isPickable = false;
      orbitLines.push({ mesh: l, center: 'sun' });
    }
    const ml = MeshBuilder.CreateLines('orbit-moon', { points: moonPts.map((p) => new Vector3(p[0], p[2], p[1])) }, scene);
    ml.color = new Color3(0.32, 0.38, 0.46);
    ml.renderingGroupId = 1;
    ml.isPickable = false;
    orbitLines.push({ mesh: ml, center: 'earth' });
  };

  // Missão
  let mission: OrbitMission | null = null;
  let tl: MissionTimeline | null = null;
  let epochMs = Date.parse('2027-06-15T12:00:00Z');
  let moonOrbit = meanMoonOrbit(epochMs);
  let trajLines: { mesh: LinesMesh; seg: Segment }[] = [];
  const clock: ClockControl = { running: false, warp: 'auto', holdAt: null };
  let t = 0;
  let warpNow = 0;
  // Volta completa: ângulo varrido pela posição em torno da Terra desde a inserção
  let swept = 0;
  let sweptPrev: V3 | null = null;
  let sweptT = 0;

  const moonPoints = () => Array.from({ length: 181 }, (_, i) => moonState(moonOrbit, (i / 180) * (2 * Math.PI / moonOrbit.rate)).r);

  const buildTrajectory = () => {
    trajLines.forEach((l) => l.mesh.dispose());
    trajLines = [];
    if (!tl) return;
    for (const seg of tl.segments) {
      const closed = !Number.isFinite(seg.t1) || seg.id === 'parking';
      const n = seg.center === 'sun' ? 1024 : closed ? 720 : 512;
      const span = seg.id === 'flyby' ? 40 * 86400 : undefined;
      const pts = (seg.id === 'parking' ? segmentPoints({ ...seg, t1: Infinity }, n) : segmentPoints(seg, n, span)).map((p) => new Vector3(p[0], p[2], p[1]));
      const l = MeshBuilder.CreateLines(`traj-${seg.id}`, { points: pts }, scene);
      l.color = SEGMENT_COLORS[seg.phase];
      l.renderingGroupId = 1;
      l.isPickable = false;
      trajLines.push({ mesh: l, seg });
    }
  };

  // Sonda (e estágio superior acoplado)
  const stack = new TransformNode('probe-stack', scene);
  let probe: ProbeModel | null = null;
  let hasArrays = false;
  let deployAnim: { from: number; t0: number } | null = null;
  let rocket: RocketModel | null = null;
  let stageDrift: { t0: number; basis: Basis } | null = null;
  const stackQ = new Quaternion();
  let stackQInit = false;
  const probeLabel = makeLabel('Sonda', 'probe');
  probeLabel.setAttribute('data-testid', 'probe-label');
  const trail: { mesh: LinesMesh | null } = { mesh: null };

  const setNearGroup = (node: TransformNode) => {
    for (const m of node.getChildMeshes()) { m.renderingGroupId = 2; m.isPickable = false; }
  };

  const buildStage = () => {
    rocket?.dispose();
    rocket = null;
    if (!mission?.vehicle || mission.separationT === null) return;
    const r = buildRocket(scene, base.mats, mission.vehicle);
    // Só o último estágio continua com a sonda (os demais e a coifa foram descartados na subida)
    r.groups.slice(0, -1).forEach((g) => g.dispose());
    r.fairing?.dispose();
    r.root.computeWorldMatrix(true);
    r.payload.computeWorldMatrix(true);
    const mount = r.payload.getAbsolutePosition().clone();
    r.root.parent = stack;
    // A base da sonda (interface com o adaptador) fica no topo do estágio
    r.root.position.set(-mount.x, -mount.y - (probe?.height ?? 2) / 2, -mount.z);
    setNearGroup(r.root);
    rocket = r;
  };

  const probeHalf = () => (probe?.height ?? 2) / 2;

  // Foco e câmera
  let focus: OrbitFocus = 'trajectory';
  let scaleMode: ScaleMode = 'physical';
  const origin: V3 = [0, 0, 0];
  let transition: { from: V3; t0: number; r0: number; r1: number; ab?: [number, number, number, number] } | null = null;
  /** Trecho enquadrado pela vista "Trajetória" (centro + trecho): muda ao trocar de fase, ex.: estacionamento → TLI. */
  let framedKey: string | null = null;
  const segmentKey = () => (tl ? (({ segment }) => `${segment.center}:${segment.id}`)(stateAt(tl, t)) : null);

  const probeHelio = (): V3 => (tl ? stateAt(tl, t).helio : bodies.get('earth')!.pos);
  const destinationId = (): BodyId => (tl?.destination === 'moon' ? 'moon' : tl?.destination === 'jupiter' ? 'jupiter' : 'earth');
  const focusPoint = (f: OrbitFocus): V3 => {
    if (f === 'system') return [0, 0, 0];
    if (f === 'probe') return probeHelio();
    if (f === 'destination') return bodies.get(destinationId())!.pos;
    // Trajetória: corpo central do trecho atual
    const c = tl ? stateAt(tl, t).segment.center : 'earth';
    return c === 'sun' ? [0, 0, 0] : bodies.get(c)!.pos;
  };
  const framingRadius = (f: OrbitFocus): number => {
    if (f === 'probe') return 22;
    if (f === 'system') return 34 * AU;
    if (f === 'destination') {
      const b = bodies.get(destinationId())!;
      return b.radius * (b.id === 'earth' ? 5 : 7);
    }
    if (!tl) return RADIUS.earth * 5;
    const s = stateAt(tl, t);
    const c = s.segment.center;
    // Extensão dos trechos com o mesmo centro a partir do atual (ex.: transferência inteira até a Lua)
    let ext = norm(s.r);
    for (let i = s.index; i < tl.segments.length && tl.segments[i]!.center === c; i++) {
      for (const p of segmentPoints(tl.segments[i]!, 64, 30 * 86400)) ext = Math.max(ext, norm(p));
    }
    if (c === 'earth' && s.segment.id === 'parking') ext = norm(s.r);
    return Math.min(ext * (c === 'sun' ? 1.6 : 2.6), 40 * AU);
  };
  const startFocus = (f: OrbitFocus) => {
    transition = { from: [...origin] as V3, t0: performance.now(), r0: camera.radius, r1: framingRadius(f) };
    if (f === 'probe') {
      // Câmera do lado iluminado: 50° fora da direção do Sol, para ver a sonda em relevo e não só a face na sombra
      const h = probeHelio();
      const sun = unit([-h[0], -h[2], -h[1]] as V3); // físico → cena (troca Y/Z)
      const side = unit(cross(sun, Math.abs(sun[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const k = 50 * DEG;
      const d: V3 = [sun[0] * Math.cos(k) + side[0] * Math.sin(k), sun[1] * Math.cos(k) + side[1] * Math.sin(k), sun[2] * Math.cos(k) + side[2] * Math.sin(k)];
      const beta = Math.acos(Math.max(-1, Math.min(1, d[1])));
      let alpha = Math.atan2(d[2], d[0]);
      // Menor arco a partir do ângulo atual
      while (alpha - camera.alpha > Math.PI) alpha -= 2 * Math.PI;
      while (alpha - camera.alpha < -Math.PI) alpha += 2 * Math.PI;
      transition.ab = [camera.alpha, alpha, camera.beta, Math.min(Math.PI - 0.05, Math.max(0.05, beta))];
    } else if (f === 'system') {
      // Visão do sistema sempre inclinada sobre a eclíptica (a vista da sonda pode ter deixado a câmera de perfil)
      transition.ab = [camera.alpha, camera.alpha, camera.beta, 1.15];
    }
    focus = f;
    framedKey = segmentKey();
  };

  // Quadro: posição dos corpos, sonda, origem, escala e rótulos
  const date = () => new Date(epochMs + t * 1000);

  const updateBodies = () => {
    const d = date();
    for (const id of PLANETS) bodies.get(id)!.pos = planetPosition(id, d);
    const e = bodies.get('earth')!.pos;
    const m = moonState(moonOrbit, t).r;
    bodies.get('moon')!.pos = [e[0] + m[0], e[1] + m[1], e[2] + m[2]];
    bodies.get('sun')!.pos = [0, 0, 0];
  };

  const orientBodies = () => {
    const d = date();
    const days = (d.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
    for (const b of bodies.values()) {
      let cols: [V3, V3, V3];
      if (b.id === 'earth') {
        const th = gmst(d);
        const X: V3 = [1, 0, 0];
        cols = [rotate([Math.cos(th), Math.sin(th), 0], X, -OBLIQUITY), rotate([-Math.sin(th), Math.cos(th), 0], X, -OBLIQUITY), rotate([0, 0, 1], X, -OBLIQUITY)];
      } else if (b.id === 'moon') {
        // Rotação síncrona: a face visível (longitude 0) voltada para a Terra
        const rel = moonState(moonOrbit, t);
        const x = unit(scale(rel.r, -1));
        const z = unit(cross(rel.r, rel.v));
        cols = [x, cross(z, x), z];
      } else {
        const pd = b.id === 'sun' ? { rotationPeriodH: 609.12, obliquityDeg: 7.25 } : SOLAR_SYSTEM.planets[b.id as PlanetId];
        const th = (2 * Math.PI * days * 24) / Math.abs(pd.rotationPeriodH);
        const X: V3 = [1, 0, 0];
        const ob = -pd.obliquityDeg * DEG;
        cols = [rotate([Math.cos(th), Math.sin(th), 0], X, ob), rotate([-Math.sin(th), Math.cos(th), 0], X, ob), rotate([0, 0, 1], X, ob)];
      }
      b.mesh.rotationQuaternion = physicalToSceneRotation(cols);
    }
  };

  /** Ângulo varrido em torno da Terra até o instante atual (em passos de no máximo 10°). */
  const updateRevolution = () => {
    if (!tl) return;
    const seg0 = tl.segments[0]!;
    const tEnd = Math.min(t, seg0.t1);
    if (tEnd < sweptT) { swept = 0; sweptPrev = null; sweptT = 0; }
    const mu = MU.earth;
    const h = cross(seg0.s0.r, seg0.s0.v);
    const period = tl.parking.period;
    if (!sweptPrev) { sweptPrev = seg0.s0.r; sweptT = 0; }
    while (sweptT < tEnd && swept < 4 * Math.PI) {
      const next = Math.min(tEnd, sweptT + period / 36);
      const r = propagate(mu, seg0.s0, next - seg0.t0).r;
      swept += sweptAngle(sweptPrev, r, h);
      sweptPrev = r;
      sweptT = next;
    }
  };

  const nextMilestoneT = (): number | null => {
    if (!tl) return null;
    let best: number | null = null;
    for (const m of tl.milestones) if (m.t > t + 1e-6 && (best === null || m.t < best)) best = m.t;
    if (clock.holdAt !== null && clock.holdAt > t && (best === null || clock.holdAt < best)) best = clock.holdAt;
    return best;
  };

  const advanceClock = (dt: number) => {
    if (!clock.running || !tl) { warpNow = 0; return; }
    let w: number;
    if (clock.warp === 'auto') {
      const next = nextMilestoneT();
      const seg = stateAt(tl, t).segment;
      const per = Number.isFinite(seg.t1) ? (seg.t1 - seg.t0) : tl.parking.period;
      const minWarp = Math.max(20, Math.min(per / 40, 2e4));
      w = next === null ? (seg.center === 'sun' ? 2e5 : Math.max(60, minWarp)) : Math.max(minWarp, (next - t) / 4);
      w = Math.min(w, 5e6);
    } else w = clock.warp;
    let nt = t + w * dt;
    if (clock.holdAt !== null && t <= clock.holdAt) nt = Math.min(nt, clock.holdAt);
    warpNow = dt > 0 ? (nt - t) / dt : 0;
    t = nt;
  };

  const placeProbe = () => {
    if (!tl || !probe) { stack.setEnabled(false); return; }
    const s = stateAt(tl, t);
    toScene(s.helio, origin, stack.position);
    const r = swapV(s.r), v = swapV(s.v);
    const toSun = swapV(unit(scale(s.helio, -1)));
    const earthPos = bodies.get('earth')!.pos;
    const toEarth = swapV(unit(sub(earthPos, s.helio)));
    const mode = attitudeNow();
    const basis = attitudeBasis(mode, { r, v, toSun, toEarth });
    const q = Quaternion.FromRotationMatrix(basisMatrix(basis));
    if (!stackQInit) { stackQ.copyFrom(q); stackQInit = true; } else Quaternion.SlerpToRef(stackQ, q, 0.08, stackQ);
    stack.rotationQuaternion = stackQ;
    probe.root.position.set(0, -probeHalf(), 0);
    // Estágio superior: acoplado até a separação; depois se afasta a 0,5 m/s (empurrão das molas)
    if (rocket && mission?.separationT !== null && mission?.separationT !== undefined) {
      const sepT = mission.separationT;
      if (t < sepT) {
        rocket.root.parent = stack;
        rocket.root.setEnabled(true);
        stageDrift = null;
      } else if (t - sepT < 3600) {
        if (!stageDrift) stageDrift = { t0: sepT, basis };
        rocket.root.setEnabled(true);
      } else rocket.root.setEnabled(false);
    }
    stack.setEnabled(true);
  };

  /** Atitude: a do trecho, trocada pela de queima quando o relógio espera uma manobra. */
  const attitudeNow = (): AttitudeMode => {
    if (!tl) return 'inertial';
    const s = stateAt(tl, t);
    if (clock.holdAt !== null && Math.abs(clock.holdAt - t) < 1) {
      const m = tl.milestones.find((x) => Math.abs(x.t - clock.holdAt!) < 1);
      if (m?.id === 'loi' || m?.id === 'joi') return 'retrograde';
      if (m) return 'prograde';
    }
    if (mission?.separationT !== null && mission?.separationT !== undefined && t < mission.separationT) return 'prograde';
    return s.segment.attitude;
  };

  const updateStageDrift = () => {
    if (!rocket || !stageDrift || !mission || mission.separationT === null) return;
    const dtS = t - stageDrift.t0;
    // Afastamento ao longo de −Y do corpo no instante da separação, no referencial que acompanha a sonda
    rocket.root.parent = null;
    const b = stageDrift.basis;
    const off = scale(b.y, -(probeHalf() + 6 + 0.5 * dtS));
    rocket.root.rotationQuaternion = Quaternion.FromRotationMatrix(basisMatrix(b));
    rocket.root.position.set(stack.position.x + off[0], stack.position.y + off[1], stack.position.z + off[2]);
  };

  const updateTrail = () => {
    if (!tl || focus !== 'probe') { trail.mesh?.setEnabled(false); return; }
    const s = stateAt(tl, t);
    const speed = Math.max(1, norm(s.v));
    const span = NEAR_TRAIL_M / speed;
    const pts: Vector3[] = [];
    for (let i = -40; i <= 40; i++) {
      const p = stateAt(tl, Math.max(0, t + (span * i) / 40)).helio;
      pts.push(toScene(p, origin, new Vector3()));
    }
    trail.mesh = MeshBuilder.CreateLines('probe-trail', { points: pts, updatable: true, instance: trail.mesh ?? undefined }, scene);
    trail.mesh.color = SEGMENT_COLORS[s.segment.phase];
    trail.mesh.renderingGroupId = 2;
    trail.mesh.setEnabled(true);
  };

  const project = (p: Vector3): { x: number; y: number; visible: boolean } => {
    const w = engine.getRenderWidth(), h = engine.getRenderHeight();
    const vp = camera.viewport.toGlobal(w, h);
    const tm = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
    const s = Vector3.Project(p, Matrix.IdentityReadOnly, tm, vp);
    const scaleCss = (canvas?.clientWidth ?? w) / w;
    // Só "na frente da câmera": a profundidade projetada (s.z) depende do near/far do último grupo desenhado
    // (o grupo da sonda usa far de 500 km) e esconderia os rótulos de todos os corpos distantes
    const inFront = Vector3.Dot(p.subtract(camera.position), camera.getDirection(Vector3.Forward())) > 0;
    return { x: s.x * scaleCss, y: s.y * scaleCss, visible: inFront && Number.isFinite(s.x) && Number.isFinite(s.y) };
  };

  const setLabel = (el: HTMLDivElement, p: Vector3, show: boolean, text?: string) => {
    if (!show) { el.style.display = 'none'; return; }
    const pr = project(p);
    if (!pr.visible) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px)`;
    if (text !== undefined) (el.querySelector('.txt') as HTMLSpanElement).textContent = text;
  };

  /** A sonda está atrás de algum corpo (esfera exibida) visto da câmera? */
  const hiddenBehindBody = (cam: Vector3, p: Vector3) => {
    const d = p.subtract(cam);
    const len = d.length();
    if (len <= 0) return false;
    d.scaleInPlace(1 / len);
    for (const b of bodies.values()) {
      if (!b.mesh.isEnabled()) continue;
      const R = b.radius * b.factor;
      const oc = b.mesh.position.subtract(cam);
      const along = Vector3.Dot(oc, d);
      if (along <= 0 || along >= len) continue;
      if (oc.lengthSquared() - along * along < R * R) return true;
    }
    return false;
  };

  const updateScene = () => {
    // Origem flutuante (com transição suave entre focos)
    const target = focusPoint(focus);
    if (transition) {
      const k = Math.min(1, (performance.now() - transition.t0) / 1400);
      const e = k * k * (3 - 2 * k);
      for (let i = 0; i < 3; i++) origin[i] = transition.from[i]! + (target[i]! - transition.from[i]!) * e;
      camera.radius = Math.exp(Math.log(transition.r0) + (Math.log(transition.r1) - Math.log(transition.r0)) * e);
      if (transition.ab) {
        camera.alpha = transition.ab[0] + (transition.ab[1] - transition.ab[0]) * e;
        camera.beta = transition.ab[2] + (transition.ab[3] - transition.ab[2]) * e;
      }
      if (k >= 1) transition = null;
    } else {
      origin[0] = target[0]; origin[1] = target[1]; origin[2] = target[2];
    }
    camera.target.setAll(0);
    const camPos = camera.position;
    // Corpos: posição, ampliação didática e distância mínima ao corpo (plano near do grupo distante)
    let nearest = Infinity;
    for (const b of bodies.values()) {
      toScene(b.pos, origin, b.mesh.position);
      const dist = Vector3.Distance(camPos, b.mesh.position);
      let factor = 1;
      if (scaleMode === 'didactic') {
        const minR = DIDACTIC_ANGLE * dist;
        factor = Math.min(b.id === 'sun' ? 60 : 3000, Math.max(1, minR / b.radius));
        // A Lua só é ampliada enquanto não engole a própria órbita na escala da Terra
        if (b.id === 'moon') factor = Math.min(factor, 30);
      }
      b.factor = factor;
      b.mesh.scaling.setAll(b.radius * factor);
      const glow = b.mesh.metadata?.glow as Mesh | undefined;
      if (glow) { glow.position.copyFrom(b.mesh.position); glow.scaling.setAll(b.radius * factor); }
      nearest = Math.min(nearest, Math.max(1, dist - b.radius * factor));
    }
    farMinZ = Math.max(1, Math.min(nearest * 0.1, focus === 'probe' ? NEAR_TRAIL_M * 0.5 : Infinity));
    // Sol: luz direcional e direção usada pelo shader dos planetas
    scene.metadata = { sunPosition: toScene([0, 0, 0], origin, new Vector3()) };
    const ph = probeHelio();
    light.direction = toScene(ph, [0, 0, 0], new Vector3()).normalize();
    // Linhas: órbitas dos planetas e trajetória (cada uma em relação ao seu centro)
    for (const l of orbitLines) toScene(bodies.get(l.center)!.pos, origin, l.mesh.position);
    for (const l of trajLines) {
      const c = l.seg.center;
      const cp = c === 'sun' ? [0, 0, 0] as V3 : bodies.get(c)!.pos;
      toScene(cp, origin, l.mesh.position);
      // Na vista da sonda, as linhas heliocêntricas (amostradas a cada dias) ficam escondidas: o rastro local é exato
      l.mesh.setEnabled(!(focus === 'probe' && c === 'sun'));
    }
    placeProbe();
    updateStageDrift();
    updateTrail();
    // Rótulos
    const w = engine.getRenderHeight();
    const pixelAngle = (camera.fov / w);
    for (const b of bodies.values()) {
      const dist = Vector3.Distance(camPos, b.mesh.position);
      const apparentPx = (b.radius * b.factor) / Math.max(1, dist) / pixelAngle;
      const showMoon = b.id !== 'moon' || Vector3.Distance(camPos, bodies.get('earth')!.mesh.position) < 3e9;
      b.label.classList.toggle('tiny', apparentPx < 3);
      b.label.classList.toggle('destination', b.id === destinationId() && tl !== null);
      const txt = b.factor > 1.5 ? `${b.name} ×${b.factor >= 100 ? Math.round(b.factor / 10) * 10 : Math.round(b.factor)}` : b.name;
      setLabel(b.label, b.mesh.position, showMoon && apparentPx < 400, txt);
    }
    const probePx = probe ? (probe.height * 3) / Math.max(1, Vector3.Distance(camPos, stack.position)) / pixelAngle : 0;
    setLabel(probeLabel, stack.position, !!tl && probePx < 12 && !hiddenBehindBody(camPos, stack.position));
  };

  const controller: OrbitSceneController = {
    scene,
    setQuality: base.setQuality,
    setMission(m) {
      mission = m;
      const prevEpoch = epochMs;
      tl = m?.timeline ?? null;
      if (tl) {
        epochMs = tl.epochMs;
        moonOrbit = tl.moon;
      }
      if (!orbitLines.length || prevEpoch !== epochMs) buildPlanetOrbits(new Date(epochMs), moonPoints());
      buildTrajectory();
      buildStage();
      updateBodies();
      if (framedKey === null) startFocus(focus);
    },
    setClock(c) { Object.assign(clock, c); },
    setTime(nt) { t = Math.max(0, nt); },
    setFocus(f) { startFocus(f); },
    setScale(s) { scaleMode = s; },
    setProbe(installed, deployed) {
      probe?.dispose();
      probe = new ProbeModel(scene, base.mats, stack);
      probe.rebuild(installed);
      hasArrays = probe.hasSolarArrays;
      probe.setDeployment(deployed ? 1 : 0);
      setNearGroup(probe.root);
      deployAnim = null;
      buildStage();
    },
    deployArrays() {
      if (!probe || probe.deploymentFraction >= 1) return;
      deployAnim = { from: probe.deploymentFraction, t0: performance.now() };
      startFocus('probe');
    },
    info() {
      const s = tl ? stateAt(tl, t) : null;
      const camDist = camera.radius;
      const enlarged = [...bodies.values()].filter((b) => b.factor > 1.5).map((b) => ({ name: b.name, factor: b.factor }));
      const markerMeshes = scene.meshes.filter((m) => /marker/i.test(m.name)).length;
      return {
        t, dateIso: date().toISOString(), warp: warpNow, holding: clock.holdAt !== null && t >= clock.holdAt - 1e-6,
        segmentId: s?.segment.id ?? '', segmentLabel: s?.segment.label ?? '', center: s?.segment.center ?? 'earth',
        centerName: CENTER_NAMES[s?.segment.center ?? 'earth'],
        altitudeM: s ? norm(s.r) - RADIUS[s.segment.center] : 0, distanceM: s ? norm(s.r) : 0, speedMS: s ? norm(s.v) : 0,
        attitude: attitudeNow(),
        revolution: { swept, fraction: Math.min(1, swept / (2 * Math.PI)), complete: swept >= 2 * Math.PI - 1e-9 },
        focus, focusName: focus === 'system' ? 'Sistema Solar' : focus === 'probe' ? 'Sonda' : focus === 'destination' ? NAMES[destinationId()] : CENTER_NAMES[s?.segment.center ?? 'earth'],
        cameraDistanceM: camDist, scale: scaleMode, enlarged,
        deployment: probe?.deploymentFraction ?? 0, hasArrays,
        probeModelVisible: !!probe && stack.isEnabled() && probeLabel.style.display === 'none',
        markerMeshes,
        stackAttached: !!rocket && !!mission && mission.separationT !== null && t < mission.separationT,
      };
    },
    update(dt) {
      advanceClock(Math.min(dt, 0.1));
      updateBodies();
      orientBodies();
      updateRevolution();
      // Reenquadra a vista "Trajetória" quando a sonda muda de trecho (fase ou corpo central)
      if (tl && focus === 'trajectory' && !transition && segmentKey() !== framedKey) startFocus('trajectory');
      // Limites de zoom: não entrar nos corpos
      const fb = focus === 'probe' ? null : focus === 'system' ? bodies.get('sun')! : focus === 'destination' ? bodies.get(destinationId())! : (() => { const c = tl ? stateAt(tl, t).segment.center : 'earth'; return bodies.get(c === 'sun' ? 'sun' : c)!; })();
      camera.lowerRadiusLimit = fb ? fb.radius * fb.factor * 1.15 : 3;
      if (!transition && camera.radius < camera.lowerRadiusLimit) camera.radius = camera.lowerRadiusLimit;
      updateScene();
      if (deployAnim !== null && probe) {
        const f = Math.min(1, deployAnim.from + (performance.now() - deployAnim.t0) / 8000);
        probe.setDeployment(f);
        if (f >= 1) deployAnim = null;
      }
    },
    dispose() { probe?.dispose(); rocket?.dispose(); overlay.remove(); scene.dispose(); },
  };
  updateBodies();
  buildPlanetOrbits(new Date(epochMs), moonPoints());
  return controller;
}
