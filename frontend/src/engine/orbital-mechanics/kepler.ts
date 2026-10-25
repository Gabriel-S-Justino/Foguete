/**
 * Propagação kepleriana (dois corpos) em 3D com variáveis universais, válida para órbitas elípticas e
 * hiperbólicas, e problema de Lambert (cônica que liga duas posições num tempo dado). Unidades SI.
 * Referência: H. Curtis, "Orbital Mechanics for Engineering Students", algoritmos 3.4 e 5.2.
 */

export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / (norm(a) || 1));
/** Gira o vetor em torno de um eixo unitário (regra da mão direita). */
export function rotate(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const k = unit(axis);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** Funções de Stumpff. */
export function stumpffC(z: number): number {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}
export function stumpffS(z: number): number {
  if (z > 1e-8) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-8) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

export interface State { r: V3; v: V3 }

/** Propaga o estado (r, v) por dt segundos no campo de um corpo de parâmetro gravitacional mu. */
export function propagate(mu: number, s: State, dt: number): State {
  if (dt === 0) return { r: [...s.r], v: [...s.v] };
  const r0 = norm(s.r), v0 = norm(s.v);
  const vr0 = dot(s.r, s.v) / r0;
  const alpha = 2 / r0 - (v0 * v0) / mu; // 1/a
  if (alpha > 1e-12) {
    // Elíptica: o estado se repete a cada período, então só a fração de órbita importa (Newton converge)
    const period = 2 * Math.PI * Math.sqrt(1 / (alpha * alpha * alpha * mu));
    dt %= period;
  }
  const sqmu = Math.sqrt(mu);
  // Chute inicial da anomalia universal
  let x = alpha > 1e-12 ? sqmu * Math.abs(alpha) * dt : sqmu * dt / r0;
  if (alpha < -1e-12) {
    // Hiperbólica: chute de Vallado
    const a = 1 / alpha;
    const sign = dt >= 0 ? 1 : -1;
    x = sign * Math.sqrt(-a) * Math.log((-2 * mu * alpha * dt) / (dot(s.r, s.v) + sign * Math.sqrt(-mu * a) * (1 - r0 * alpha)));
    if (!Number.isFinite(x)) x = sqmu * dt / r0;
  }
  for (let i = 0; i < 60; i++) {
    const z = alpha * x * x;
    const C = stumpffC(z), S = stumpffS(z);
    const F = ((r0 * vr0) / sqmu) * x * x * C + (1 - alpha * r0) * x * x * x * S + r0 * x - sqmu * dt;
    const dF = ((r0 * vr0) / sqmu) * x * (1 - alpha * x * x * S) + (1 - alpha * r0) * x * x * C + r0;
    const step = F / dF;
    x -= step;
    if (Math.abs(step) < 1e-9 * Math.max(1, Math.abs(x))) break;
  }
  const z = alpha * x * x;
  const C = stumpffC(z), S = stumpffS(z);
  const f = 1 - ((x * x) / r0) * C;
  const g = dt - (x * x * x * S) / sqmu;
  const r = add(scale(s.r, f), scale(s.v, g));
  const rn = norm(r);
  const fd = (sqmu / (rn * r0)) * (alpha * x * x * x * S - x);
  const gd = 1 - ((x * x) / rn) * C;
  return { r, v: add(scale(s.r, fd), scale(s.v, gd)) };
}

export interface Elements {
  /** Semieixo maior (m; negativo para hipérbole). */
  a: number;
  e: number;
  /** Inclinação, longitude do nodo, argumento do periapse e anomalia verdadeira (rad). */
  i: number; raan: number; argp: number; nu: number;
  /** Vetor momento angular específico (normal do plano da órbita). */
  h: V3;
  /** Periapse e apoapse (m; apoapse infinita se não for elíptica). */
  rp: number; ra: number;
  /** Período (s; infinito se não for elíptica). */
  period: number;
}

/** Elementos clássicos a partir do estado (referencial inercial com Z na direção do polo do plano de referência). */
export function elementsOf(mu: number, s: State): Elements {
  const r = norm(s.r), v = norm(s.v);
  const h = cross(s.r, s.v);
  const hn = norm(h);
  const evec = sub(scale(s.r, v * v / mu - 1 / r), scale(s.v, dot(s.r, s.v) / mu));
  const e = norm(evec);
  const energy = (v * v) / 2 - mu / r;
  const a = -mu / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hn)));
  const n: V3 = [-h[1], h[0], 0];
  const nn = norm(n);
  let raan = nn > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, n[0] / nn))) : 0;
  if (n[1] < 0) raan = 2 * Math.PI - raan;
  let argp = 0;
  if (e > 1e-10) {
    const ref: V3 = nn > 1e-12 ? n : [1, 0, 0];
    argp = Math.acos(Math.max(-1, Math.min(1, dot(ref, evec) / (norm(ref) * e))));
    if ((nn > 1e-12 ? evec[2] : cross(ref, evec)[2] * Math.sign(h[2] || 1)) < 0) argp = 2 * Math.PI - argp;
  }
  const refNu: V3 = e > 1e-10 ? evec : (nn > 1e-12 ? n : [1, 0, 0]);
  let nu = Math.acos(Math.max(-1, Math.min(1, dot(refNu, s.r) / (norm(refNu) * r))));
  if (dot(cross(refNu, s.r), h) < 0) nu = 2 * Math.PI - nu;
  const rp = hn * hn / mu / (1 + e);
  const ra = e < 1 ? a * (1 + e) : Infinity;
  const period = e < 1 ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity;
  return { a, e, i, raan, argp, nu, h, rp, ra, period };
}

/**
 * Problema de Lambert (variáveis universais): velocidades nas extremidades da cônica que vai de r1 a r2 em
 * tof segundos, no sentido prógrado (em torno de +Z) ou retrógrado. Lança erro se não convergir.
 */
export function lambert(mu: number, r1: V3, r2: V3, tof: number, prograde = true): { v1: V3; v2: V3 } {
  const n1 = norm(r1), n2 = norm(r2);
  const c12 = cross(r1, r2);
  let dtheta = Math.acos(Math.max(-1, Math.min(1, dot(r1, r2) / (n1 * n2))));
  if (prograde ? c12[2] < 0 : c12[2] >= 0) dtheta = 2 * Math.PI - dtheta;
  const A = Math.sin(dtheta) * Math.sqrt((n1 * n2) / (1 - Math.cos(dtheta)));
  if (!Number.isFinite(A) || Math.abs(A) < 1e-12) throw new Error('Lambert: geometria degenerada (posições colineares)');
  const y = (z: number) => n1 + n2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
  const F = (z: number) => (y(z) / stumpffC(z)) ** 1.5 * stumpffS(z) + A * Math.sqrt(y(z)) - Math.sqrt(mu) * tof;
  // Começa onde y > 0 e procura a raiz de F por bissecção + secante (robusto para transferências longas)
  let lo = -4 * Math.PI * Math.PI, hi = 4 * Math.PI * Math.PI - 1e-6;
  while (y(lo) < 0 && lo < hi) lo += 0.1;
  let flo = F(lo), fhi = F(hi);
  if (!(flo < 0 && fhi > 0)) throw new Error('Lambert: tempo de voo fora do intervalo de uma revolução');
  let z = 0;
  for (let i = 0; i < 200; i++) {
    z = (lo + hi) / 2;
    const fz = F(z);
    if (Math.abs(fz) < 1e-9 * Math.sqrt(mu) * tof) break;
    if (fz < 0) { lo = z; flo = fz; } else { hi = z; fhi = fz; }
    if (hi - lo < 1e-12) break;
  }
  void flo; void fhi;
  const yz = y(z);
  const f = 1 - yz / n1;
  const g = A * Math.sqrt(yz / mu);
  const gd = 1 - yz / n2;
  const v1 = scale(sub(r2, scale(r1, f)), 1 / g);
  const v2 = scale(sub(scale(r2, gd), r1), 1 / g);
  return { v1, v2 };
}

/** Ângulo (rad, 0..2π) que a posição percorreu de a até b no sentido do momento angular h. */
export function sweptAngle(a: V3, b: V3, h: V3): number {
  let ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b)))));
  if (dot(cross(a, b), h) < 0) ang = 2 * Math.PI - ang;
  return ang;
}
