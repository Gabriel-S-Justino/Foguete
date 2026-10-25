/**
 * Efeitos de propulsão: pluma, chamas, rastro de fumaça, nuvem de vapor na plataforma e luz da exaustão.
 *
 * - A pluma é uma malha com shader preso ao bocal: segue sempre o eixo do motor, inclusive com o foguete
 *   inclinado. A cor depende do propelente (querosene alaranjado, metano azulado, hidrogênio quase
 *   transparente com discos de Mach, sólido branco-amarelado e muito brilhante).
 * - A pluma se expande quando a pressão ambiente cai (no vácuo fica larga e tênue) e encurta com o empuxo.
 * - Chamas em partículas locais (acompanham o motor) dão turbulência; o rastro de fumaça fica no espaço
 *   do mundo e só aparece onde há atmosfera densa.
 */
import {
  Color3, Color4, Constants, DynamicTexture, Effect, Matrix, type Mesh, MeshBuilder, ParticleSystem, PointLight,
  type Scene, ShaderMaterial, TransformNode, Vector3,
} from '@babylonjs/core';

export type PlumeKind = 'kerolox' | 'hydrolox' | 'methalox' | 'solid';

interface PlumeLook { core: Color3; outer: Color3; intensity: number; diamonds: number; smoke: number; smokeColor: Color4 }

const LOOKS: Record<PlumeKind, PlumeLook> = {
  kerolox: { core: new Color3(1.0, 0.88, 0.62), outer: new Color3(1.0, 0.42, 0.1), intensity: 1.0, diamonds: 0.35, smoke: 0.7, smokeColor: new Color4(0.78, 0.74, 0.7, 0.55) },
  methalox: { core: new Color3(0.82, 0.8, 1.0), outer: new Color3(0.55, 0.42, 0.95), intensity: 0.8, diamonds: 0.6, smoke: 0.35, smokeColor: new Color4(0.85, 0.86, 0.9, 0.45) },
  hydrolox: { core: new Color3(0.8, 0.85, 1.0), outer: new Color3(0.45, 0.55, 1.0), intensity: 0.45, diamonds: 1.0, smoke: 0.25, smokeColor: new Color4(0.95, 0.96, 0.98, 0.45) },
  solid: { core: new Color3(1.0, 0.97, 0.85), outer: new Color3(1.0, 0.62, 0.25), intensity: 1.35, diamonds: 0.15, smoke: 1.4, smokeColor: new Color4(0.9, 0.88, 0.85, 0.7) },
};

const PLUME_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float radius0;
uniform float expand;
uniform float plumeLength;
uniform float taper;
varying float vT;
varying vec3 vN;
varying vec3 vW;
varying float vAngle;
void main() {
  float t = clamp(-position.y, 0.0, 1.0);
  float r = radius0 * mix(1.0, expand, pow(t, 0.55)) * (1.0 - taper * pow(t, 2.2) * 0.85);
  vec2 dir = normalize(position.xz + vec2(1e-6));
  vec3 p = vec3(dir.x * r, -t * plumeLength, dir.y * r);
  vec4 w = world * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(world) * vec3(dir.x, 0.0, dir.y));
  vT = t;
  vAngle = atan(dir.y, dir.x);
  gl_Position = viewProjection * w;
}`;

const PLUME_FRAGMENT = /* glsl */ `
precision highp float;
varying float vT;
varying vec3 vN;
varying vec3 vW;
varying float vAngle;
uniform vec3 cameraPosition;
uniform vec3 coreColor;
uniform vec3 outerColor;
uniform float intensity;
uniform float diamonds;
uniform float time;
uniform float layer;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float facing = abs(dot(normalize(vN), V));
  // Volume aparente: mais denso no centro do cone, transparente nas bordas
  float body = pow(facing, layer > 0.5 ? 1.0 : 2.2);
  float start = smoothstep(0.0, 0.04, vT);
  float tail = 1.0 - smoothstep(layer > 0.5 ? 0.35 : 0.5, 1.0, vT);
  float n = noise(vec2(vAngle * 3.0, vT * 9.0 - time * 22.0)) * 0.6 + noise(vec2(vAngle * 7.0, vT * 25.0 - time * 47.0)) * 0.4;
  float flicker = 0.7 + 0.45 * n;
  // Discos de Mach: compressões periódicas visíveis com pressão ambiente alta
  float d = pow(max(0.0, cos(vT * 6.2831 * 4.5)), 10.0) * diamonds * (1.0 - smoothstep(0.1, 0.7, vT));
  vec3 col = mix(coreColor, outerColor, smoothstep(0.0, 0.55, vT + (1.0 - facing) * 0.4));
  float a = intensity * body * start * tail * flicker * (layer > 0.5 ? 0.35 : 1.0);
  vec3 outC = col * a + vec3(1.0, 0.95, 0.85) * d * body * intensity * 1.4;
  outC += coreColor * (1.0 - smoothstep(0.0, 0.12, vT)) * body * intensity * 1.2;
  gl_FragColor = vec4(outC, 1.0);
}`;

let shadersRegistered = false;
const textures = new WeakMap<Scene, { flame: DynamicTexture; smoke: DynamicTexture }>();

function radialTexture(scene: Scene, name: string, stops: [number, string][], puffs = 0): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const draw = (cx: number, cy: number, r: number, alpha: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  };
  draw(size / 2, size / 2, size / 2, 1);
  // Fumaça: vários "rolos" sobrepostos dão aspecto de nuvem em vez de disco liso
  let seed = 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < puffs; k++) {
    const a = rnd() * Math.PI * 2, d = rnd() * size * 0.22;
    draw(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, size * (0.15 + rnd() * 0.2), 0.55);
  }
  ctx.globalAlpha = 1;
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

/** Textura de fumaça compartilhada pelos efeitos da cena. */
export function smokeTexture(scene: Scene): DynamicTexture { return texturesFor(scene).smoke; }

function texturesFor(scene: Scene) {
  let t = textures.get(scene);
  if (!t) {
    t = {
      flame: radialTexture(scene, 'flameTex', [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,220,160,0.7)'], [1, 'rgba(255,140,40,0)']]),
      smoke: radialTexture(scene, 'smokeTex', [[0, 'rgba(255,255,255,0.85)'], [0.6, 'rgba(235,235,235,0.35)'], [1, 'rgba(220,220,220,0)']], 7),
    };
    textures.set(scene, t);
  }
  return t;
}

export interface ExhaustOptions {
  /** Diâmetro do conjunto de tubeiras (m). */
  clusterDia: number;
  /** Saída das tubeiras em y local do nó do motor (negativo). */
  exitY: number;
  kind: PlumeKind;
  /** Ponto da trincheira de chamas, para a nuvem de vapor na plataforma. */
  groundEmitter?: TransformNode;
}

export interface ExhaustEffect {
  /** Saída das tubeiras (nó preso ao motor). */
  readonly nozzle: TransformNode;
  readonly smokeColor: Color4;
  /** Quanto o propelente produz de fumaça visível (sólido > querosene > metano > hidrogênio). */
  readonly smokeAmount: number;
  /** throttle 0..1, ambientPressureRatio 0 (vácuo) .. 1 (nível do mar), groundProximity 0..1 */
  set(throttle: number, ambientPressureRatio: number, groundProximity: number): void;
  setQuality(level: number): void;
  stop(): void;
  dispose(): void;
}

export function createExhaust(scene: Scene, engineNode: TransformNode, opts: ExhaustOptions): ExhaustEffect {
  if (!shadersRegistered) {
    Effect.ShadersStore.plumeVertexShader = PLUME_VERTEX;
    Effect.ShadersStore.plumeFragmentShader = PLUME_FRAGMENT;
    shadersRegistered = true;
  }
  const look = LOOKS[opts.kind];
  const tex = texturesFor(scene);
  const dia = Math.max(0.6, opts.clusterDia);

  const nozzle = new TransformNode('nozzle-exit', scene);
  nozzle.parent = engineNode;
  nozzle.position.y = opts.exitY;

  // Pluma: duas camadas (núcleo e envelope) presas ao bocal
  const layers: { mesh: Mesh; mat: ShaderMaterial }[] = [];
  for (const layer of [0, 1]) {
    const mesh = MeshBuilder.CreateCylinder(`plume-${layer}`, { height: 1, diameter: 1, tessellation: 28, subdivisions: 20, cap: 0 }, scene);
    mesh.bakeTransformIntoVertices(Matrix.Translation(0, -0.5, 0));
    mesh.parent = nozzle;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true; // a geometria é deformada no shader
    const mat = new ShaderMaterial(`plumeMat-${layer}`, scene, { vertex: 'plume', fragment: 'plume' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'radius0', 'expand', 'plumeLength', 'taper', 'cameraPosition', 'coreColor', 'outerColor', 'intensity', 'diamonds', 'time', 'layer'],
      needAlphaBlending: true,
    });
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.setColor3('coreColor', look.core);
    mat.setColor3('outerColor', look.outer);
    mat.setFloat('layer', layer);
    mat.onBindObservable.add(() => {
      const cam = scene.activeCamera;
      if (cam) mat.getEffect()?.setVector3('cameraPosition', cam.globalPosition);
    });
    mesh.material = mat;
    mesh.setEnabled(false);
    layers.push({ mesh, mat });
  }

  // Chamas turbulentas (partículas locais: seguem o motor e a inclinação)
  const flame = new ParticleSystem('flame', 1500, scene);
  flame.particleTexture = tex.flame;
  flame.emitter = nozzle as unknown as Vector3;
  flame.isLocal = true;
  flame.minEmitBox = new Vector3(-0.3 * dia, 0, -0.3 * dia);
  flame.maxEmitBox = new Vector3(0.3 * dia, 0, 0.3 * dia);
  flame.direction1 = new Vector3(-0.12, -1, -0.12);
  flame.direction2 = new Vector3(0.12, -1, 0.12);
  flame.color1 = new Color4(look.core.r, look.core.g, look.core.b, 0.9);
  flame.color2 = new Color4(look.outer.r, look.outer.g, look.outer.b, 0.8);
  flame.colorDead = new Color4(look.outer.r * 0.4, look.outer.g * 0.2, look.outer.b * 0.1, 0);
  flame.minLifeTime = 0.06;
  flame.maxLifeTime = 0.16;
  flame.minAngularSpeed = -2;
  flame.maxAngularSpeed = 2;
  flame.blendMode = ParticleSystem.BLENDMODE_ADD;
  flame.emitRate = 0;
  flame.minEmitPower = 40 * dia;
  flame.maxEmitPower = 70 * dia;
  flame.updateSpeed = 0.016;
  flame.start();

  // Rastro de fumaça/condensação (espaço do mundo: fica para trás enquanto o foguete sobe)
  const trail = new ParticleSystem('trail', 1600, scene);
  trail.particleTexture = tex.smoke;
  trail.emitter = nozzle as unknown as Vector3;
  trail.minEmitBox = new Vector3(-0.4 * dia, -dia * 3, -0.4 * dia);
  trail.maxEmitBox = new Vector3(0.4 * dia, -dia * 1.5, 0.4 * dia);
  trail.direction1 = new Vector3(-0.25, -1, -0.25);
  trail.direction2 = new Vector3(0.25, -1, 0.25);
  trail.color1 = look.smokeColor;
  trail.color2 = new Color4(look.smokeColor.r * 0.92, look.smokeColor.g * 0.92, look.smokeColor.b * 0.92, look.smokeColor.a * 0.8);
  trail.colorDead = new Color4(0.7, 0.7, 0.72, 0);
  trail.addSizeGradient(0, 1.2 * dia);
  trail.addSizeGradient(0.3, 4 * dia);
  trail.addSizeGradient(1, 9 * dia);
  // Curto: só a fumaça junto ao bocal. O rastro ao longo da trajetória é o de smokeTrail.ts
  trail.minLifeTime = 1.2;
  trail.maxLifeTime = 2.8;
  trail.minEmitPower = 4;
  trail.maxEmitPower = 14;
  trail.minAngularSpeed = -0.3;
  trail.maxAngularSpeed = 0.3;
  trail.minInitialRotation = 0;
  trail.maxInitialRotation = Math.PI * 2;
  trail.emitRate = 0;
  trail.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  trail.start();

  // Nuvem de vapor da água de supressão acústica + fumaça saindo da trincheira de chamas
  const ground = new ParticleSystem('pad-cloud', 1400, scene);
  ground.particleTexture = tex.smoke;
  ground.emitter = (opts.groundEmitter ?? nozzle) as unknown as Vector3;
  ground.minEmitBox = new Vector3(-6, 0, -6);
  ground.maxEmitBox = new Vector3(6, 2, 6);
  ground.direction1 = new Vector3(-1, 0.05, -0.35);
  ground.direction2 = new Vector3(1, 0.35, 1);
  ground.color1 = new Color4(0.96, 0.95, 0.94, 0.65);
  ground.color2 = new Color4(0.82, 0.8, 0.77, 0.55);
  ground.colorDead = new Color4(0.75, 0.75, 0.75, 0);
  ground.addSizeGradient(0, 6);
  ground.addSizeGradient(0.4, 22);
  ground.addSizeGradient(1, 45);
  ground.minLifeTime = 5;
  ground.maxLifeTime = 11;
  ground.minEmitPower = 15;
  ground.maxEmitPower = 55;
  ground.addVelocityGradient(0, 1);
  ground.addVelocityGradient(1, 0.08);
  ground.minInitialRotation = 0;
  ground.maxInitialRotation = Math.PI * 2;
  ground.emitRate = 0;
  ground.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ground.gravity = new Vector3(0, 1.2, 0);
  ground.start();

  const light = new PointLight('exhaust-light', new Vector3(0, -dia * 2, 0), scene);
  light.parent = nozzle;
  light.diffuse = Color3.Lerp(look.core, look.outer, 0.4);
  light.intensity = 0;
  light.range = 300 * Math.max(1, dia / 3);

  let quality = 2;
  let time = 0;
  let lastThrottle = 0;
  const obs = scene.onBeforeRenderObservable.add(() => { time += scene.getEngine().getDeltaTime() / 1000; });

  return {
    nozzle,
    smokeColor: look.smokeColor,
    smokeAmount: look.smoke,
    set(throttle, pressure, groundK) {
      const q = quality === 0 ? 0.35 : quality === 1 ? 0.65 : 1;
      const on = throttle > 0.01;
      lastThrottle = throttle;
      const vac = 1 - pressure;
      // Geometria: no nível do mar a pluma é estreita e afunilada; no vácuo se abre em leque
      const length = dia * (5.5 + 14 * vac) * (0.45 + 0.55 * throttle) * (opts.kind === 'solid' ? 1.4 : 1);
      const expand = 1.05 + vac * 4.5;
      layers.forEach(({ mesh, mat }, i) => {
        mesh.setEnabled(on && (i === 0 || quality > 0));
        if (!on) return;
        mat.setFloat('radius0', dia * 0.5 * (i === 0 ? 0.9 : 1.35));
        mat.setFloat('expand', expand * (i === 0 ? 1 : 1.2));
        mat.setFloat('plumeLength', length * (i === 0 ? 1 : 1.25));
        mat.setFloat('taper', pressure);
        // No vácuo a pluma fica mais tênue (menor densidade); o sólido continua brilhante
        mat.setFloat('intensity', look.intensity * (0.35 + 0.65 * throttle) * (0.45 + 0.55 * pressure + (opts.kind === 'solid' ? 0.3 : 0)));
        mat.setFloat('diamonds', look.diamonds * pressure * throttle);
        mat.setFloat('time', time);
      });
      flame.emitRate = on ? throttle * 450 * q : 0;
      flame.minSize = 0.25 * dia * (1 + vac * 2);
      flame.maxSize = 0.7 * dia * (1 + vac * 2.5);
      flame.minEmitPower = length * 1.4;
      flame.maxEmitPower = length * 2.4;
      // Fumaça só onde há ar: some acima de ~40 km
      const air = Math.max(0, Math.min(1, (pressure - 0.003) / 0.25));
      trail.emitRate = on ? throttle * 160 * look.smoke * Math.sqrt(air) * q : 0;
      ground.emitRate = on ? throttle * groundK * 150 * q : 0;
      light.intensity = on ? throttle * (6 + 22 * pressure) * look.intensity * Math.max(1, dia / 3) * (0.9 + Math.random() * 0.2) : 0;
    },
    setQuality(level) { quality = level; if (lastThrottle === 0) layers.forEach(({ mesh }) => mesh.setEnabled(false)); },
    stop() {
      flame.emitRate = 0; trail.emitRate = 0; ground.emitRate = 0; light.intensity = 0;
      layers.forEach(({ mesh }) => mesh.setEnabled(false));
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(obs);
      // texturas compartilhadas entre motores: não descartar aqui
      flame.dispose(false); trail.dispose(false); ground.dispose(false); light.dispose();
      layers.forEach(({ mesh, mat }) => { mat.dispose(); mesh.dispose(); });
      nozzle.dispose();
    },
  };
}
