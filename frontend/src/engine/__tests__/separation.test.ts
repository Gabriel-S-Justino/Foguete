import { describe, expect, it } from 'vitest';
import { altitudeOf, separate, stepDetached, type PadFrame, type Vec3 } from '../physics/debris';
import { atmosphere } from '../atmosphere/us76';

/**
 * Continuidade da separação de estágios: a peça solta parte exatamente do estado do veículo e segue a própria
 * trajetória (gravidade, arrasto e referencial girante), sem salto de posição nem queda por quadro.
 */
const frame: PadFrame = { mu: 3.986004418e14, radius: 6371000, rate: 7.2921159e-5 * Math.cos(28.5 * Math.PI / 180) };
const rho = (h: number) => atmosphere(Math.max(0, h)).densityKgM3;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Estado típico da separação do primeiro estágio (MECO): ~65 km de altitude, 2,2 km/s
const theta = 60000 / frame.radius;
const r = frame.radius + 65000;
const pos: Vec3 = { x: r * Math.sin(theta), y: r * Math.cos(theta) - frame.radius, z: 0 };
const vel: Vec3 = { x: 2100, y: 700, z: 0 };

describe('separação de estágios', () => {
  it('a peça começa exatamente na posição do veículo, com a velocidade do veículo mais a do mecanismo', () => {
    const push = { x: -0.3, y: 0, z: 0.4 };
    const b = separate(pos, vel, push, 2e-4);
    expect(dist(b.p, pos)).toBe(0);
    expect(b.v.x).toBeCloseTo(vel.x + push.x, 12);
    expect(b.v.y).toBeCloseTo(vel.y + push.y, 12);
    expect(b.v.z).toBeCloseTo(vel.z + push.z, 12);
    // A cópia é independente: mover o veículo depois não arrasta a peça
    const p2 = { ...pos };
    const b2 = separate(p2, vel, push, 2e-4);
    p2.x += 1000;
    expect(b2.p.x).toBe(pos.x);
  });

  it('não há salto nem queda por quadro: o deslocamento de cada quadro é |v|·dt', () => {
    const b = separate(pos, vel, { x: 0, y: -0.5, z: 0 }, 2e-4);
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      const before = { ...b.p };
      const v = Math.hypot(b.v.x, b.v.y, b.v.z);
      stepDetached(frame, b, dt, rho);
      const step = dist(before, b.p);
      // Gravidade e arrasto mudam a velocidade em no máximo alguns cm/s por quadro
      expect(Math.abs(step - v * dt)).toBeLessThan(0.05);
    }
  });

  it('peça e veículo (mesma física) se afastam devagar, só pela velocidade relativa da separação', () => {
    const vehicle = separate(pos, vel, { x: 0, y: 0, z: 0 }, 0);
    const piece = separate(pos, vel, { x: 0, y: -1, z: 0 }, 0);
    for (let k = 0; k < 10; k++) {
      stepDetached(frame, vehicle, 1, rho);
      stepDetached(frame, piece, 1, rho);
    }
    // 10 s depois: ~1 m/s × 10 s (a gravidade é a mesma para os dois)
    const d = dist(vehicle.p, piece.p);
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(11);
  });

  it('a gravidade curva a trajetória: a velocidade vertical cai ~9,6 m/s² na altitude de MECO', () => {
    const b = separate(pos, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    const frameNoRot = { ...frame, rate: 0 };
    stepDetached(frameNoRot, b, 2, rho);
    const g = frame.mu / r ** 2;
    const vr = (b.v.x * pos.x + b.v.y * (pos.y + frame.radius)) / r;
    expect(vr).toBeCloseTo(-g * 2, 1);
  });

  it('o arrasto freia a peça no ar denso e é desprezível acima da atmosfera', () => {
    const low: Vec3 = { x: 0, y: 10000, z: 0 };
    const v0: Vec3 = { x: 800, y: 0, z: 0 };
    const withDrag = separate(low, v0, { x: 0, y: 0, z: 0 }, 1e-3);
    const vacuum = separate(low, v0, { x: 0, y: 0, z: 0 }, 0);
    stepDetached(frame, withDrag, 5, rho);
    stepDetached(frame, vacuum, 5, rho);
    expect(Math.hypot(withDrag.v.x, withDrag.v.y)).toBeLessThan(Math.hypot(vacuum.v.x, vacuum.v.y) - 50);
    const high: Vec3 = { x: 0, y: 300000, z: 0 };
    const a = separate(high, v0, { x: 0, y: 0, z: 0 }, 1e-3);
    const b = separate(high, v0, { x: 0, y: 0, z: 0 }, 0);
    stepDetached(frame, a, 5, rho);
    stepDetached(frame, b, 5, rho);
    expect(dist(a.p, b.p)).toBeLessThan(0.01);
  });

  it('uma peça em velocidade orbital mantém a altitude (não "cai" do veículo)', () => {
    const frameNoRot = { ...frame, rate: 0 };
    const h = 200000;
    const vc = Math.sqrt(frame.mu / (frame.radius + h));
    const b = separate({ x: 0, y: h, z: 0 }, { x: vc, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    for (let k = 0; k < 600; k++) {
      const alt = stepDetached(frameNoRot, b, 1, rho);
      expect(Math.abs(alt - h)).toBeLessThan(50);
    }
    expect(altitudeOf(frameNoRot, b.p)).toBeGreaterThan(h - 50);
    expect(b.landed).toBe(false);
  });

  it('peça suborbital cai e para no solo', () => {
    const b = separate(pos, { x: 300, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 4e-4);
    let alt = altitudeOf(frame, b.p);
    for (let k = 0; k < 2000 && !b.landed; k++) alt = stepDetached(frame, b, 1, rho);
    expect(b.landed).toBe(true);
    expect(alt).toBeLessThanOrEqual(0);
  });
});
