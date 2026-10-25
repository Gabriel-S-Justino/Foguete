/**
 * Visualização orbital (planejamento e operações). A missão é descrita por "pernas" (ex.: cruzeiro
 * heliocêntrico até Júpiter e, depois, aproximação e captura no sistema joviano), cada uma com sua escala.
 * A sonda percorre o caminho de cada perna de forma contínua e a câmera a acompanha; na troca de perna a
 * câmera aproxima da sonda, a cena muda de escala e a câmera se afasta de novo, sem saltos.
 *
 * Há também a vista "sonda": um close da sonda real (modelo montado no hangar) sobre o caminho, usada para
 * acompanhar a abertura dos painéis solares em órbita.
 */
import {
  Color3, Color4, Constants, DynamicTexture, type LinesMesh, type Mesh, MeshBuilder, StandardMaterial,
  TransformNode, Vector3, type Engine,
} from '@babylonjs/core';
import type { InstalledComponent } from '../../types/campaign';
import type { SceneController } from '../core/SceneManager';
import { ProbeModel } from '../entities/probeModel';
import { buildStarfield, createBaseScene } from './environment';
import { createPlanet, type PlanetKind } from './planets';

export interface OrbitPathSpec {
  /** Pontos em unidades de cena. */
  points: Vector3[];
  color: Color3;
  name: string;
  dashed?: boolean;
}

export interface OrbitBodySpec { kind: PlanetKind | 'sun'; diameter: number; position: Vector3 }

export interface OrbitLeg {
  /** Nome curto exibido na interface (ex.: "Cruzeiro Terra → Júpiter"). */
  label: string;
  /** Corpo central (na origem da perna). */
  body: PlanetKind | 'sun';
  bodyDiameter: number;
  secondary?: OrbitBodySpec[];
  paths: OrbitPathSpec[];
  /** Caminho percorrido pela sonda nesta perna. */
  travel: Vector3[];
  /** Raio da câmera para ver a perna inteira. */
  cameraRadius: number;
  /** Direção da luz do Sol nesta perna (padrão: luz lateral). */
  sunDirection?: Vector3;
}

export interface OrbitConfig {
  legs: OrbitLeg[];
  /** Órbita final percorrida em laço depois da chegada (no referencial da última perna). */
  loop?: Vector3[];
  /** Câmera segue a sonda (operações) ou fica no centro (planejamento). */
  follow?: boolean;
}

export type OrbitView = 'system' | 'probe';

export interface OrbitSceneController extends SceneController {
  configure(cfg: OrbitConfig): void;
  /** Progresso da missão (0 = partida, 1 = chegada ao destino); a sonda viaja até lá sem saltos. */
  setProgress(fraction: number): void;
  /** Mostra a sonda montada (para a vista aproximada e a abertura dos painéis). */
  setProbe(installed: InstalledComponent[], deployed: boolean): void;
  setView(view: OrbitView): void;
  /** Abre os painéis solares com animação. */
  deployArrays(): void;
  /** Estado para a interface e os testes ponta a ponta. */
  info(): { leg: number; legLabel: string; travel: number; target: number; view: OrbitView; deployment: number; hasArrays: boolean; marker: [number, number, number]; cameraTarget: [number, number, number] };
}

/** Comprimento acumulado de um caminho (para percorrer com velocidade constante). */
function cumulative(points: Vector3[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + Vector3.Distance(points[i - 1]!, points[i]!));
  return out;
}

function pointAt(points: Vector3[], cum: number[], f: number, out: Vector3): Vector3 {
  if (points.length === 0) return out.setAll(0);
  if (points.length === 1) return out.copyFrom(points[0]!);
  const total = cum[cum.length - 1]!;
  const d = Math.max(0, Math.min(1, f)) * total;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid]! <= d) lo = mid; else hi = mid; }
  const seg = cum[hi]! - cum[lo]!;
  return Vector3.LerpToRef(points[lo]!, points[hi]!, seg > 0 ? (d - cum[lo]!) / seg : 0, out);
}

/** Sol sem "estourar": disco emissivo com brilho suave em volta (sem depender do bloom). */
function createSun(scene: import('@babylonjs/core').Scene, diameter: number): Mesh {
  const sun = MeshBuilder.CreateSphere('sun', { diameter, segments: 32 }, scene);
  const m = new StandardMaterial('sunMat', scene);
  m.emissiveColor = new Color3(1, 0.86, 0.6);
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
  const glow = MeshBuilder.CreatePlane('sunGlow', { size: diameter * 5 }, scene);
  glow.billboardMode = Constants.PARTICLES_BILLBOARDMODE_ALL;
  const gm = new StandardMaterial('sunGlowMat', scene);
  gm.diffuseTexture = tex;
  gm.opacityTexture = tex;
  gm.emissiveColor = new Color3(1, 0.85, 0.6);
  gm.disableLighting = true;
  gm.alphaMode = Constants.ALPHA_ADD;
  gm.disableDepthWrite = true;
  glow.material = gm;
  glow.parent = sun;
  glow.isPickable = false;
  return sun;
}

export function createOrbitScene(engine: Engine): OrbitSceneController {
  const base = createBaseScene(engine, { clear: new Color4(0, 0.002, 0.008, 1), target: Vector3.Zero(), radius: 40, alpha: -Math.PI / 3, beta: 1.15, shadows: false, maxZ: 1e6, exposure: 0.95, environment: 'space', environmentIntensity: 0.3 });
  const { scene, camera, sun, pipeline } = base;
  camera.upperBetaLimit = Math.PI - 0.1;
  camera.lowerRadiusLimit = 0.05;
  camera.minZ = 0.01;
  camera.wheelDeltaPercentage = 0.02;
  sun.direction = new Vector3(-1, -0.2, 0.3);
  sun.intensity = 2.4;
  // Sem brilho estourado: o bloom fica só nos realces mais fortes
  if (pipeline) { pipeline.bloomThreshold = 0.97; pipeline.bloomWeight = 0.12; }
  const stars = buildStarfield(scene, 50000, 1800, 0.0016);
  (stars.material as StandardMaterial).emissiveColor = new Color3(0.75, 0.75, 0.78);
  const root = new TransformNode('orbitRoot', scene);

  let cfg: OrbitConfig = { legs: [] };
  let legIdx = -1;
  let lines: LinesMesh[] = [];
  let bodies: Mesh[] = [];
  let marker: Mesh | null = null;
  let travelCum: number[] = [];
  let loopCum: number[] = [];
  /** Posição contínua da missão: perna i ocupa [i, i+1]; >= nLegs = em laço na órbita final. */
  let u = 0;
  let target = 0;
  let loopPhase = 0;
  let progressed = false;
  let view: OrbitView = 'system';
  let probe: ProbeModel | null = null;
  let hasArrays = false;
  /** Abertura em andamento: fração inicial e instante de início (relógio real, 8 s mesmo com a taxa de quadros baixa). */
  let deployAnim: { from: number; t0: number } | null = null;
  /** Transição entre pernas: 0..1 aproximando, depois afastando. */
  let zoomPhase: 'none' | 'in' | 'out' = 'none';
  let zoomT = 0;
  let viewRadius = 40;
  const markerPos = new Vector3();
  const prevPos = new Vector3();
  const camTarget = new Vector3();

  const leg = () => cfg.legs[legIdx];

  const buildLeg = (i: number) => {
    lines.forEach((l) => l.dispose());
    bodies.forEach((b) => b.dispose());
    marker?.dispose();
    lines = []; bodies = [];
    legIdx = i;
    const L = cfg.legs[i];
    if (!L) return;
    const addBody = (kind: PlanetKind | 'sun', diameter: number, position: Vector3) => {
      const b = kind === 'sun' ? createSun(scene, diameter) : createPlanet(scene, kind, diameter);
      b.position = position.clone();
      b.parent = root;
      bodies.push(b);
    };
    addBody(L.body, L.bodyDiameter, Vector3.Zero());
    for (const s of L.secondary ?? []) addBody(s.kind, s.diameter, s.position);
    sun.direction = (L.sunDirection ?? new Vector3(-1, -0.2, 0.3)).clone();
    // Vista heliocêntrica: cada planeta é iluminado a partir do Sol no centro
    scene.metadata = L.body === 'sun' ? { sunPosition: Vector3.Zero() } : null;
    for (const p of L.paths) {
      const l = p.dashed
        ? MeshBuilder.CreateDashedLines(p.name, { points: p.points, dashSize: 2, gapSize: 1.5, dashNb: Math.min(600, p.points.length * 2) }, scene)
        : MeshBuilder.CreateLines(p.name, { points: p.points }, scene);
      l.color = p.color;
      l.parent = root;
      l.isPickable = false;
      lines.push(l);
    }
    travelCum = cumulative(L.travel);
    marker = MeshBuilder.CreateSphere('probeMarker', { diameter: Math.max(0.3, L.cameraRadius * 0.012), segments: 12 }, scene);
    const mm = new StandardMaterial('markerMat', scene);
    mm.emissiveColor = new Color3(1, 0.7, 0.2);
    mm.disableLighting = true;
    marker.material = mm;
    marker.parent = root;
    viewRadius = L.cameraRadius;
    if (probe) probe.root.scaling.setAll(probeScale());
  };

  /** Tamanho da sonda em cena: proporcional à perna, só para a vista aproximada. */
  const probeScale = () => (leg()?.cameraRadius ?? 40) * 0.0025;
  const probeRadius = () => probeScale() * 11;

  const placeMarker = () => {
    const L = leg();
    if (!L) return;
    const nLegs = cfg.legs.length;
    if (u >= nLegs && cfg.loop && cfg.loop.length > 1) pointAt(cfg.loop, loopCum, loopPhase, markerPos);
    else pointAt(L.travel, travelCum, Math.min(1, u - legIdx), markerPos);
    marker?.position.copyFrom(markerPos);
    if (probe) {
      // A origem do modelo fica na interface com o adaptador: desce ~1,6 m para o centro do barramento coincidir com a trajetória
      probe.root.position.copyFrom(markerPos);
      probe.root.position.y -= probeScale() * 1.6;
      // Sonda orientada pela direção do movimento (eixo +Z da sonda para a frente)
      const dir = markerPos.subtract(prevPos);
      if (dir.lengthSquared() > 1e-10) probe.root.rotation.y = Math.atan2(dir.x, dir.z);
    }
    prevPos.copyFrom(markerPos);
  };

  const controller: OrbitSceneController = {
    scene,
    setQuality: base.setQuality,
    configure(c) {
      cfg = c;
      loopCum = cumulative(c.loop ?? []);
      u = Math.min(u, c.legs.length);
      target = Math.min(target, c.legs.length);
      buildLeg(Math.min(c.legs.length - 1, Math.floor(u)));
      placeMarker();
      camera.radius = viewRadius;
      camTarget.copyFrom(c.follow ? markerPos : Vector3.Zero());
      camera.setTarget(camTarget.clone());
    },
    setProgress(f) {
      const n = cfg.legs.length;
      target = Math.max(0, Math.min(1, f)) * n;
      // Primeira chamada (abrindo a tela): começa perto de onde a missão está, sem refazer o caminho todo
      if (!progressed && legIdx >= 0 && target > 0) {
        u = Math.max(0, target - 0.25);
        const l = Math.floor(Math.min(u, n - 1e-6));
        if (l !== legIdx) buildLeg(l);
        placeMarker();
        camTarget.copyFrom(cfg.follow ? markerPos : Vector3.Zero());
      }
      progressed = true;
    },
    setProbe(installed, deployed) {
      probe?.dispose();
      probe = new ProbeModel(scene, base.mats, root);
      probe.rebuild(installed);
      hasArrays = probe.hasSolarArrays;
      probe.setDeployment(deployed ? 1 : 0);
      probe.root.scaling.setAll(probeScale());
      probe.root.setEnabled(view === 'probe');
      deployAnim = null;
    },
    setView(v) {
      view = v;
      probe?.root.setEnabled(v === 'probe');
      marker?.setEnabled(v !== 'probe');
      camera.radius = v === 'probe' ? probeRadius() : viewRadius;
    },
    deployArrays() {
      if (!probe || probe.deploymentFraction >= 1) return;
      deployAnim = { from: probe.deploymentFraction, t0: performance.now() };
      controller.setView('probe');
    },
    info() {
      return {
        leg: legIdx, legLabel: leg()?.label ?? '', travel: u, target, view,
        deployment: probe?.deploymentFraction ?? 0, hasArrays,
        marker: [markerPos.x, markerPos.y, markerPos.z], cameraTarget: [camera.target.x, camera.target.y, camera.target.z],
      };
    },
    update(dt) {
      if (bodies[0] && leg()?.body !== 'sun') bodies[0].rotation.y += dt * 0.02;
      const n = cfg.legs.length;
      if (n === 0) return;
      // Viagem contínua até o alvo (≈ 9 s por perna, mais rápido quando falta muito)
      if (zoomPhase === 'none' && Math.abs(target - u) > 1e-4) {
        const step = dt * (0.11 + 0.3 * Math.min(1, Math.abs(target - u)));
        const nextU = target > u ? Math.min(target, u + step) : Math.max(target, u - step);
        const nextLeg = Math.min(n - 1, Math.floor(nextU));
        if (nextLeg > legIdx && cfg.follow) {
          // Fim da perna: a câmera aproxima da sonda antes de trocar a escala da cena
          u = legIdx + 1 - 1e-6;
          zoomPhase = 'in';
          zoomT = 0;
        } else {
          u = nextU;
          if (nextLeg !== legIdx) buildLeg(nextLeg);
        }
      }
      if (zoomPhase === 'in') {
        zoomT += dt / 1.6;
        camera.radius = probeRadius() + (viewRadius - probeRadius()) * Math.max(0, 1 - zoomT) ** 2;
        if (zoomT >= 1) {
          buildLeg(legIdx + 1);
          u = legIdx;
          placeMarker();
          camTarget.copyFrom(markerPos);
          camera.setTarget(camTarget.clone(), false, true, true);
          camera.radius = probeRadius();
          zoomPhase = 'out';
          zoomT = 0;
        }
      } else if (zoomPhase === 'out') {
        zoomT += dt / 2.2;
        const k = Math.min(1, zoomT);
        camera.radius = probeRadius() + ((view === 'probe' ? probeRadius() : viewRadius) - probeRadius()) * k * k;
        if (zoomT >= 1) zoomPhase = 'none';
      }
      if (u >= n - 1e-6 && target >= n && cfg.loop && cfg.loop.length > 1) {
        u = n;
        loopPhase = (loopPhase + dt * 0.02) % 1;
      }
      placeMarker();
      // Câmera acompanha a sonda (suavizada), inclusive durante a troca de perna
      if (cfg.follow || view === 'probe') {
        Vector3.LerpToRef(camTarget, markerPos, Math.min(1, dt * (view === 'probe' ? 8 : 3)), camTarget);
        camera.setTarget(camTarget.clone(), false, true, true);
      }
      if (deployAnim !== null && probe) {
        const f = Math.min(1, deployAnim.from + (performance.now() - deployAnim.t0) / 8000);
        probe.setDeployment(f);
        if (f >= 1) deployAnim = null;
      }
    },
    dispose() { probe?.dispose(); scene.dispose(); },
  };
  return controller;
}
