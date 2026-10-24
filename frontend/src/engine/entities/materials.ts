/** Biblioteca de materiais PBR reutilizados por cena (evita duplicação de materiais e texturas). */
import { Color3, DynamicTexture, PBRMaterial, type Scene, Texture } from '@babylonjs/core';

export type MaterialKey =
  | 'steel' | 'darkSteel' | 'paintedWhite' | 'concrete' | 'floorTile' | 'mliGold' | 'mliSilver' | 'solarCell'
  | 'blackAnodized' | 'aluminum' | 'titanium' | 'orangePaint' | 'yellowSafety' | 'rubber' | 'glass' | 'carbon'
  | 'rocketWhite' | 'rocketBlack' | 'rocketGrey' | 'sootBlack' | 'copper' | 'lampEmissive' | 'radiatorWhite' | 'blueWall';

function pbr(scene: Scene, name: string, color: Color3, metallic: number, roughness: number): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = color;
  m.metallic = metallic;
  m.roughness = roughness;
  return m;
}

function noiseTexture(scene: Scene, name: string, base: [number, number, number], variance: number, size = 256, lines = 0): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const n = (rnd() - 0.5) * variance;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (lines > 0) {
    ctx.strokeStyle = 'rgba(40,44,50,0.55)';
    ctx.lineWidth = 2;
    for (let k = 0; k <= lines; k++) {
      const p = (k / lines) * size;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }
  }
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

function solarCellTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture('solarCellTex', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#0d1a33';
  ctx.fillRect(0, 0, size, size);
  const cells = 8;
  const c = size / cells;
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    ctx.fillStyle = (i + j) % 2 ? '#14284f' : '#112244';
    ctx.fillRect(i * c + 2, j * c + 2, c - 4, c - 4);
    ctx.strokeStyle = 'rgba(160,180,210,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(i * c + c / 2, j * c + 2); ctx.lineTo(i * c + c / 2, j * c + c - 2); ctx.stroke();
  }
  tex.update();
  return tex;
}

function mliTexture(scene: Scene, gold: boolean): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(gold ? 'mliGoldTex' : 'mliSilverTex', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, size, size);
  if (gold) { g.addColorStop(0, '#b8862b'); g.addColorStop(0.5, '#e0b35a'); g.addColorStop(1, '#9a6d1e'); }
  else { g.addColorStop(0, '#9aa3ad'); g.addColorStop(0.5, '#d9dee4'); g.addColorStop(1, '#8a929b'); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Rugas da manta multicamada
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 140; k++) {
    ctx.strokeStyle = gold ? `rgba(90,60,10,${0.15 + rnd() * 0.25})` : `rgba(60,65,70,${0.1 + rnd() * 0.2})`;
    ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath();
    const x = rnd() * size, y = rnd() * size;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + rnd() * 40 - 20, y + rnd() * 40 - 20, x + rnd() * 60 - 30, y + rnd() * 60 - 30);
    ctx.stroke();
  }
  tex.update();
  return tex;
}

export class MaterialLibrary {
  private cache = new Map<MaterialKey, PBRMaterial>();
  constructor(private scene: Scene) {}

  get(key: MaterialKey): PBRMaterial {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const s = this.scene;
    let m: PBRMaterial;
    switch (key) {
      case 'steel': m = pbr(s, key, new Color3(0.56, 0.58, 0.6), 0.9, 0.38); break;
      case 'darkSteel': m = pbr(s, key, new Color3(0.18, 0.19, 0.21), 0.85, 0.5); break;
      case 'paintedWhite': m = pbr(s, key, new Color3(0.86, 0.87, 0.88), 0.05, 0.55); break;
      case 'radiatorWhite': m = pbr(s, key, new Color3(0.93, 0.94, 0.95), 0.0, 0.3); break;
      case 'concrete': {
        m = pbr(s, key, new Color3(1, 1, 1), 0, 0.92);
        m.albedoTexture = noiseTexture(s, 'concreteTex', [128, 128, 126], 26);
        break;
      }
      case 'floorTile': {
        m = pbr(s, key, new Color3(1, 1, 1), 0.05, 0.35);
        const t = noiseTexture(s, 'floorTex', [196, 200, 204], 10, 256, 4);
        t.uScale = 12; t.vScale = 12;
        m.albedoTexture = t;
        break;
      }
      case 'mliGold': m = pbr(s, key, new Color3(1, 1, 1), 0.85, 0.32); m.albedoTexture = mliTexture(s, true); break;
      case 'mliSilver': m = pbr(s, key, new Color3(1, 1, 1), 0.9, 0.28); m.albedoTexture = mliTexture(s, false); break;
      case 'solarCell': m = pbr(s, key, new Color3(1, 1, 1), 0.4, 0.18); m.albedoTexture = solarCellTexture(s); break;
      case 'blackAnodized': m = pbr(s, key, new Color3(0.05, 0.05, 0.06), 0.6, 0.45); break;
      case 'aluminum': m = pbr(s, key, new Color3(0.78, 0.79, 0.8), 0.95, 0.3); break;
      case 'titanium': m = pbr(s, key, new Color3(0.55, 0.53, 0.5), 0.9, 0.42); break;
      case 'orangePaint': m = pbr(s, key, new Color3(0.86, 0.38, 0.08), 0.1, 0.5); break;
      case 'yellowSafety': m = pbr(s, key, new Color3(0.9, 0.7, 0.1), 0.1, 0.55); break;
      case 'rubber': m = pbr(s, key, new Color3(0.04, 0.04, 0.04), 0, 0.9); break;
      case 'glass': m = pbr(s, key, new Color3(0.2, 0.25, 0.3), 0.1, 0.05); m.alpha = 0.6; break;
      case 'carbon': m = pbr(s, key, new Color3(0.08, 0.08, 0.09), 0.3, 0.35); break;
      case 'rocketWhite': m = pbr(s, key, new Color3(0.9, 0.9, 0.9), 0.1, 0.45); break;
      case 'rocketBlack': m = pbr(s, key, new Color3(0.06, 0.06, 0.07), 0.3, 0.55); break;
      case 'rocketGrey': m = pbr(s, key, new Color3(0.55, 0.56, 0.58), 0.8, 0.4); break;
      case 'sootBlack': m = pbr(s, key, new Color3(0.1, 0.09, 0.08), 0.2, 0.85); break;
      case 'copper': m = pbr(s, key, new Color3(0.72, 0.45, 0.2), 1, 0.35); break;
      case 'blueWall': m = pbr(s, key, new Color3(0.2, 0.32, 0.5), 0.3, 0.6); break;
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
