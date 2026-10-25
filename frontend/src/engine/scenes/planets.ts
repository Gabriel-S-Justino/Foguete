/**
 * Planetas com texturas reais (ver docs/texture-sources.md para fonte e licença de cada imagem):
 * - Terra: NASA Blue Marble (dia), NASA Black Marble (luzes noturnas), nuvens da Solar System Scope (CC BY 4.0)
 *   e máscara de oceano derivada do Blue Marble para o reflexo especular.
 * - Lua: NASA SVS CGI Moon Kit (cor LROC) com relevo derivado do LOLA.
 * - Júpiter: Solar System Scope (CC BY 4.0), baseada no mapa global da Cassini.
 * - Marte e Vênus: NASA-3D-Resources (Vênus com a cobertura de nuvens aplicada sobre o radar Magellan).
 * - Mercúrio, Saturno (e anéis), Urano e Netuno: Solar System Scope (CC BY 4.0).
 *
 * Um único shader faz a projeção equirretangular por pixel (sem costura no meridiano 180°), terminador
 * dia/noite, reflexo do Sol nos oceanos e dispersão atmosférica na borda. A orientação permite colocar
 * qualquer ponto da superfície (ex.: a base de lançamento) no topo da esfera.
 */
import {
  Constants, DirectionalLight, Effect, Matrix, Mesh, MeshBuilder, type Scene, ShaderMaterial, Texture, Vector3,
} from '@babylonjs/core';

export type PlanetKind = 'earth' | 'moon' | 'jupiter' | 'mercury' | 'venus' | 'mars' | 'saturn' | 'uranus' | 'neptune';

/** Textura de cor de cada planeta (Terra e Lua têm mapas adicionais). */
const ALBEDO: Record<PlanetKind, string> = {
  earth: 'earth_day_4k.jpg', moon: 'moon_2k.jpg', jupiter: 'jupiter_2k.jpg', mercury: 'mercury_1k.jpg', venus: 'venus_1k.jpg',
  mars: 'mars_1440.jpg', saturn: 'saturn_1k.jpg', uranus: 'uranus_1k.jpg', neptune: 'neptune_1k.jpg',
};
/** Planetas gasosos (escurecimento de borda) e rochosos (Lambert). */
const GASEOUS = new Set<PlanetKind>(['jupiter', 'saturn', 'uranus', 'neptune', 'venus']);

const TEX_BASE = `${import.meta.env?.BASE_URL ?? '/'}textures/planets/`;

const VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform mat4 orient;
varying vec3 vN;
varying vec3 vW;
varying vec3 vE;
void main() {
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(world) * normal);
  vE = (orient * vec4(normalize(position), 0.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vE;
uniform vec3 cameraPosition;
uniform vec3 sunDirection;
uniform float sunIntensity;
uniform float ambient;
uniform float cloudShift;
uniform mat4 world;
uniform mat4 orientInv;
uniform sampler2D albedoTex;
#ifdef EARTH
uniform sampler2D nightTex;
uniform sampler2D cloudTex;
uniform sampler2D waterTex;
#endif
#ifdef MOON
uniform sampler2D normalTex;
#endif
const float PI = 3.14159265;

// Projeção equirretangular com a técnica de Tarini: escolhe entre duas parametrizações de longitude
// a que não tem salto dentro do bloco de pixels, eliminando a costura no antimeridiano.
vec2 sphereUv(vec3 e) {
  float lat = asin(clamp(e.y, -1.0, 1.0));
  float lon = atan(e.z, e.x);
  float u1 = 0.5 + lon / (2.0 * PI);
  float u2 = fract(u1 + 0.5) - 0.5;
  return vec2(fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2, 0.5 + lat / PI);
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toGamma(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }

void main() {
  vec3 e = normalize(vE);
  vec2 uv = sphereUv(e);
  vec3 N = normalize(vN);
  vec3 L = normalize(sunDirection);
  vec3 V = normalize(cameraPosition - vW);
  vec3 albedo = toLinear(texture2D(albedoTex, uv).rgb);

#ifdef MOON
  // Relevo: normal do mapa (espaço tangente leste/norte) levada para o espaço do mundo
  vec3 eastE = normalize(vec3(-e.z, 0.0, e.x) + vec3(1e-5, 0.0, 0.0));
  vec3 northE = normalize(cross(e, eastE));
  vec3 east = normalize(mat3(world) * (orientInv * vec4(eastE, 0.0)).xyz);
  vec3 north = normalize(mat3(world) * (orientInv * vec4(northE, 0.0)).xyz);
  if (dot(cross(east, north), N) < 0.0) north = -north;
  vec3 tn = texture2D(normalTex, uv).xyz * 2.0 - 1.0;
  N = normalize(east * tn.x + north * tn.y + N * tn.z);
#endif

  float ndl = dot(N, L);
  float ndv = max(dot(N, V), 0.0);
  vec3 color;

#ifdef EARTH
  float day = smoothstep(-0.12, 0.22, ndl);
  float clouds = texture2D(cloudTex, uv + vec2(cloudShift, 0.0)).r;
  clouds = smoothstep(0.18, 0.95, clouds);
  float water = texture2D(waterTex, uv).r;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 160.0) * water * (1.0 - clouds) * step(0.0, ndl);
  float diffuse = max(ndl, 0.0);
  vec3 surface = albedo * diffuse + vec3(1.0, 0.92, 0.78) * spec * 0.4;
  // Terminador avermelhado (luz atravessando mais atmosfera)
  vec3 sunTint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.35, ndl));
  surface *= sunTint;
  vec3 cloudCol = vec3(0.9) * diffuse * sunTint * 0.85;
  surface = mix(surface, cloudCol, clouds * 0.92);
  vec3 lights = toLinear(texture2D(nightTex, uv).rgb) * vec3(1.0, 0.82, 0.55) * 1.6 * (1.0 - clouds * 0.75);
  color = surface * sunIntensity + lights * (1.0 - day) + albedo * ambient;
  // Dispersão de Rayleigh na borda do disco (lado iluminado)
  float rim = pow(1.0 - ndv, 3.0);
  color += vec3(0.25, 0.5, 1.0) * rim * 0.45 * smoothstep(-0.25, 0.5, ndl);
  color = mix(color, vec3(0.32, 0.5, 0.85) * max(ndl, 0.0), (1.0 - ndv) * 0.12);
#endif

#ifdef MOON
  // Regolito: mistura de Lommel-Seeliger (pouco escurecimento de borda) e Lambert
  // Perto do limbo (ndv → 0) o termo de Lommel-Seeliger vira "tudo ou nada" com o relevo do mapa de normais
  // e o terminador aparecia em blocos; ndv mínimo de 0,2 e o terminador geométrico (normal da esfera) suavizam.
  float mu0 = max(ndl, 0.0);
  float ls = mu0 / (mu0 + max(ndv, 0.2)) * 2.0;
  float geo = smoothstep(-0.04, 0.12, dot(normalize(vN), L));
  color = albedo * mix(mu0, ls, 0.7) * geo * 1.1 * sunIntensity + albedo * ambient;
#endif

#ifdef ROCKY
  color = albedo * max(ndl, 0.0) * 1.05 * sunIntensity + albedo * ambient;
#endif

#ifdef JUPITER
  float mu = max(ndl, 0.0);
  float limb = mix(0.75, 1.0, pow(ndv, 0.35));
  color = albedo * mu * 1.15 * limb * sunIntensity + albedo * ambient;
  color += vec3(0.9, 0.8, 0.65) * pow(1.0 - ndv, 4.0) * 0.06 * smoothstep(-0.2, 0.4, ndl);
#endif

  gl_FragColor = vec4(toGamma(color), 1.0);
}`;

const ATM_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vN;
varying vec3 vW;
void main() {
  vW = (world * vec4(position, 1.0)).xyz;
  vN = normalize(mat3(world) * normal);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const ATM_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vW;
uniform vec3 cameraPosition;
uniform vec3 sunDirection;
uniform float strength;
uniform vec3 planetCenter;
uniform float planetRadius;
void main() {
  // Parte da casca atrás do planeta: descarta analiticamente (o buffer de profundidade não tem precisão
  // para separar planeta e casca a milhares de km). Contas em unidades de raio, para caber em float32.
  vec3 o = (cameraPosition - planetCenter) / planetRadius;
  vec3 seg = (vW - cameraPosition) / planetRadius;
  float len = length(seg);
  vec3 d = seg / len;
  float b = dot(o, d);
  float c = dot(o, o) - 0.998;
  float h = b * b - c;
  if (h > 0.0) {
    float t = -b - sqrt(h);
    if (t > 0.0 && t < len) discard;
  }
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float facing = abs(dot(N, V));
  // Camada fina: brilho concentrado no limbo, atenuado no lado noturno
  float glow = pow(1.0 - facing, 2.2) * smoothstep(0.0, 0.35, facing);
  float lit = smoothstep(-0.35, 0.45, dot(N, normalize(sunDirection)));
  vec3 col = mix(vec3(0.95, 0.45, 0.2), vec3(0.3, 0.6, 1.0), smoothstep(0.0, 0.4, lit));
  gl_FragColor = vec4(col * glow * lit * strength, 1.0);
}`;

let registered = false;
function registerShaders(): void {
  if (registered) return;
  Effect.ShadersStore.planetVertexShader = VERTEX;
  Effect.ShadersStore.planetFragmentShader = FRAGMENT;
  Effect.ShadersStore.planetAtmosphereVertexShader = ATM_VERTEX;
  Effect.ShadersStore.planetAtmosphereFragmentShader = ATM_FRAGMENT;
  registered = true;
}

/**
 * Direção (do planeta para o Sol) e intensidade da luz. Se a cena define `metadata.sunPosition` (vista
 * heliocêntrica, Sol no centro), a direção é calculada para cada planeta; senão vem da luz direcional.
 */
function sunFor(scene: Scene, at?: Vector3): { dir: Vector3; intensity: number } {
  const light = scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight);
  const intensity = light ? Math.min(1.25, 0.55 + light.intensity * 0.2) : 1;
  const sunPos = (scene.metadata as { sunPosition?: Vector3 } | null)?.sunPosition;
  if (sunPos && at) return { dir: sunPos.subtract(at).normalize(), intensity };
  if (!light) return { dir: new Vector3(-1, 0.3, 0.2).normalize(), intensity };
  return { dir: light.direction.scale(-1).normalize(), intensity };
}

function texture(scene: Scene, file: string): Texture {
  const t = new Texture(`${TEX_BASE}${file}`, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, null, () => {
    // Sem a imagem (offline, bloqueio de rede) a cena continua; o planeta fica escuro
    console.warn(`Textura indisponível: ${file}`);
  });
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  return t;
}

/**
 * Matriz (objeto → referencial do planeta) que leva o topo da esfera (+Y) ao ponto lat/lon. O eixo +X do
 * objeto aponta para o azimute dado (graus a partir do norte, sentido horário; 90° = leste, o padrão, com
 * +Z para o norte).
 */
export function siteOrientation(latDeg: number, lonDeg: number, azimuthDeg = 90): Matrix {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180, az = (azimuthDeg * Math.PI) / 180;
  const up = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  const east = new Vector3(-Math.sin(lon), 0, Math.cos(lon));
  const north = new Vector3(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon));
  const x = north.scale(Math.cos(az)).addInPlace(east.scale(Math.sin(az)));
  const z = north.scale(Math.sin(az)).addInPlace(east.scale(-Math.cos(az)));
  return Matrix.FromValues(
    x.x, x.y, x.z, 0,
    up.x, up.y, up.z, 0,
    z.x, z.y, z.z, 0,
    0, 0, 0, 1,
  );
}

/** Azimute de lançamento (graus a partir do norte) para atingir a inclinação a partir da latitude da base. */
export function launchAzimuthDeg(inclinationDeg: number, latDeg: number): number {
  const s = Math.cos((inclinationDeg * Math.PI) / 180) / Math.cos((latDeg * Math.PI) / 180);
  const a = (Math.asin(Math.max(-1, Math.min(1, s))) * 180) / Math.PI;
  // Órbitas retrógradas (ex.: heliossíncrona) saem para o sul-sudoeste
  return inclinationDeg <= 90 ? a : 180 - a;
}

export interface PlanetOptions {
  /** Orientação da superfície (padrão: norte para +Y). */
  orientation?: Matrix;
  segments?: number;
  /** Desloca a camada de nuvens com o tempo (Terra). */
  animateClouds?: boolean;
}

export function planetMaterial(scene: Scene, kind: PlanetKind, orientation = Matrix.Identity()): ShaderMaterial {
  registerShaders();
  // Shaders específicos para Terra e Lua; os demais usam o de gasosos (borda) ou o de rochosos
  const defines = [kind === 'earth' || kind === 'moon' ? kind.toUpperCase() : GASEOUS.has(kind) ? 'JUPITER' : 'ROCKY'];
  const samplers = ['albedoTex', ...(kind === 'earth' ? ['nightTex', 'cloudTex', 'waterTex'] : []), ...(kind === 'moon' ? ['normalTex'] : [])];
  const mat = new ShaderMaterial(`${kind}Mat`, scene, { vertex: 'planet', fragment: 'planet' }, {
    attributes: ['position', 'normal'],
    uniforms: ['world', 'worldViewProjection', 'orient', 'orientInv', 'cameraPosition', 'sunDirection', 'sunIntensity', 'ambient', 'cloudShift'],
    samplers,
    defines,
  });
  if (kind === 'earth') {
    mat.setTexture('albedoTex', texture(scene, 'earth_day_4k.jpg'));
    mat.setTexture('nightTex', texture(scene, 'earth_night_2k.jpg'));
    mat.setTexture('cloudTex', texture(scene, 'earth_clouds_2k.jpg'));
    mat.setTexture('waterTex', texture(scene, 'earth_water_1k.png'));
  } else if (kind === 'moon') {
    mat.setTexture('albedoTex', texture(scene, 'moon_2k.jpg'));
    mat.setTexture('normalTex', texture(scene, 'moon_normal_1k.jpg'));
  } else {
    mat.setTexture('albedoTex', texture(scene, ALBEDO[kind]));
  }
  mat.setMatrix('orient', orientation);
  mat.setMatrix('orientInv', orientation.clone().transpose());
  mat.setFloat('ambient', kind === 'earth' ? 0.012 : 0.02);
  mat.setFloat('cloudShift', 0);
  mat.onBindObservable.add((mesh) => {
    const cam = scene.activeCamera;
    const sun = sunFor(scene, mesh.getAbsolutePosition());
    const effect = mat.getEffect();
    if (!effect) return;
    if (cam) effect.setVector3('cameraPosition', cam.globalPosition);
    effect.setVector3('sunDirection', sun.dir);
    effect.setFloat('sunIntensity', sun.intensity);
  });
  return mat;
}

export function createPlanet(scene: Scene, kind: PlanetKind, diameter: number, opts: PlanetOptions = {}): Mesh {
  const p = MeshBuilder.CreateSphere(`${kind}`, { diameter, segments: opts.segments ?? 96 }, scene);
  const mat = planetMaterial(scene, kind, opts.orientation);
  p.material = mat;
  if (kind === 'earth') {
    const atm = MeshBuilder.CreateSphere('atmosphere', { diameter: diameter * 1.022, segments: opts.segments ?? 96 }, scene);
    const am = new ShaderMaterial('atmMat', scene, { vertex: 'planetAtmosphere', fragment: 'planetAtmosphere' }, {
      attributes: ['position', 'normal'],
      uniforms: ['world', 'worldViewProjection', 'cameraPosition', 'sunDirection', 'strength', 'planetCenter', 'planetRadius'],
      needAlphaBlending: true,
    });
    am.alphaMode = Constants.ALPHA_ADD;
    am.backFaceCulling = false;
    am.disableDepthWrite = true;
    am.setFloat('strength', 0.8);
    am.onBindObservable.add(() => {
      const effect = am.getEffect();
      if (!effect) return;
      if (scene.activeCamera) effect.setVector3('cameraPosition', scene.activeCamera.globalPosition);
      effect.setVector3('sunDirection', sunFor(scene, p.getAbsolutePosition()).dir);
      effect.setVector3('planetCenter', p.getAbsolutePosition());
      effect.setFloat('planetRadius', (diameter / 2) * p.absoluteScaling.x);
    });
    atm.material = am;
    atm.parent = p;
    atm.isPickable = false;
    if (opts.animateClouds !== false) {
      let shift = 0;
      const obs = scene.onBeforeRenderObservable.add(() => {
        shift = (shift + scene.getEngine().getDeltaTime() * 1.5e-7) % 1;
        mat.setFloat('cloudShift', shift);
      });
      p.onDisposeObservable.add(() => scene.onBeforeRenderObservable.remove(obs));
    }
  }
  p.isPickable = false;
  return p;
}

const RING_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vL;
varying vec3 vW;
void main() {
  vL = position;
  vW = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const RING_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vL;
varying vec3 vW;
uniform sampler2D ringTex;
uniform float innerR;
uniform float outerR;
uniform vec3 sunDirection;
uniform vec3 planetCenter;
uniform float planetRadius;
uniform float sunIntensity;
void main() {
  float r = length(vL.xz);
  if (r < innerR || r > outerR) discard;
  vec4 c = texture2D(ringTex, vec2((r - innerR) / (outerR - innerR), 0.5));
  // Sombra do planeta sobre os anéis (cilindro na direção do Sol), em unidades de raio do planeta
  vec3 p = (vW - planetCenter) / planetRadius;
  vec3 L = normalize(sunDirection);
  float along = dot(p, L);
  float perp = length(p - L * along);
  float shadow = (along < 0.0 && perp < 1.0) ? 0.08 : 1.0;
  vec3 col = pow(c.rgb, vec3(2.2)) * 1.6 * sunIntensity * shadow;
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), c.a * 0.95);
}`;

/**
 * Anéis de Saturno: disco no plano equatorial do planeta (filho da esfera de raio 1), com o perfil radial de
 * cor e transparência entre 1,085 e 2,298 raios (D ao A, como na textura de origem).
 */
export function createSaturnRings(scene: Scene, planet: Mesh): Mesh {
  registerShaders();
  Effect.ShadersStore.saturnRingVertexShader ??= RING_VERTEX;
  Effect.ShadersStore.saturnRingFragmentShader ??= RING_FRAGMENT;
  const inner = 1.085, outer = 2.298;
  const ring = MeshBuilder.CreateDisc('saturnRings', { radius: outer, tessellation: 128, sideOrientation: Mesh.DOUBLESIDE }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.bakeCurrentTransformIntoVertices();
  const mat = new ShaderMaterial('saturnRingMat', scene, { vertex: 'saturnRing', fragment: 'saturnRing' }, {
    attributes: ['position'],
    uniforms: ['world', 'worldViewProjection', 'innerR', 'outerR', 'sunDirection', 'planetCenter', 'planetRadius', 'sunIntensity'],
    samplers: ['ringTex'],
    needAlphaBlending: true,
  });
  const tex = new Texture(`${TEX_BASE}saturn_ring.png`, scene, true, true, Texture.BILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.hasAlpha = true;
  mat.setTexture('ringTex', tex);
  mat.setFloat('innerR', inner);
  mat.setFloat('outerR', outer);
  mat.backFaceCulling = false;
  mat.onBindObservable.add(() => {
    const effect = mat.getEffect();
    if (!effect) return;
    const sun = sunFor(scene, planet.getAbsolutePosition());
    effect.setVector3('sunDirection', sun.dir);
    effect.setFloat('sunIntensity', sun.intensity);
    effect.setVector3('planetCenter', planet.getAbsolutePosition());
    effect.setFloat('planetRadius', planet.absoluteScaling.x);
  });
  ring.material = mat;
  ring.parent = planet;
  ring.isPickable = false;
  return ring;
}
