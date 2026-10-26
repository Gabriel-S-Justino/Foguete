/**
 * Gera public/data/stars/bsc5.bin a partir do Yale Bright Star Catalog, 5ª edição (Hoffleit & Warren 1991,
 * dados públicos do Yale University Observatory / CDS), na conversão JSON de Bretton Wade (licença MIT):
 * https://github.com/brettonw/YaleBrightStarCatalog (arquivo bsc5-short.json).
 *
 * Formato de saída (Float32, little-endian), 5 valores por estrela:
 *   x, y, z  direção unitária no equador J2000 (z para o polo norte celeste)
 *   V        magnitude visual aparente
 *   K        temperatura de cor estimada (K), calculada pelo conversor a partir do tipo espectral
 * Uso: node scripts/build-starfield.mjs caminho/para/bsc5-short.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('uso: node scripts/build-starfield.mjs bsc5-short.json'); process.exit(1); }
const stars = JSON.parse(readFileSync(src, 'utf8'));
const ra = (s) => { const m = /(\d+)h\s+(\d+)m\s+([\d.]+)s/.exec(s); return ((+m[1] + +m[2] / 60 + +m[3] / 3600) * 15 * Math.PI) / 180; };
const dec = (s) => {
  const m = /([+-])(\d+)°\s+(\d+)′\s+(\d+)″/.exec(s);
  return ((m[1] === '-' ? -1 : 1) * (+m[2] + +m[3] / 60 + +m[4] / 3600) * Math.PI) / 180;
};
const rows = [];
for (const s of stars) {
  if (!s.RA || !s.Dec || s.V === undefined) continue;
  const a = ra(s.RA), d = dec(s.Dec);
  rows.push([Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d), Number(s.V), Number(s.K ?? 5800)]);
}
// Mais brilhantes primeiro (permite cortar por magnitude limite sem reordenar)
rows.sort((p, q) => p[3] - q[3]);
const buf = new Float32Array(rows.flat());
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'stars', 'bsc5.bin');
writeFileSync(out, Buffer.from(buf.buffer));
console.log(`${rows.length} estrelas, V de ${rows[0][3]} a ${rows[rows.length - 1][3]} → ${out} (${buf.byteLength} bytes)`);
