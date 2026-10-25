/**
 * Biblioteca de materiais PBR reutilizados por cena (evita duplicação de materiais e texturas).
 *
 * As texturas são procedurais (procedural.ts) e imitam o acabamento real de cada superfície: concreto com
 * agregado, manchas e juntas; aço escovado; tinta com desgaste; manta térmica multicamada (MLI) amassada;
 * células solares de GaAs com barramentos prateados e substrato de Kapton; piso técnico epóxi; grade de piso;
 * fibra de carbono. Os metais refletem o ambiente da cena (cubo de ambiente em environment.ts).
 */
import { Color3, type DynamicTexture, PBRMaterial, type Scene } from '@babylonjs/core';
import { clamp255, fbm, mix, normalTexture, pixelTexture, rng, smooth } from './procedural';

export type MaterialKey =
  | 'steel' | 'darkSteel' | 'paintedWhite' | 'concrete' | 'floorTile' | 'mliGold' | 'mliSilver' | 'solarCell'
  | 'blackAnodized' | 'aluminum' | 'titanium' | 'orangePaint' | 'yellowSafety' | 'rubber' | 'glass' | 'carbon'
  | 'rocketWhite' | 'rocketBlack' | 'rocketGrey' | 'sootBlack' | 'copper' | 'lampEmissive' | 'radiatorWhite' | 'blueWall'
  | 'asphalt' | 'grating' | 'galvanized' | 'robotOrange' | 'wallPanel';

function pbr(scene: Scene, name: string, color: Color3, metallic: number, roughness: number): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = color;
  m.metallic = metallic;
  m.roughness = roughness;
  return m;
}

/** Textura em tons de cinza a partir de um campo, com cor base e variação (multiplica o albedo). */
function tinted(scene: Scene, name: string, field: Float32Array, size: number, base: [number, number, number], variance: number, extra?: (i: number, x: number, y: number) => number): DynamicTexture {
  return pixelTexture(scene, name, size, (d) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const n = (field[i]! - 0.5) * variance + (extra?.(i, x, y) ?? 0);
      d[i * 4] = clamp255(base[0] + n); d[i * 4 + 1] = clamp255(base[1] + n); d[i * 4 + 2] = clamp255(base[2] + n); d[i * 4 + 3] = 255;
    }
  });
}

/** Metal escovado: riscos longos num sentido, leve variação de rugosidade. */
function brushed(scene: Scene, key: string, base: [number, number, number], variance: number) {
  const size = 256;
  const f = fbm(size, { period: 4, octaves: 6, seed: key.length * 97, stretchX: 24, persistence: 0.7 });
  const blotch = fbm(size, { period: 2, octaves: 3, seed: 3 });
  return {
    albedo: tinted(scene, `${key}Albedo`, f, size, base, variance, (i) => (blotch[i]! - 0.5) * variance * 0.6),
    normal: normalTexture(scene, `${key}Normal`, f, size, 1.2),
  };
}

function concreteTextures(scene: Scene, key: string, base: [number, number, number], joints: number) {
  const size = 512;
  const stains = fbm(size, { period: 3, octaves: 6, seed: 101, persistence: 0.6 });
  const aggregate = fbm(size, { period: 128, octaves: 2, seed: 7 });
  const rand = rng(17);
  const pits = new Float32Array(size * size);
  for (let k = 0; k < 1800; k++) pits[Math.floor(rand() * size * size)] = 1;
  const jointAt = (x: number, y: number) => joints > 0 && ((x % (size / joints)) < 2 || (y % (size / joints)) < 2) ? 1 : 0;
  const albedo = tinted(scene, `${key}Albedo`, aggregate, size, base, 26, (i) => {
    const x = i % size, y = Math.floor(i / size);
    return (stains[i]! - 0.5) * 60 - smooth(0.6, 0.85, stains[i]!) * 25 - pits[i]! * 40 - jointAt(x, y) * 55;
  });
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = aggregate[i]! * 0.6 + stains[i]! * 0.3 - pits[i]! * 0.6 - jointAt(i % size, Math.floor(i / size)) * 0.8;
  return { albedo, normal: normalTexture(scene, `${key}Normal`, h, size, 3) };
}

function mliTextures(scene: Scene, gold: boolean) {
  const size = 512;
  // Manta amassada: vincos (ruído "ridged") em várias escalas
  const a = fbm(size, { period: 6, octaves: 5, seed: gold ? 41 : 43, persistence: 0.55 });
  const b = fbm(size, { period: 14, octaves: 3, seed: gold ? 47 : 49 });
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = (1 - Math.abs(a[i]! * 2 - 1)) * 0.7 + (1 - Math.abs(b[i]! * 2 - 1)) * 0.3;
  const albedo = pixelTexture(scene, gold ? 'mliGoldAlbedo' : 'mliSilverAlbedo', size, (d) => {
    for (let i = 0; i < size * size; i++) {
      const s = 0.75 + h[i]! * 0.35;
      const c = gold ? [222 * s, 168 * s, 74 * s] : [205 * s, 210 * s, 216 * s];
      d[i * 4] = clamp255(c[0]!); d[i * 4 + 1] = clamp255(c[1]!); d[i * 4 + 2] = clamp255(c[2]!); d[i * 4 + 3] = 255;
    }
  }, (ctx, s) => {
    // Costuras da manta e fita de fechamento
    ctx.strokeStyle = gold ? 'rgba(120,80,20,0.6)' : 'rgba(90,95,100,0.55)';
    ctx.lineWidth = 2;
    for (const p of [0.33, 0.71]) { ctx.beginPath(); ctx.moveTo(0, p * s); ctx.lineTo(s, p * s); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0.52 * s, 0); ctx.lineTo(0.52 * s, s); ctx.stroke();
  });
  return { albedo, normal: normalTexture(scene, gold ? 'mliGoldNormal' : 'mliSilverNormal', h, size, 9) };
}

function solarCellTextures(scene: Scene) {
  const size = 512;
  const cells = 8;
  const c = size / cells;
  const tint = fbm(size, { period: 2, octaves: 3, seed: 61 });
  const albedo = pixelTexture(scene, 'solarCellAlbedo', size, (d) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const cx = x % c, cy = y % c;
      const gap = cx < 3 || cy < 3;
      // Célula de tripla junção GaAs: azul-escuro arroxeado; cantos cortados mostram o substrato
      const corner = Math.min(cx, c - cx) + Math.min(cy, c - cy) < c * 0.16;
      const finger = !gap && (cy % 8 === 0);
      const busbar = !gap && Math.abs(cx - c / 2) < 2;
      let r = 22 + tint[i]! * 14, g = 30 + tint[i]! * 12, b = 70 + tint[i]! * 30;
      if (finger) { r = mix(r, 150, 0.35); g = mix(g, 155, 0.35); b = mix(b, 165, 0.35); }
      if (busbar) { r = 190; g = 192; b = 196; }
      if (gap || corner) { r = 196; g = 150; b = 70; } // Kapton/substrato
      d[i * 4] = clamp255(r); d[i * 4 + 1] = clamp255(g); d[i * 4 + 2] = clamp255(b); d[i * 4 + 3] = 255;
    }
  });
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = (x % c < 3 || y % c < 3) ? 0 : 1;
  return { albedo, normal: normalTexture(scene, 'solarCellNormal', h, size, 0.6) };
}

function paintTextures(scene: Scene, key: string, base: [number, number, number], panelLines: number, grime: number) {
  const size = 256;
  const f = fbm(size, { period: 3, octaves: 5, seed: key.length * 13 + 5 });
  const albedo = tinted(scene, `${key}Albedo`, f, size, base, 10 + grime * 30, (i) => {
    const x = i % size, y = Math.floor(i / size);
    const line = panelLines > 0 && ((x % (size / panelLines)) < 1 || (y % (size / panelLines)) < 1) ? 1 : 0;
    return -line * 30 - smooth(0.6, 0.9, f[i]!) * grime * 40;
  });
  return { albedo };
}

function floorTextures(scene: Scene) {
  // Piso epóxi cinza-claro do hangar de integração, placas de 1,2 m com juntas e marcas de rodízio
  const size = 512;
  const f = fbm(size, { period: 4, octaves: 5, seed: 81 });
  const scuff = fbm(size, { period: 8, octaves: 4, seed: 83, stretchX: 6 });
  const albedo = tinted(scene, 'floorAlbedo', f, size, [190, 194, 197], 12, (i) => {
    const x = i % size, y = Math.floor(i / size);
    const joint = (x % 128) < 2 || (y % 128) < 2 ? 1 : 0;
    return -joint * 45 - smooth(0.62, 0.8, scuff[i]!) * 22;
  });
  albedo.uScale = 10; albedo.vScale = 10;
  return { albedo };
}

function gratingTextures(scene: Scene) {
  const size = 256;
  const albedo = pixelTexture(scene, 'gratingAlbedo', size, (d) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const bar = (x % 16) < 3 || (y % 32) < 2;
      const v = bar ? 120 : 22;
      d[i * 4] = v; d[i * 4 + 1] = v + 2; d[i * 4 + 2] = v + 4; d[i * 4 + 3] = 255;
    }
  });
  albedo.uScale = 6; albedo.vScale = 6;
  return { albedo };
}

/** Painel sanduíche de parede de hangar: chapa trapezoidal com nervuras verticais e juntas. */
function wallPanelTextures(scene: Scene) {
  const size = 256;
  const dirt = fbm(size, { period: 2, octaves: 4, seed: 91 });
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = (x % 32) / 32;
    h[y * size + x] = p < 0.2 ? 1 : p < 0.3 ? 1 - (p - 0.2) * 10 : p > 0.9 ? (p - 0.9) * 10 : 0;
  }
  const albedo = tinted(scene, 'wallPanelAlbedo', dirt, size, [196, 198, 196], 18, (i) => {
    const y = Math.floor(i / size);
    return (y % 128) < 2 ? -40 : -smooth(0.55, 0.85, dirt[i]!) * 20 + (1 - y / size) * -8;
  });
  albedo.uScale = 8; albedo.vScale = 2;
  const normal = normalTexture(scene, 'wallPanelNormal', h, size, 4);
  normal.uScale = 8; normal.vScale = 2;
  return { albedo, normal };
}

function carbonTextures(scene: Scene) {
  const size = 256;
  const albedo = pixelTexture(scene, 'carbonAlbedo', size, (d) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // Sarja 2×2: faixas alternadas a cada 16 px
      const tx = Math.floor(x / 16), ty = Math.floor(y / 16);
      const dir = (tx + ty) % 2 === 0;
      const t = dir ? (x % 16) / 16 : (y % 16) / 16;
      const v = 18 + Math.sin(t * Math.PI) * 26;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v + 3; d[i * 4 + 3] = 255;
    }
  });
  albedo.uScale = 4; albedo.vScale = 4;
  return { albedo };
}

export class MaterialLibrary {
  private cache = new Map<MaterialKey, PBRMaterial>();
  constructor(private scene: Scene) {}

  /**
   * Cópia de um material da biblioteca que compartilha as texturas do original. O clone padrão do Babylon
   * duplica as DynamicTextures sem o conteúdo desenhado, e elas nunca ficam prontas (a cena não termina de carregar).
   */
  variant(key: MaterialKey, name: string): PBRMaterial {
    const src = this.get(key);
    const c = src.clone(name);
    for (const prop of ['albedoTexture', 'bumpTexture', 'metallicTexture', 'emissiveTexture', 'opacityTexture'] as const) {
      if (c[prop] !== src[prop]) { c[prop]?.dispose(); c[prop] = src[prop]; }
    }
    return c;
  }

  get(key: MaterialKey): PBRMaterial {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const s = this.scene;
    const white = new Color3(1, 1, 1);
    let m: PBRMaterial;
    const withTex = (mat: PBRMaterial, t: { albedo: DynamicTexture; normal?: DynamicTexture }) => {
      mat.albedoTexture = t.albedo;
      if (t.normal) { mat.bumpTexture = t.normal; mat.bumpTexture.level = 0.8; }
      return mat;
    };
    switch (key) {
      case 'steel': m = withTex(pbr(s, key, white, 0.9, 0.36), brushed(s, key, [150, 154, 158], 40)); break;
      case 'darkSteel': m = withTex(pbr(s, key, white, 0.8, 0.5), brushed(s, key, [52, 55, 60], 30)); break;
      case 'galvanized': m = withTex(pbr(s, key, white, 0.85, 0.48), brushed(s, key, [140, 144, 146], 55)); break;
      case 'aluminum': m = withTex(pbr(s, key, white, 0.95, 0.28), brushed(s, key, [200, 202, 205], 30)); break;
      case 'titanium': m = withTex(pbr(s, key, white, 0.9, 0.4), brushed(s, key, [142, 136, 128], 30)); break;
      case 'paintedWhite': m = withTex(pbr(s, key, white, 0.0, 0.55), paintTextures(s, key, [218, 220, 222], 4, 0.4)); break;
      case 'radiatorWhite': m = withTex(pbr(s, key, white, 0.0, 0.3), paintTextures(s, key, [236, 238, 240], 8, 0.1)); break;
      case 'concrete': {
        m = withTex(pbr(s, key, white, 0, 0.9), concreteTextures(s, key, [150, 148, 142], 4));
        break;
      }
      case 'asphalt': {
        m = withTex(pbr(s, key, white, 0, 0.85), concreteTextures(s, key, [70, 70, 70], 0));
        (m.albedoTexture as DynamicTexture).uScale = 20; (m.albedoTexture as DynamicTexture).vScale = 20;
        (m.bumpTexture as DynamicTexture).uScale = 20; (m.bumpTexture as DynamicTexture).vScale = 20;
        break;
      }
      case 'floorTile': m = withTex(pbr(s, key, white, 0.0, 0.32), floorTextures(s)); break;
      case 'grating': m = withTex(pbr(s, key, white, 0.7, 0.55), gratingTextures(s)); break;
      case 'mliGold': m = withTex(pbr(s, key, white, 1, 0.22), mliTextures(s, true)); break;
      case 'mliSilver': m = withTex(pbr(s, key, white, 1, 0.2), mliTextures(s, false)); break;
      case 'solarCell': m = withTex(pbr(s, key, white, 0.25, 0.16), solarCellTextures(s)); break;
      case 'blackAnodized': m = pbr(s, key, new Color3(0.05, 0.05, 0.06), 0.6, 0.45); break;
      case 'orangePaint': m = withTex(pbr(s, key, white, 0.05, 0.55), paintTextures(s, key, [205, 98, 30], 0, 0.5)); break;
      case 'robotOrange': m = withTex(pbr(s, key, white, 0.1, 0.4), paintTextures(s, key, [230, 120, 24], 0, 0.2)); break;
      case 'yellowSafety': m = withTex(pbr(s, key, white, 0.05, 0.55), paintTextures(s, key, [222, 176, 32], 0, 0.6)); break;
      case 'rubber': m = pbr(s, key, new Color3(0.04, 0.04, 0.04), 0, 0.9); break;
      case 'glass': m = pbr(s, key, new Color3(0.2, 0.25, 0.3), 0.1, 0.05); m.alpha = 0.6; break;
      case 'carbon': m = withTex(pbr(s, key, white, 0.3, 0.3), carbonTextures(s)); break;
      case 'rocketWhite': m = withTex(pbr(s, key, white, 0.05, 0.45), paintTextures(s, key, [226, 227, 228], 0, 0.25)); break;
      case 'rocketBlack': m = withTex(pbr(s, key, white, 0.25, 0.55), paintTextures(s, key, [20, 20, 22], 0, 0.3)); break;
      case 'rocketGrey': m = withTex(pbr(s, key, white, 0.75, 0.4), brushed(s, key, [140, 142, 146], 25)); break;
      case 'sootBlack': m = withTex(pbr(s, key, white, 0.1, 0.9), concreteTextures(s, key, [32, 30, 28], 0)); break;
      case 'copper': m = withTex(pbr(s, key, white, 1, 0.35), brushed(s, key, [184, 115, 60], 30)); break;
      case 'wallPanel': m = withTex(pbr(s, key, white, 0.35, 0.55), wallPanelTextures(s)); break;
      case 'blueWall': m = withTex(pbr(s, key, white, 0.2, 0.6), paintTextures(s, key, [56, 84, 124], 3, 0.3)); break;
      case 'lampEmissive': {
        m = pbr(s, key, new Color3(1, 1, 1), 0, 1);
        m.emissiveColor = new Color3(1, 0.97, 0.9);
        m.emissiveIntensity = 2;
        break;
      }
    }
    this.cache.set(key, m);
    return m;
  }
}
