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
