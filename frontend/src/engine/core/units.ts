/**
 * Conversões de unidades. O motor trabalha internamente em SI (m, s, kg, N, W).
 * Toda entrada em km, horas, dias ou anos deve passar por estas funções.
 */
export const KM = 1000;
export const HOUR = 3600;
export const DAY = 86400;
export const JULIAN_YEAR = 365.25 * DAY;
export const DEG = Math.PI / 180;

export const kmToM = (km: number): number => km * KM;
export const mToKm = (m: number): number => m / KM;
export const daysToS = (d: number): number => d * DAY;
export const sToDays = (s: number): number => s / DAY;
export const hoursToS = (h: number): number => h * HOUR;
export const yearsToS = (y: number): number => y * JULIAN_YEAR;
export const degToRad = (d: number): number => d * DEG;
export const radToDeg = (r: number): number => r / DEG;
export const kNToN = (kn: number): number => kn * 1000;
/** C3 em km²/s² -> velocidade hiperbólica em excesso v∞ em m/s. */
export const c3ToVinf = (c3KmS2: number): number => Math.sqrt(Math.max(0, c3KmS2)) * KM;
export const vinfToC3 = (vinfMS: number): number => (vinfMS / KM) ** 2;
export const gbToBits = (gb: number): number => gb * 8e9;
