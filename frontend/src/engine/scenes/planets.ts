/**
 * Planetas com texturas reais (ver docs/texture-sources.md para fonte e licença de cada imagem):
 * - Terra: NASA Blue Marble (dia), NASA Black Marble (luzes noturnas), nuvens da Solar System Scope (CC BY 4.0)
 *   e máscara de oceano derivada do Blue Marble para o reflexo especular.
 * - Lua: NASA SVS CGI Moon Kit (cor LROC) com relevo derivado do LOLA.
 * - Júpiter: Solar System Scope (CC BY 4.0), baseada no mapa global da Cassini.
 *
 * Um único shader faz a projeção equirretangular por pixel (sem costura no meridiano 180°), terminador
 * dia/noite, reflexo do Sol nos oceanos e dispersão atmosférica na borda. A orientação permite colocar
 * qualquer ponto da superfície (ex.: a base de lançamento) no topo da esfera.
 */
import {
  Constants, DirectionalLight, Effect, Matrix, type Mesh, MeshBuilder, type Scene, ShaderMaterial, Texture, Vector3,
} from '@babylonjs/core';

export type PlanetKind = 'earth' | 'moon' | 'jupiter';

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
  float spec = pow(max(dot(N, H), 0.0), 120.0) * water * (1.0 - clouds) * step(0.0, ndl);
  float diffuse = max(ndl, 0.0);
  vec3 surface = albedo * diffuse * 1.15 + vec3(1.0, 0.92, 0.78) * spec * 0.9;
  // Terminador avermelhado (luz atravessando mais atmosfera)
  vec3 sunTint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.35, ndl));
  surface *= sunTint;
  vec3 cloudCol = vec3(0.9) * diffuse * sunTint * 0.95;
  surface = mix(surface, cloudCol, clouds * 0.92);
  vec3 lights = toLinear(texture2D(nightTex, uv).rgb) * vec3(1.0, 0.82, 0.55) * 1.6 * (1.0 - clouds * 0.75);
  color = surface * sunIntensity + lights * (1.0 - day) + albedo * ambient;
  // Dispersão de Rayleigh na borda do disco (lado iluminado)
  float rim = pow(1.0 - ndv, 3.0);
  color += vec3(0.25, 0.5, 1.0) * rim * 0.9 * smoothstep(-0.25, 0.5, ndl);
  color = mix(color, vec3(0.32, 0.5, 0.85) * max(ndl, 0.0), (1.0 - ndv) * 0.18);
#endif

#ifdef MOON
  // Regolito: mistura de Lommel-Seeliger (pouco escurecimento de borda) e Lambert
  float mu0 = max(ndl, 0.0);
  float ls = mu0 / max(mu0 + ndv, 1e-3) * 2.0;
  color = albedo * mix(mu0, ls, 0.7) * 1.35 * sunIntensity + albedo * ambient;
#endif

#ifdef JUPITER
  float mu = max(ndl, 0.0);
  float limb = mix(0.75, 1.0, pow(ndv, 0.35));
  color = albedo * mu * 1.45 * limb * sunIntensity + albedo * ambient;
  color += vec3(0.9, 0.8, 0.65) * pow(1.0 - ndv, 4.0) * 0.12 * smoothstep(-0.2, 0.4, ndl);
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
void main() {
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

function sunFor(scene: Scene): { dir: Vector3; intensity: number } {
  const light = scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight);
  if (!light) return { dir: new Vector3(-1, 0.3, 0.2).normalize(), intensity: 1 };
  return { dir: light.direction.scale(-1).normalize(), intensity: Math.min(1.4, 0.55 + light.intensity * 0.2) };
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

/** Matriz (objeto → referencial do planeta) que leva o topo da esfera (+Y) ao ponto lat/lon, com +X para leste e +Z para o norte. */
export function siteOrientation(latDeg: number, lonDeg: number): Matrix {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
  const up = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  const east = new Vector3(-Math.sin(lon), 0, Math.cos(lon));
  const north = new Vector3(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon));
  return Matrix.FromValues(
    east.x, east.y, east.z, 0,
    up.x, up.y, up.z, 0,
    north.x, north.y, north.z, 0,
    0, 0, 0, 1,
  );
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
  const defines = [kind.toUpperCase()];
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
    mat.setTexture('albedoTex', texture(scene, 'jupiter_2k.jpg'));
  }
  mat.setMatrix('orient', orientation);
  mat.setMatrix('orientInv', orientation.clone().transpose());
  mat.setFloat('ambient', kind === 'earth' ? 0.012 : 0.02);
  mat.setFloat('cloudShift', 0);
  mat.onBindObservable.add(() => {
    const cam = scene.activeCamera;
    const sun = sunFor(scene);
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
      uniforms: ['world', 'worldViewProjection', 'cameraPosition', 'sunDirection', 'strength'],
      needAlphaBlending: true,
    });
    am.alphaMode = Constants.ALPHA_ADD;
    am.backFaceCulling = false;
    am.disableDepthWrite = true;
    am.setFloat('strength', 1.25);
    am.onBindObservable.add(() => {
      const effect = am.getEffect();
      if (!effect) return;
      if (scene.activeCamera) effect.setVector3('cameraPosition', scene.activeCamera.globalPosition);
      effect.setVector3('sunDirection', sunFor(scene).dir);
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
