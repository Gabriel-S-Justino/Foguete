import { describe, expect, it } from 'vitest';
import { launchVehicles } from '../catalog';
import { AscentSimulator } from '../physics/ascent';

describe('ascensão', () => {
  for (const v of launchVehicles.vehicles) {
    it(`${v.id} atinge órbita de estacionamento com 2 t de carga útil`, () => {
      const sim = new AscentSimulator({ vehicle: v, payloadKg: 2000, targetAltitudeKm: 200, inclinationDeg: 28.5, dt: 0.05, dragCoefficient: 0.3 });
      const tel = sim.runToCompletion();
      console.log(v.id, tel.phase, tel.t.toFixed(0), tel.periapsisKm.toFixed(0), tel.apoapsisKm.toFixed(0), sim.events.map((e) => e.id).join(','));
      expect(tel.phase).toBe('orbit');
      expect(tel.periapsisKm).toBeGreaterThan(150);
    });
  }
});

describe('alcance sobre a superfície (visual da decolagem)', () => {
  const f9 = launchVehicles.vehicles.find((v) => v.id === 'falcon-9')!;
  for (const inc of [28.5, 51.6, 98.2]) {
    it(`sobe na vertical primeiro e depois avança para a frente (inclinação ${inc}°)`, () => {
      const sim = new AscentSimulator({ vehicle: f9, payloadKg: 2000, targetAltitudeKm: 200, inclinationDeg: inc, dt: 0.05, dragCoefficient: 0.3 });
      sim.ignite();
      let tel = sim.telemetry();
      let at1km: number | null = null;
      let last = 0;
      let monotonic = true;
      while (!sim.isFinished && sim.t < 600) {
        tel = sim.step();
        if (at1km === null && tel.altitudeM > 1000) at1km = tel.downrangeM;
        if (tel.downrangeM < last - 1) monotonic = false;
        last = tel.downrangeM;
      }
      // Antes o ângulo inercial incluía o movimento da plataforma: ~400 m/s "de lado" para leste ou alcance negativo
      expect(Math.abs(at1km!)).toBeLessThan(150);
      expect(monotonic).toBe(true);
      expect(tel.downrangeM).toBeGreaterThan(300000);
    });
  }
});

describe('inserção em órbitas altas', () => {
  const f9 = launchVehicles.vehicles.find((v) => v.id === 'falcon-9')!;
  it('heliossíncrona de 700 km: SECO-1, voo balístico até a apoapse e circularização (sem passar do ponto)', () => {
    const sim = new AscentSimulator({ vehicle: f9, payloadKg: 1500, targetAltitudeKm: 700, inclinationDeg: 98.2, dt: 0.05, dragCoefficient: 0.3 });
    const tel = sim.runToCompletion();
    expect(tel.phase).toBe('orbit');
    expect(tel.periapsisKm).toBeGreaterThan(640);
    expect(tel.apoapsisKm).toBeLessThan(760);
    const ids = sim.events.map((e) => e.id);
    expect(ids).toContain('seco-1');
    expect(ids).toContain('reignition');
  });
  it('órbita de 200 km continua com inserção direta', () => {
    const sim = new AscentSimulator({ vehicle: f9, payloadKg: 1500, targetAltitudeKm: 200, inclinationDeg: 28.5, dt: 0.05, dragCoefficient: 0.3 });
    const tel = sim.runToCompletion();
    expect(tel.apoapsisKm).toBeLessThan(260);
    expect(sim.events.map((e) => e.id)).not.toContain('seco-1');
  });
});
