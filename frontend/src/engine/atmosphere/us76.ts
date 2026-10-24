/**
 * Atmosfera Padrão dos EUA 1976 (0–86 km geopotencial) por camadas com gradiente térmico linear,
 * seguida de decaimento exponencial aproximado acima de 86 km (modelo aproximado documentado).
 */
const R_AIR = 287.05287; // J/(kg·K)
const G0 = 9.80665;
const R_EARTH = 6356766; // raio usado na altitude geopotencial (US76)

interface Layer { hBase: number; tBase: number; lapse: number; pBase: number }
const LAYERS: Layer[] = [
  { hBase: 0, tBase: 288.15, lapse: -0.0065, pBase: 101325 },
  { hBase: 11000, tBase: 216.65, lapse: 0, pBase: 22632.06 },
  { hBase: 20000, tBase: 216.65, lapse: 0.001, pBase: 5474.889 },
  { hBase: 32000, tBase: 228.65, lapse: 0.0028, pBase: 868.0187 },
  { hBase: 47000, tBase: 270.65, lapse: 0, pBase: 110.9063 },
  { hBase: 51000, tBase: 270.65, lapse: -0.0028, pBase: 66.93887 },
  { hBase: 71000, tBase: 214.65, lapse: -0.002, pBase: 3.956420 },
];

/** [altitude base km, densidade base kg/m³, altura de escala km] — tabela exponencial clássica (Vallado). */
const EXP_TABLE: [number, number, number][] = [
  [86, 6.958e-6, 5.38], [90, 3.396e-6, 5.382], [100, 5.297e-7, 5.877], [110, 9.661e-8, 7.263],
  [120, 2.438e-8, 9.473], [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149], [150, 2.07e-9, 22.523],
  [180, 5.464e-10, 29.74], [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628],
  [350, 9.518e-12, 53.298], [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822],
  [600, 1.454e-13, 71.835], [700, 3.614e-14, 88.667], [800, 1.17e-14, 124.64], [900, 5.245e-15, 181.05],
  [1000, 3.019e-15, 268],
];

export interface AtmosphereState { temperatureK: number; pressurePa: number; densityKgM3: number }

export function atmosphere(geometricAltitudeM: number): AtmosphereState {
  const z = Math.max(0, geometricAltitudeM);
  const h = (R_EARTH * z) / (R_EARTH + z);
  if (h > 84852) {
    // Acima de ~86 km: modelo exponencial por faixas (aproximação; ver docs/physics-model.md)
    let row = EXP_TABLE[0]!;
    for (const r of EXP_TABLE) if (z >= r[0] * 1000) row = r;
    const rho = row[1] * Math.exp(-(z - row[0] * 1000) / (row[2] * 1000));
    return { temperatureK: 186.87, pressurePa: rho * R_AIR * 186.87, densityKgM3: rho };
  }
  let layer = LAYERS[0]!;
  for (const l of LAYERS) if (h >= l.hBase) layer = l;
  const dh = h - layer.hBase;
  const t = layer.tBase + layer.lapse * dh;
  const p = layer.lapse === 0
    ? layer.pBase * Math.exp((-G0 * dh) / (R_AIR * layer.tBase))
    : layer.pBase * Math.pow(layer.tBase / t, G0 / (R_AIR * layer.lapse));
  return { temperatureK: t, pressurePa: p, densityKgM3: p / (R_AIR * t) };
}
