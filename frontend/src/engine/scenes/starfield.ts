/**
 * Campo estelar a partir de um catálogo real: Yale Bright Star Catalog, 5ª edição (9.096 estrelas até V ≈ 8,
 * posições J2000, magnitude visual e temperatura de cor). Ver docs/texture-sources.md e scripts/build-starfield.mjs.
 *
 * Por que a versão anterior "estourava": cada estrela era uma esfera branca emissiva (cor 1,0) com diâmetro
 * angular fixo de 0,1° a 0,3° (2 a 8 px), todas do mesmo tamanho e cor e acima do limiar do bloom, que
 * acrescentava um halo a cada uma. A distribuição era uniforme e não seguia a contagem real por magnitude.
 *
 * Agora cada estrela é um ponto desenhado no shader com uma função de espalhamento (PSF) gaussiana de
 * ~0,6 px, como a imagem de uma estrela num sensor: a intensidade de pico segue o fluxo relativo
 * 10^(−0,4·(V − Vlim)) com compressão por raiz quadrada e é limitada a 0,8 (abaixo do limiar do bloom); só as
 * estrelas que saturam o pico crescem um pouco (até ~0,9 px de sigma). O tamanho é em pixels de tela, então o
 * campo estelar é o mesmo em qualquer zoom. As estrelas ficam no infinito (só a rotação da câmera conta) e
 * não cintilam (sem atmosfera).
 *
 * A magnitude limite é a "exposição" da cena: perto de um planeta iluminado uma câmera real não registra as
 * estrelas fracas, por isso cada cena escolhe o limite e pode reduzir a visibilidade (ex.: céu diurno).
 */
import { Constants, Effect, Mesh, type Scene, ShaderMaterial, VertexBuffer } from '@babylonjs/core';
import type { V3 } from '../orbital-mechanics/kepler';

const CATALOG_URL = `${import.meta.env?.BASE_URL ?? '/'}data/stars/bsc5.bin`;
/** Valores por estrela no arquivo: direção (3), magnitude V, temperatura de cor (K). */
const STRIDE = 5;

export interface StarCatalog { dir: Float32Array; mag: Float32Array; kelvin: Float32Array; count: number }

let catalogPromise: Promise<StarCatalog> | null = null;

/** Catálogo (carregado uma vez por sessão). Sem rede, usa uma distribuição sintética com a mesma contagem por magnitude. */
export function loadStarCatalog(): Promise<StarCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => parseCatalog(new Float32Array(buf)))
      .catch((e) => {
        console.warn(`catálogo estelar indisponível (${String(e)}); usando distribuição sintética`);
        return syntheticCatalog(9096);
      });
  }
  return catalogPromise;
}

export function parseCatalog(raw: Float32Array): StarCatalog {
  const count = Math.floor(raw.length / STRIDE);
  const dir = new Float32Array(count * 3), mag = new Float32Array(count), kelvin = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    dir[i * 3] = raw[i * STRIDE]!; dir[i * 3 + 1] = raw[i * STRIDE + 1]!; dir[i * 3 + 2] = raw[i * STRIDE + 2]!;
    mag[i] = raw[i * STRIDE + 3]!;
    kelvin[i] = raw[i * STRIDE + 4]!;
  }
  return { dir, mag, kelvin, count };
}

/**
 * Distribuição sintética (só quando o arquivo não carrega): contagem acumulada N(<m) ∝ 10^(0,48·m), calibrada
 * para ~9.100 estrelas até V = 6,5 (Sky & Telescope), e temperaturas entre 3.000 K e 25.000 K.
 */
export function syntheticCatalog(count: number, seed = 7): StarCatalog {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const dir = new Float32Array(count * 3), mag = new Float32Array(count), kelvin = new Float32Array(count);
  const mMax = 6.5, nMax = 9096;
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    dir[i * 3] = r * Math.cos(th); dir[i * 3 + 1] = r * Math.sin(th); dir[i * 3 + 2] = u;
    // Inversa da contagem acumulada: N(<m) = nMax·10^(0,48·(m − mMax))
    mag[i] = Math.max(-1.5, mMax + Math.log10(Math.max(1e-9, (rnd() * count) / nMax)) / 0.48);
    kelvin[i] = 3000 + 22000 * rnd() ** 3;
  }
  return { dir, mag, kelvin, count };
}

/** Cor (linear, máximo 1) de um corpo negro na temperatura dada (aproximação de Tanner Helland), dessaturada. */
export function starColor(kelvin: number, saturation = 0.55): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; } else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = [r, g, b].map((x) => Math.max(0, Math.min(255, x)) / 255);
  const m = Math.max(...c);
  return c.map((x) => 1 + ((x / m) - 1) * saturation) as [number, number, number];
}

/** Intensidade de pico e sigma (px) da PSF para uma magnitude, com a magnitude limite da cena (mesma fórmula do shader). */
export function starPsf(mag: number, limitMag: number): { peak: number; sigmaPx: number } {
  const L = 10 ** (-0.4 * (mag - limitMag));
  const raw = 0.05 * Math.sqrt(L);
  const fade = Math.max(0, Math.min(1, limitMag + 0.6 - mag));
  const peak = Math.min(PEAK_MAX, raw) * fade;
  const excess = Math.max(0, Math.log10(raw / PEAK_MAX));
  return { peak, sigmaPx: SIGMA_PX * (1 + 0.7 * Math.min(excess, 0.8)) };
}
const PEAK_MAX = 0.8;
const SIGMA_PX = 0.62;

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute float mag;
attribute vec3 starColor;
uniform mat4 view;
uniform mat4 projection;
uniform float limitMag;
uniform float visibility;
uniform float pxScale;
varying vec3 vColor;
varying float vPeak;
varying float vSigma;
varying float vSize;
void main() {
  // No infinito: só a rotação da câmera; profundidade no plano distante
  vec3 d = mat3(view) * position;
  vec4 c = projection * vec4(d, 0.0);
  c.z = c.w * 0.99999;
  gl_Position = c;
  float L = pow(10.0, -0.4 * (mag - limitMag));
  float raw = 0.05 * sqrt(L);
  float fade = clamp(limitMag + 0.6 - mag, 0.0, 1.0);
  vPeak = min(${PEAK_MAX.toFixed(2)}, raw) * fade * visibility;
  float excess = max(0.0, log(raw / ${PEAK_MAX.toFixed(2)}) / log(10.0));
  vSigma = ${SIGMA_PX.toFixed(2)} * (1.0 + 0.7 * min(excess, 0.8)) * pxScale;
  vSize = ceil(vSigma * 6.0) + 1.0;
  gl_PointSize = vPeak > 0.002 ? vSize : 0.0;
  vColor = starColor;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vPeak;
varying float vSigma;
varying float vSize;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * vSize;
  float a = vPeak * exp(-dot(p, p) / (2.0 * vSigma * vSigma));
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export interface StarfieldOptions {
  /** Converte uma direção do equador J2000 (z = polo norte celeste) para a cena. Padrão: z → y (polo para cima). */
  toScene?: (v: V3) => V3;
  /** Magnitude limite (exposição da cena). Padrão 6,5 (olho nu, céu escuro). */
  limitMag?: number;
  renderingGroupId?: number;
}

export interface Starfield {
  mesh: Mesh;
  /** 0–1: multiplica o brilho (ex.: céu diurno na subida). */
  setVisibility(k: number): void;
  setLimitMagnitude(m: number): void;
  /** Reorienta o céu (ex.: outra base de lançamento ou azimute). */
  setOrientation(toScene: (v: V3) => V3): void;
  readonly ready: Promise<void>;
}

/** Campo estelar no infinito, desenhado antes dos demais objetos do grupo (ou num grupo só dele). */
export function createStarfield(scene: Scene, opts: StarfieldOptions = {}): Starfield {
  if (!Effect.ShadersStore.starfieldVertexShader) {
    Effect.ShadersStore.starfieldVertexShader = VERT;
    Effect.ShadersStore.starfieldFragmentShader = FRAG;
  }
  const mesh = new Mesh('starfield', scene);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isUnIndexed = true;
  mesh.renderingGroupId = opts.renderingGroupId ?? 0;
  const mat = new ShaderMaterial('starfieldMat', scene, { vertex: 'starfield', fragment: 'starfield' }, {
    attributes: ['position', 'mag', 'starColor'],
    uniforms: ['view', 'projection', 'limitMag', 'visibility', 'pxScale'],
    needAlphaBlending: true,
  });
  mat.alphaMode = Constants.ALPHA_ONEONE;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.pointsCloud = true;
  mat.fogEnabled = false;
  let limit = opts.limitMag ?? 6.5;
  let visibility = 1;
  mat.setFloat('limitMag', limit);
  mat.setFloat('visibility', visibility);
  mat.onBindObservable.add(() => {
    const engine = scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    // Tamanho da PSF em pixels CSS: converte para pixels do buffer de renderização
    mat.getEffect()?.setFloat('pxScale', canvas && canvas.clientWidth > 0 ? engine.getRenderWidth() / canvas.clientWidth : 1);
  });
  mesh.material = mat;
  mesh.setEnabled(false);
  let toScene = opts.toScene ?? ((v: V3): V3 => [v[0], v[2], v[1]]);
  let catalog: StarCatalog | null = null;
  const fillPositions = () => {
    if (!catalog || mesh.isDisposed()) return;
    const cat = catalog;
    const pos = new Float32Array(cat.count * 3);
    for (let i = 0; i < cat.count; i++) {
      const s = toScene([cat.dir[i * 3]!, cat.dir[i * 3 + 1]!, cat.dir[i * 3 + 2]!]);
      pos[i * 3] = s[0]; pos[i * 3 + 1] = s[1]; pos[i * 3 + 2] = s[2];
    }
    mesh.setVerticesData(VertexBuffer.PositionKind, pos, false);
  };
  const ready = loadStarCatalog().then((cat) => {
    if (mesh.isDisposed()) return;
    catalog = cat;
    const col = new Float32Array(cat.count * 3);
    for (let i = 0; i < cat.count; i++) {
      const c = starColor(cat.kelvin[i]!);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    fillPositions();
    mesh.setVerticesData('mag', cat.mag, false, 1);
    mesh.setVerticesData('starColor', col, false, 3);
    mesh.setEnabled(visibility > 0.001);
  });
  return {
    mesh,
    ready,
    setVisibility(k) {
      visibility = Math.max(0, Math.min(1, k));
      mat.setFloat('visibility', visibility);
      if (mesh.getTotalVertices() > 0) mesh.setEnabled(visibility > 0.001);
    },
    setLimitMagnitude(m) { limit = m; mat.setFloat('limitMag', limit); },
    setOrientation(fn) { toScene = fn; fillPositions(); },
  };
}
