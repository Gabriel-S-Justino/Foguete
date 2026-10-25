/**
 * Texturas procedurais do entorno da plataforma: vegetação rasteira de restinga com manchas de areia e solo
 * exposto (litoral do Cabo Canaveral e de Vandenberg), relevo fino para o mapa de normais e ondulação do mar.
 */
import type { DynamicTexture, Scene } from '@babylonjs/core';
import { clamp255, fbm, mix, normalTexture, pixelTexture, smooth } from '../entities/procedural';

export interface TerrainTextures { albedo: DynamicTexture; normal: DynamicTexture; water: DynamicTexture }

export function terrainTextures(scene: Scene): TerrainTextures {
  const size = 1024;
  const macro = fbm(size, { period: 3, octaves: 6, seed: 11, persistence: 0.55 });
  const veg = fbm(size, { period: 12, octaves: 4, seed: 23, persistence: 0.6 });
  const grain = fbm(size, { period: 64, octaves: 2, seed: 37 });
  const albedo = pixelTexture(scene, 'terrainAlbedo', size, (d) => {
    for (let i = 0; i < size * size; i++) {
      const m = macro[i]!, v = veg[i]!, g = grain[i]!;
      // Base: palmeto-anão e capim (verde-oliva), moitas mais escuras, areia clara e solo turfoso
      const sand = smooth(0.62, 0.74, m);
      const dark = smooth(0.55, 0.7, v) * (1 - sand);
      let r = mix(92, 70, dark), gg = mix(104, 84, dark), b = mix(66, 52, dark);
      r = mix(r, 186, sand * 0.85); gg = mix(gg, 172, sand * 0.85); b = mix(b, 134, sand * 0.85);
      const peat = smooth(0.3, 0.18, m);
      r = mix(r, 74, peat * 0.6); gg = mix(gg, 70, peat * 0.6); b = mix(b, 50, peat * 0.6);
      const n = (g - 0.5) * 34;
      d[i * 4] = clamp255(r + n); d[i * 4 + 1] = clamp255(gg + n); d[i * 4 + 2] = clamp255(b + n * 0.7); d[i * 4 + 3] = 255;
    }
  });
  albedo.uScale = 14; albedo.vScale = 20;

  const ns = 512;
  const h = fbm(ns, { period: 16, octaves: 5, seed: 5, persistence: 0.55 });
  const normal = normalTexture(scene, 'terrainNormal', h, ns, 6);
  normal.uScale = 140; normal.vScale = 200;

  const ws = 256;
  const wh = fbm(ws, { period: 8, octaves: 4, seed: 71, persistence: 0.5, stretchX: 2.5 });
  const water = normalTexture(scene, 'waterNormal', wh, ws, 3);
  water.uScale = 160; water.vScale = 200;
  return { albedo, normal, water };
}
