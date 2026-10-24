/** Integrador Runge–Kutta de 4ª ordem com passo fixo, desacoplado da taxa de quadros. */
export type Derivative = (t: number, y: Float64Array) => Float64Array;

export function rk4Step(f: Derivative, t: number, y: Float64Array, dt: number): Float64Array {
  const n = y.length;
  const tmp = new Float64Array(n);
  const k1 = f(t, y);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + (dt / 2) * k1[i]!;
  const k2 = f(t + dt / 2, tmp);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + (dt / 2) * k2[i]!;
  const k3 = f(t + dt / 2, tmp);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + dt * k3[i]!;
  const k4 = f(t + dt, tmp);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = y[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  return out;
}

export interface PointMass { mu: number; position: (t: number) => [number, number, number] }

/**
 * Aceleração gravitacional de N corpos sobre uma partícula (estado 3D [x,y,z,vx,vy,vz]).
 * O primeiro corpo é tratado como origem do referencial; corpos adicionais entram como
 * perturbações de terceiro corpo (termo direto + indireto).
 */
export function nBodyDerivative(central: number, perturbers: PointMass[] = []): Derivative {
  return (t, y) => {
    const [x, yy, z, vx, vy, vz] = y as unknown as [number, number, number, number, number, number];
    const r3 = Math.hypot(x, yy, z) ** 3;
    let ax = (-central * x) / r3;
    let ay = (-central * yy) / r3;
    let az = (-central * z) / r3;
    for (const p of perturbers) {
      const [px, py, pz] = p.position(t);
      const dx = px - x, dy = py - yy, dz = pz - z;
      const d3 = Math.hypot(dx, dy, dz) ** 3;
      const p3 = Math.hypot(px, py, pz) ** 3;
      ax += p.mu * (dx / d3 - px / p3);
      ay += p.mu * (dy / d3 - py / p3);
      az += p.mu * (dz / d3 - pz / p3);
    }
    return Float64Array.of(vx, vy, vz, ax, ay, az);
  };
}

/** Propaga um estado 3D e devolve amostras [t, x, y, z]. */
export function propagate(f: Derivative, y0: Float64Array, durationS: number, dt: number, sampleEvery = 1): number[][] {
  const out: number[][] = [];
  let y = y0;
  let t = 0;
  let i = 0;
  const steps = Math.ceil(durationS / dt);
  for (; i <= steps; i++) {
    if (i % sampleEvery === 0) out.push([t, y[0]!, y[1]!, y[2]!]);
    y = rk4Step(f, t, y, dt);
    t += dt;
  }
  return out;
}

/** Estado inicial no periapse de uma órbita kepleriana inclinada (nodo ascendente no eixo x). */
export function stateAtPeriapsis(mu: number, rp: number, a: number, inclinationDeg: number): Float64Array {
  const vp = Math.sqrt(mu * (2 / rp - 1 / a));
  const inc = (inclinationDeg * Math.PI) / 180;
  return Float64Array.of(rp, 0, 0, 0, vp * Math.cos(inc), vp * Math.sin(inc));
}
