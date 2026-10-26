/**
 * Amostragem das curvas só para o desenho. Os pontos são sempre posições exatas da solução física (Kepler):
 * a amostragem escolhe ONDE avaliar a curva, nunca altera a curva. A simulação continua usando stateAt().
 *
 * Por que a amostragem uniforme no tempo serrilhava: numa órbita excêntrica ou numa hipérbole a sonda passa
 * pelo periapse muito depressa, e com N pontos igualmente espaçados no tempo a curva vira um "bico" ali
 * (na captura em Júpiter, com período de 53 dias e perijove a 4.200 km, o perijove ficava entre 2 pontos).
 * Aqui o intervalo é subdividido até que o ângulo entre cordas consecutivas fique abaixo da tolerância
 * (padrão 0,35°), o que mantém a curva lisa com o mínimo de pontos onde ela é quase reta.
 */
import { propagate, type State, type V3 } from './kepler';

export interface CurveSample { t: number; r: V3 }

export interface AdaptiveOptions {
  /** Ângulo máximo (rad) entre cordas consecutivas. */
  maxTurnRad?: number;
  /** Subdivisões iniciais uniformes (garante que voltas inteiras não sejam puladas). */
  initial?: number;
  /** Limite de pontos (proteção). */
  maxPoints?: number;
}

const angleBetween = (a: V3, b: V3): number => {
  const la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2]);
  if (la === 0 || lb === 0) return 0;
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, c)));
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Amostra adaptativa de uma curva r(t) em [t0, t1]: cada intervalo é dividido ao meio enquanto o ponto médio
 * desvia a direção da corda mais que a tolerância. Devolve os instantes e as posições exatas.
 */
export function adaptiveSamples(f: (t: number) => V3, t0: number, t1: number, opts: AdaptiveOptions = {}): CurveSample[] {
  const tol = opts.maxTurnRad ?? (0.35 * Math.PI) / 180;
  const initial = Math.max(2, opts.initial ?? 64);
  const maxPoints = opts.maxPoints ?? 6000;
  const out: CurveSample[] = [];
  let count = 0;
  const refine = (ta: number, ra: V3, tb: number, rb: V3, depth: number) => {
    const tm = (ta + tb) / 2;
    const rm = f(tm);
    const turn = angleBetween(sub(rm, ra), sub(rb, rm));
    if (depth < 22 && turn > tol && count < maxPoints) {
      refine(ta, ra, tm, rm, depth + 1);
      refine(tm, rm, tb, rb, depth + 1);
    } else {
      out.push({ t: tm, r: rm }, { t: tb, r: rb });
      count += 2;
    }
  };
  let ta = t0, ra = f(t0);
  out.push({ t: ta, r: ra });
  for (let i = 1; i <= initial; i++) {
    const tb = t0 + ((t1 - t0) * i) / initial;
    const rb = f(tb);
    refine(ta, ra, tb, rb, 0);
    ta = tb; ra = rb;
  }
  return out;
}

/** Cônica a partir do estado s0 (relativo ao centro), de t0 a t1 (s). */
export function conicSamples(mu: number, s0: State, t0: number, t1: number, opts?: AdaptiveOptions): CurveSample[] {
  return adaptiveSamples((t) => propagate(mu, s0, t - t0).r, t0, t1, opts);
}

/** Maior ângulo entre cordas consecutivas de uma polilinha (rad): mede o "bico" visível. */
export function maxTurnAngle(points: V3[]): number {
  let m = 0;
  for (let i = 1; i + 1 < points.length; i++) m = Math.max(m, angleBetween(sub(points[i]!, points[i - 1]!), sub(points[i + 1]!, points[i]!)));
  return m;
}

/**
 * Laço fechado ancorado no ponto atual: amostra uma volta inteira começando exatamente na posição do corpo
 * agora (o corpo fica sobre um vértice, sem o erro de corda que o deixava "fora" da própria órbita com zoom).
 */
export function anchoredLoop(f: (t: number) => V3, tNow: number, period: number, n: number): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) pts.push(f(tNow + (period * i) / n));
  return pts;
}
