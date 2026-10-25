/** Construtores de ambientes reutilizados pelas cenas: hangar industrial, céu estrelado e planetas (texturas reais em planets.ts). */
import {
  ArcRotateCamera, Color3, Color4, DefaultRenderingPipeline, DirectionalLight, type Engine,
  HemisphericLight, ImageProcessingConfiguration, Matrix, Mesh, MeshBuilder, PBRMaterial, Scene, ShadowGenerator,
  StandardMaterial, Vector3,
} from '@babylonjs/core';
import { MaterialLibrary } from '../entities/materials';

export interface BaseScene {
  scene: Scene;
  mats: MaterialLibrary;
  camera: ArcRotateCamera;
  sun: DirectionalLight;
  shadows: ShadowGenerator | null;
  pipeline: DefaultRenderingPipeline | null;
  setQuality(level: number): void;
}

export function createBaseScene(engine: Engine, opts: { clear: Color4; target: Vector3; radius: number; alpha?: number; beta?: number; exposure?: number; shadows?: boolean; maxZ?: number }): BaseScene {
  const scene = new Scene(engine);
  scene.clearColor = opts.clear;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = opts.exposure ?? 1.1;
  scene.skipPointerMovePicking = true;
  const camera = new ArcRotateCamera('camera', opts.alpha ?? -Math.PI / 2.4, opts.beta ?? Math.PI / 2.6, opts.radius, opts.target, scene);
  camera.attachControl(engine.getRenderingCanvas(), true);
  camera.wheelDeltaPercentage = 0.01;
  camera.panningSensibility = 0;
  camera.minZ = 0.1;
  camera.maxZ = opts.maxZ ?? 5000;
  camera.lowerBetaLimit = 0.15;
  camera.upperBetaLimit = Math.PI / 2 - 0.02;
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new Color3(0.18, 0.19, 0.22);
  const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.35), scene);
  sun.position = new Vector3(40, 80, -40);
  sun.intensity = 2.2;
  let shadows: ShadowGenerator | null = null;
  if (opts.shadows !== false) {
    shadows = new ShadowGenerator(2048, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.bias = 0.0008;
  }
  let pipeline: DefaultRenderingPipeline | null = null;
  try {
    pipeline = new DefaultRenderingPipeline('pipeline', true, scene, [camera]);
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.85;
    pipeline.bloomWeight = 0.25;
    pipeline.bloomKernel = 48;
  } catch {
    pipeline = null;
  }
  const mats = new MaterialLibrary(scene);
  return {
    scene, mats, camera, sun, shadows, pipeline,
    setQuality(level) {
      if (shadows) {
        shadows.getShadowMap()!.refreshRate = level === 0 ? 0 : 1;
        shadows.mapSize = level === 2 ? 2048 : 1024;
        shadows.usePercentageCloserFiltering = level > 0;
      }
      if (pipeline) { pipeline.bloomEnabled = level > 0; pipeline.fxaaEnabled = level > 0; }
      engine.setHardwareScalingLevel(level === 0 ? 1.5 : 1);
    },
  };
}

export interface HangarOptions { width: number; depth: number; height: number; bays: number; withCrane: boolean; doorSide: 'back' | 'right' }

/** Hangar industrial: estrutura metálica, vigas, passarelas, portão, iluminação, piso técnico, ponte rolante. */
export function buildHangar(base: BaseScene, o: HangarOptions): { floor: Mesh; lights: Mesh[] } {
  const { scene, mats } = base;
  const floor = MeshBuilder.CreateGround('floor', { width: o.width, height: o.depth }, scene);
  floor.material = mats.get('floorTile');
  floor.receiveShadows = true;
  // Faixas de segurança
  const stripeMat = mats.get('yellowSafety');
  for (const z of [-o.depth * 0.18, o.depth * 0.18]) {
    const s = MeshBuilder.CreateGround(`stripe${z}`, { width: o.width * 0.7, height: 0.25 }, scene);
    s.position = new Vector3(0, 0.01, z);
    s.material = stripeMat;
  }
  const grate = MeshBuilder.CreateGround('grating', { width: o.width * 0.12, height: o.depth * 0.8 }, scene);
  grate.position = new Vector3(o.width * 0.33, 0.012, 0);
  grate.material = mats.get('darkSteel');

  // Paredes
  const wallMat = new PBRMaterial('wallMat', scene);
  wallMat.albedoColor = new Color3(0.72, 0.71, 0.66);
  wallMat.metallic = 0.3;
  wallMat.roughness = 0.6;
  const walls: [Vector3, number, number][] = [
    [new Vector3(0, o.height / 2, o.depth / 2), o.width, 0],
    [new Vector3(-o.width / 2, o.height / 2, 0), o.depth, Math.PI / 2],
    [new Vector3(o.width / 2, o.height / 2, 0), o.depth, -Math.PI / 2],
  ];
  if (o.doorSide !== 'back') walls.push([new Vector3(0, o.height / 2, -o.depth / 2), o.width, Math.PI]);
  walls.forEach(([pos, w, rot], i) => {
    const wall = MeshBuilder.CreatePlane(`wall${i}`, { width: w, height: o.height, sideOrientation: Mesh.DOUBLESIDE }, scene);
    wall.position = pos;
    wall.rotation.y = rot;
    wall.material = wallMat;
  });
  // Portão de grandes dimensões com abertura para o exterior
  const doorW = o.width * 0.38, doorH = o.height * 0.7;
  const doorZ = o.doorSide === 'back' ? o.depth / 2 - 0.05 : 0;
  const doorFrame = MeshBuilder.CreateBox('doorFrame', { width: doorW + 2, height: doorH + 1.5, depth: 0.6 }, scene);
  doorFrame.position = new Vector3(0, (doorH + 1.5) / 2, doorZ);
  doorFrame.material = mats.get('darkSteel');
  const sky = MeshBuilder.CreatePlane('doorSky', { width: doorW, height: doorH }, scene);
  sky.position = new Vector3(0, doorH / 2, doorZ - 0.35);
  const skyMat = new StandardMaterial('doorSkyMat', scene);
  skyMat.emissiveColor = new Color3(0.62, 0.74, 0.86);
  skyMat.disableLighting = true;
  sky.material = skyMat;
  for (const side of [-1, 1]) {
    const leaf = MeshBuilder.CreateBox(`doorLeaf${side}`, { width: doorW * 0.32, height: doorH, depth: 0.3 }, scene);
    leaf.position = new Vector3(side * (doorW / 2 + doorW * 0.12), doorH / 2, doorZ - 0.6);
    leaf.material = mats.get('blueWall');
  }

  // Colunas e treliças (instâncias)
  const col = MeshBuilder.CreateBox('column', { width: 0.8, depth: 0.8, height: o.height }, scene);
  col.material = mats.get('steel');
  col.isVisible = false;
  const beam = MeshBuilder.CreateBox('beam', { width: o.width, depth: 0.5, height: 1.2 }, scene);
  beam.material = mats.get('steel');
  beam.isVisible = false;
  const diag = MeshBuilder.CreateBox('diag', { width: 0.25, depth: 0.25, height: o.height * 0.3 }, scene);
  diag.material = mats.get('steel');
  diag.isVisible = false;
  for (let b = 0; b <= o.bays; b++) {
    const z = -o.depth / 2 + (b / o.bays) * o.depth;
    for (const side of [-1, 1]) {
      col.thinInstanceAdd(Matrix.Translation(side * (o.width / 2 - 0.6), o.height / 2, z));
      diag.thinInstanceAdd(Matrix.RotationZ(side * 0.5).multiply(Matrix.Translation(side * (o.width / 2 - 2), o.height * 0.85, z)));
    }
    beam.thinInstanceAdd(Matrix.Translation(0, o.height - 0.8, z));
    beam.thinInstanceAdd(Matrix.Translation(0, o.height - 3.2, z));
  }
  col.isVisible = true; beam.isVisible = true; diag.isVisible = true;
  const purlin = MeshBuilder.CreateBox('purlin', { width: 0.3, depth: o.depth, height: 0.4 }, scene);
  purlin.material = mats.get('steel');
  for (let k = -4; k <= 4; k++) purlin.thinInstanceAdd(Matrix.Translation((k / 4.5) * (o.width / 2), o.height - 0.3, 0));
  // Dutos
  const duct = MeshBuilder.CreateCylinder('duct', { diameter: 0.9, height: o.depth, tessellation: 16 }, scene);
  duct.rotation.x = Math.PI / 2;
  duct.position = new Vector3(-o.width * 0.3, o.height - 4.2, 0);
  duct.material = mats.get('aluminum');

  // Luminárias de teto
  const lamp = MeshBuilder.CreateBox('lamp', { width: 1.6, depth: 0.6, height: 0.12 }, scene);
  lamp.material = mats.get('lampEmissive');
  for (let i = -2; i <= 2; i++) for (let j = 0; j < o.bays; j++) {
    lamp.thinInstanceAdd(Matrix.Translation(i * (o.width / 5.5), o.height - 1.6, -o.depth / 2 + ((j + 0.5) / o.bays) * o.depth));
  }

  // Passarelas laterais com guarda-corpo
  for (const side of [-1, 1]) {
    const walk = MeshBuilder.CreateBox(`catwalk${side}`, { width: 2.4, depth: o.depth * 0.9, height: 0.15 }, scene);
    walk.position = new Vector3(side * (o.width / 2 - 2.2), o.height * 0.45, 0);
    walk.material = mats.get('darkSteel');
    const rail = MeshBuilder.CreateBox(`rail${side}`, { width: 0.06, depth: o.depth * 0.9, height: 0.06 }, scene);
    rail.position = new Vector3(side * (o.width / 2 - 3.35), o.height * 0.45 + 1.1, 0);
    rail.material = mats.get('yellowSafety');
    const post = MeshBuilder.CreateBox(`post${side}`, { width: 0.06, depth: 0.06, height: 1.1 }, scene);
    post.material = mats.get('yellowSafety');
    for (let k = 0; k < 20; k++) post.thinInstanceAdd(Matrix.Translation(side * (o.width / 2 - 3.35), o.height * 0.45 + 0.55, -o.depth * 0.45 + (k / 19) * o.depth * 0.9));
  }

  if (o.withCrane) {
    for (const side of [-1, 1]) {
      const railBeam = MeshBuilder.CreateBox(`craneRail${side}`, { width: 0.6, depth: o.depth * 0.95, height: 0.8 }, scene);
      railBeam.position = new Vector3(side * (o.width / 2 - 3.6), o.height * 0.78, 0);
      railBeam.material = mats.get('yellowSafety');
    }
    const bridge = MeshBuilder.CreateBox('craneBridge', { width: o.width - 7, depth: 1.2, height: 1.4 }, scene);
    bridge.position = new Vector3(0, o.height * 0.78 + 0.6, -o.depth * 0.15);
    bridge.material = mats.get('yellowSafety');
    const trolley = MeshBuilder.CreateBox('trolley', { width: 1.8, depth: 1.8, height: 1 }, scene);
    trolley.position = new Vector3(o.width * 0.12, o.height * 0.78 - 0.4, -o.depth * 0.15);
    trolley.material = mats.get('darkSteel');
    const cable = MeshBuilder.CreateCylinder('craneCable', { diameter: 0.05, height: o.height * 0.35 }, scene);
    cable.position = new Vector3(o.width * 0.12, o.height * 0.6, -o.depth * 0.15);
    cable.material = mats.get('darkSteel');
    const hook = MeshBuilder.CreateTorus('hook', { diameter: 0.6, thickness: 0.12 }, scene);
    hook.position = new Vector3(o.width * 0.12, o.height * 0.42, -o.depth * 0.15);
    hook.material = mats.get('steel');
  }
  return { floor, lights: [lamp] };
}

/** Bancadas, carrinhos de ferramentas, equipamentos de inspeção e cabos de serviço. */
export function buildIntegrationEquipment(base: BaseScene, center: Vector3, spread: number): void {
  const { scene, mats } = base;
  const bench = (x: number, z: number, rot: number) => {
    const top = MeshBuilder.CreateBox(`bench${x}${z}`, { width: 2.4, depth: 0.9, height: 0.08 }, scene);
    top.position = new Vector3(x, 0.95, z); top.rotation.y = rot; top.material = mats.get('paintedWhite');
    const legs = MeshBuilder.CreateBox(`benchLegs${x}${z}`, { width: 2.2, depth: 0.8, height: 0.9 }, scene);
    legs.position = new Vector3(x, 0.45, z); legs.rotation.y = rot; legs.material = mats.get('darkSteel');
    const screen = MeshBuilder.CreateBox(`screen${x}${z}`, { width: 0.7, depth: 0.05, height: 0.45 }, scene);
    screen.position = new Vector3(x + 0.4 * Math.cos(rot), 1.3, z - 0.3 * Math.sin(rot)); screen.rotation.y = rot;
    const sm = mats.get('blackAnodized').clone(`screenMat${x}${z}`);
    sm.emissiveColor = new Color3(0.1, 0.35, 0.55);
    screen.material = sm;
  };
  bench(center.x - spread, center.z + spread * 0.6, 0.3);
  bench(center.x + spread * 1.1, center.z + spread * 0.8, -0.4);
  const cart = (x: number, z: number) => {
    const body = MeshBuilder.CreateBox(`cart${x}`, { width: 1, depth: 0.6, height: 0.9 }, scene);
    body.position = new Vector3(x, 0.55, z); body.material = mats.get('orangePaint');
    for (const [dx, dz] of [[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]] as const) {
      const w = MeshBuilder.CreateCylinder(`wheel${x}${dx}${dz}`, { diameter: 0.16, height: 0.06 }, scene);
      w.rotation.z = Math.PI / 2; w.position = new Vector3(x + dx, 0.08, z + dz); w.material = mats.get('rubber');
    }
  };
  cart(center.x - spread * 1.3, center.z - spread * 0.4);
  cart(center.x + spread * 1.4, center.z - spread * 0.2);
  // Escada de inspeção
  const ladder = MeshBuilder.CreateBox('ladder', { width: 0.8, depth: 1.6, height: 2.2 }, scene);
  ladder.position = new Vector3(center.x + spread * 0.8, 1.1, center.z + spread * 0.2);
  ladder.material = mats.get('aluminum');
  ladder.scaling.y = 1;
  // Cabos de serviço no piso
  const path = [new Vector3(center.x + 1, 0.05, center.z + 1), new Vector3(center.x + spread * 0.6, 0.05, center.z + spread * 0.9), new Vector3(center.x + spread * 1.6, 0.05, center.z + spread * 1.2)];
  for (let k = 0; k < 3; k++) {
    const t = MeshBuilder.CreateTube(`cable${k}`, { path: path.map((p) => p.add(new Vector3(0, 0, k * 0.15))), radius: 0.04 }, scene);
    t.material = mats.get('rubber');
  }
}

export function buildStarfield(scene: Scene, radius: number, count = 1500): Mesh {
  const stars = MeshBuilder.CreateSphere('starTemplate', { diameter: radius * 0.003, segments: 3 }, scene);
  const mat = new StandardMaterial('starMat', scene);
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  stars.material = mat;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const s = 0.5 + rnd() * 1.5;
    stars.thinInstanceAdd(Matrix.Scaling(s, s, s).multiply(Matrix.Translation(r * Math.cos(th) * radius, u * radius, r * Math.sin(th) * radius)));
  }
  stars.isPickable = false;
  return stars;
}

export { createPlanet, planetMaterial, siteOrientation, type PlanetKind } from './planets';
