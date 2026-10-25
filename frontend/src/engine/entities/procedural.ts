/**
 * Texturas procedurais (sem arquivos externos): ruído fractal periódico, para a textura repetir sem costura,
 * e mapas de normais derivados de campos de altura. Usado nos materiais de concreto, metal escovado, manta
 * térmica (MLI), células solares, piso técnico, grade, terreno e água.
 */
import { DynamicTexture, type Scene, Texture } from '@babylonjs/core';

export function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/**
 * Ruído fractal periódico (soma de oitavas de ruído de valor) num campo size×size em [0, 1].
 * stretchX > 1 alonga o ruído no eixo x (riscos de metal escovado).
 */
export function fbm(size: number, opts: { period?: number; octaves?: number; persistence?: number; seed?: number; stretchX?: number } = {}): Float32Array {
  const { period = 4, octaves = 5, persistence = 0.5, seed = 1, stretchX = 1 } = opts;
  const out = new Float32Array(size * size);
  const rand = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const py = period * 2 ** o;
    const px = Math.max(1, Math.round(py / stretchX));
    const grid = new Float32Array(px * py);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * py;
      const y0 = Math.floor(gy), fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % py) * px, r1 = ((y0 + 1) % py) * px;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * px;
        const x0 = Math.floor(gx), fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const c0 = x0 % px, c1 = (x0 + 1) % px;
        const a = grid[r0 + c0]! + (grid[r0 + c1]! - grid[r0 + c0]!) * sx;
        const b = grid[r1 + c0]! + (grid[r1 + c1]! - grid[r1 + c0]!) * sx;
        out[y * size + x]! += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

/** Cria uma textura a partir de uma função que preenche os pixels RGBA (0–255). */
export function pixelTexture(scene: Scene, name: string, size: number, fill: (data: Uint8ClampedArray, size: number) => void, draw?: (ctx: CanvasRenderingContext2D, size: number) => void): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  fill(img.data, size);
  ctx.putImageData(img, 0, 0);
  draw?.(ctx, size);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** Mapa de normais (espaço tangente) a partir de um campo de altura periódico. */
export function normalTexture(scene: Scene, name: string, height: Float32Array, size: number, strength: number): DynamicTexture {
  return pixelTexture(scene, name, size, (d) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const h = (xx: number, yy: number) => height[((yy + size) % size) * size + ((xx + size) % size)]!;
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      d[i] = (-dx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  });
}

export const clamp255 = (v: number) => Math.max(0, Math.min(255, v));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
