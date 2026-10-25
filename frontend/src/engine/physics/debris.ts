/**
 * Dinâmica de corpos soltos durante a subida (estágios, propulsores laterais, metades da coifa e destroços).
 *
 * O referencial é o da plataforma: origem na base de lançamento, +Y no vertical local, +X no sentido do
 * alcance (plano da trajetória) e a Terra com o centro em (0, −R, 0). Esse referencial gira com a Terra
 * (componente ω·cos i no plano da órbita), então além da gravidade central entram as acelerações de
 * Coriolis e centrífuga, como na simulação de subida. O arrasto usa a densidade do ar na altitude da peça.
 *
 * Funções puras (sem Babylon): a cena só copia a posição calculada para o nó 3D.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface PadFrame {
  /** Parâmetro gravitacional da Terra (m³/s²). */
  mu: number;
  /** Raio da Terra (m), o mesmo da simulação de subida. */
  radius: number;
  /** Rotação do referencial da plataforma no plano da trajetória (rad/s), ω·cos i. */
  rate: number;
}

export interface DetachedBody {
  /** Posição e velocidade no referencial da plataforma (m, m/s). */
  p: Vec3;
  v: Vec3;
  /** Coeficiente de arrasto efetivo (1/m): Cd·A/(2m). */
  drag: number;
  /** Já tocou o solo (ou saiu do alcance da cena)? */
  landed: boolean;
}

const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** Altitude (m) de um ponto do referencial da plataforma. */
export function altitudeOf(frame: PadFrame, p: Vec3): number {
  return Math.hypot(p.x, p.y + frame.radius, p.z) - frame.radius;
}

/**
 * Aceleração no referencial da plataforma: gravidade central + centrífuga + Coriolis (rotação em torno de Z).
 * Escreve em `out` e devolve a altitude.
 */
export function padAcceleration(frame: PadFrame, p: Vec3, v: Vec3, out: Vec3): number {
  const cx = p.x, cy = p.y + frame.radius, cz = p.z;
  const r = Math.hypot(cx, cy, cz);
  const g = -frame.mu / (r * r * r);
  const w = frame.rate;
  out.x = g * cx + w * w * cx - 2 * w * v.y;
  out.y = g * cy + w * w * cy + 2 * w * v.x;
  out.z = g * cz;
  return r - frame.radius;
}

/**
 * Peça que se solta do veículo: começa exatamente na posição e com a velocidade que o veículo tinha no
 * instante da separação, somada à velocidade relativa do mecanismo (molas, retrofoguetes ou o empuxo
 * residual), que é pequena (de 0,5 a alguns m/s).
 */
export function separate(position: Vec3, vehicleVelocity: Vec3, relativeVelocity: Vec3, drag: number): DetachedBody {
  return {
    p: vec(position.x, position.y, position.z),
    v: vec(vehicleVelocity.x + relativeVelocity.x, vehicleVelocity.y + relativeVelocity.y, vehicleVelocity.z + relativeVelocity.z),
    drag,
    landed: false,
  };
}

/**
 * Avança a peça por dt segundos de tempo simulado (subpassos de até 0,5 s, leapfrog kick-drift-kick).
 * O esquema simétrico mantém a órbita fechada: um Euler semi-implícito com o mesmo passo começa com meio passo
 * de gravidade a mais na velocidade e faz a altitude de uma órbita circular oscilar ~2 km.
 * `density(h)` dá a densidade do ar (kg/m³) na altitude h. Devolve a altitude final.
 */
export function stepDetached(frame: PadFrame, body: DetachedBody, dt: number, density: (h: number) => number): number {
  if (body.landed || dt <= 0) return altitudeOf(frame, body.p);
  const n = Math.max(1, Math.ceil(dt / 0.5));
  const h = dt / n;
  const a = vec();
  let alt = altitudeOf(frame, body.p);
  // Meio impulso: gravidade/inércia e arrasto quadrático a = −(Cd·A/2m)·ρ·|v|·v (implícito no módulo para não inverter o sentido)
  const kick = (half: number) => {
    alt = padAcceleration(frame, body.p, body.v, a);
    const rho = alt > 0 ? density(alt) : density(0);
    const speed = Math.hypot(body.v.x, body.v.y, body.v.z);
    const k = 1 / (1 + body.drag * rho * speed * half);
    body.v.x = (body.v.x + a.x * half) * k;
    body.v.y = (body.v.y + a.y * half) * k;
    body.v.z = (body.v.z + a.z * half) * k;
  };
  for (let i = 0; i < n; i++) {
    kick(h / 2);
    body.p.x += body.v.x * h;
    body.p.y += body.v.y * h;
    body.p.z += body.v.z * h;
    kick(h / 2);
    alt = altitudeOf(frame, body.p);
    if (alt <= 0) { body.landed = true; break; }
  }
  return alt;
}
