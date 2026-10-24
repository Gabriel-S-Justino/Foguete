/** Configura a visualização orbital (planejamento e operações) a partir do plano e do perfil calculados pelo motor. */
import { Color3, Vector3 } from '@babylonjs/core';
import type { MissionPlan } from '../../types/campaign';
import { BODIES } from '../../engine/orbital-mechanics/orbits';
import type { MissionProfile } from '../../engine/rules/mission-profile';
import { arcPoints, ellipsePoints, type OrbitSceneController } from '../../engine/scenes/otherScenes';

export function configureOrbitView(ctrl: OrbitSceneController, plan: MissionPlan, profile: MissionProfile, insertion: 'captured' | 'high-orbit' | 'flyby' | 'none' = 'captured'): void {
  if (plan.kind === 'earth-orbit') {
    const mpu = BODIES.earth.radius / 5;
    const a = BODIES.earth.radius + plan.altitudeKm * 1000;
    const inc = profile.launchInclinationDeg;
    ctrl.configure({
      body: 'earth', bodyDiameter: 10, cameraRadius: 26,
      paths: [
        { name: 'parking', points: ellipsePoints(a, plan.eccentricity, mpu, 256, 0, inc), color: new Color3(0.36, 0.89, 0.54) },
      ],
    });
    return;
  }
  if (plan.kind === 'lunar') {
    const mpu = 1e7;
    const moonDist = BODIES.moon.semiMajorAxisEarth ?? 384_400_000;
    const moonPos = new Vector3(moonDist / mpu, 0, 0);
    const rPark = BODIES.earth.radius + plan.parkingOrbitKm * 1000;
    const transferA = (rPark + moonDist) / 2;
    const transferE = (moonDist - rPark) / (moonDist + rPark);
    const transfer = ellipsePoints(transferA, transferE, mpu, 256, Math.PI).slice(0, 129).reverse();
    const lunarOrbit = ellipsePoints(BODIES.moon.radius + plan.lunarAltitudeKm * 1000, 0, mpu, 96, 0, plan.inclinationDeg).map((p) => p.add(moonPos));
    ctrl.configure({
      body: 'earth', bodyDiameter: (2 * BODIES.earth.radius) / mpu, cameraRadius: 60,
      secondary: [{ kind: 'moon', diameter: Math.max(0.5, (2 * BODIES.moon.radius) / mpu), position: moonPos }],
      paths: [
        { name: 'parking', points: ellipsePoints(rPark, 0, mpu, 64), color: new Color3(0.5, 0.6, 0.7) },
        { name: 'transfer', points: transfer, color: new Color3(0.95, 0.64, 0.23), dashed: true },
        ...(insertion === 'flyby' ? [] : [{ name: 'lunar', points: lunarOrbit, color: new Color3(0.36, 0.89, 0.54) }]),
      ],
      markerPath: [...transfer, ...(insertion === 'flyby' ? [] : lunarOrbit)],
    });
    return;
  }
  // Júpiter: cruzeiro heliocêntrico ilustrativo + órbita de captura jovicêntrica (escala separada)
  const cap = profile.capture;
  const mpu = 4e7;
  const rp = cap?.rp ?? BODIES.jupiter.radius * 1.1;
  let a = cap?.a ?? rp * 10;
  if (insertion === 'high-orbit') a *= 2.5;
  const e = Math.min(0.995, 1 - rp / a);
  const orbit = ellipsePoints(a, e, mpu, 512, 0, plan.inclinationDeg);
  const approachStart = new Vector3(-(a * (1 + e)) / mpu * 0.6, 0, (a * (1 + e)) / mpu * 0.9);
  const approach = arcPoints(approachStart, new Vector3(rp / mpu, 0, 0), 4);
  const flyout = arcPoints(new Vector3(rp / mpu, 0, 0), new Vector3((a * (1 + e)) / mpu * 0.3, 0, -(a * (1 + e)) / mpu), -3);
  ctrl.configure({
    body: 'jupiter', bodyDiameter: (2 * BODIES.jupiter.radius) / mpu, cameraRadius: Math.min(400, (a * (1 + e)) / mpu * 1.3),
    paths: [
      { name: 'approach', points: approach, color: new Color3(0.95, 0.64, 0.23), dashed: true },
      ...(insertion === 'flyby'
        ? [{ name: 'flyby', points: flyout, color: new Color3(1, 0.37, 0.34) }]
        : [{ name: 'capture', points: orbit, color: new Color3(0.36, 0.89, 0.54) }]),
    ],
    markerPath: insertion === 'flyby' ? [...approach, ...flyout] : [...approach, ...orbit],
  });
}
