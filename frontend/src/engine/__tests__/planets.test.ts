import { Vector3 } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import { siteOrientation } from '../scenes/planets';

/** Mesma convenção do shader: lat/lon → vetor no referencial do planeta (y = norte). */
const surface = (latDeg: number, lonDeg: number) => {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
};

describe('orientação da textura da Terra na base de lançamento', () => {
  const m = siteOrientation(28.5, -80.6);
  it('o topo da esfera (+Y) aponta para o Cabo Canaveral', () => {
    const up = Vector3.TransformNormal(new Vector3(0, 1, 0), m);
    expect(Vector3.Distance(up, surface(28.5, -80.6))).toBeLessThan(1e-6);
  });
  it('+X aponta para leste e +Z para o norte', () => {
    const east = Vector3.TransformNormal(new Vector3(1, 0, 0), m);
    const north = Vector3.TransformNormal(new Vector3(0, 0, 1), m);
    // Um pequeno passo para leste aumenta a longitude; para o norte, a latitude
    expect(Vector3.Distance(surface(28.5, -80.6).add(east.scale(1e-4)), surface(28.5, -80.6 + (1e-4 * 180) / Math.PI / Math.cos((28.5 * Math.PI) / 180)))).toBeLessThan(1e-7);
    expect(Vector3.Distance(surface(28.5, -80.6).add(north.scale(1e-4)), surface(28.5 + (1e-4 * 180) / Math.PI, -80.6))).toBeLessThan(1e-7);
  });
  // Matrix do Babylon guarda Float32: tolerância de 1e-6
  it('é uma rotação própria (ortonormal, determinante +1)', () => {
    expect(m.determinant()).toBeCloseTo(1, 6);
  });
});
