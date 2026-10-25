/**
 * Configura a visualização orbital (planejamento e operações) a partir do plano e do perfil calculados pelo
 * motor. Cada missão vira uma ou mais "pernas" percorridas pela sonda:
 * - órbita terrestre: a órbita de estacionamento;
 * - Lua: transferência translunar (Terra e Lua em tamanho real) e chegada à órbita lunar, em escala própria
 *   centrada na Lua;
 * - Júpiter: cruzeiro heliocêntrico (transferência de Hohmann Terra → Júpiter, planetas ampliados) e, em
 *   seguida, aproximação e captura no sistema joviano.
 */
import { Color3, Vector3 } from '@babylonjs/core';
import type { MissionPlan } from '../../types/campaign';
import { AU, BODIES } from '../../engine/orbital-mechanics/orbits';
import type { MissionProfile } from '../../engine/rules/mission-profile';
import { arcPoints, ellipsePoints, type OrbitConfig, type OrbitSceneController } from '../../engine/scenes/otherScenes';

const GREEN = new Color3(0.36, 0.89, 0.54);
const AMBER = new Color3(0.95, 0.64, 0.23);
const GREY = new Color3(0.45, 0.55, 0.65);

export function orbitConfig(plan: MissionPlan, profile: MissionProfile, insertion: 'captured' | 'high-orbit' | 'flyby' | 'none' = 'captured', follow = false): OrbitConfig {
  if (plan.kind === 'earth-orbit') {
    const mpu = BODIES.earth.radius / 5;
    const a = BODIES.earth.radius + plan.altitudeKm * 1000;
    const parking = ellipsePoints(a, plan.eccentricity, mpu, 256, 0, profile.launchInclinationDeg);
    return {
      follow,
      legs: [{ label: 'Órbita terrestre', body: 'earth', bodyDiameter: 10, cameraRadius: 26, paths: [{ name: 'parking', points: parking, color: GREEN }], travel: parking }],
      loop: parking,
    };
  }
  if (plan.kind === 'lunar') {
    const mpu = 1e7;
    const moonDist = BODIES.moon.semiMajorAxisEarth ?? 384_400_000;
    const moonPos = new Vector3(moonDist / mpu, 0, 0);
    const rPark = BODIES.earth.radius + plan.parkingOrbitKm * 1000;
    const transferA = (rPark + moonDist) / 2;
    const transferE = (moonDist - rPark) / (moonDist + rPark);
    const transfer = ellipsePoints(transferA, transferE, mpu, 256, Math.PI).slice(0, 129).reverse();
    const flyby = insertion === 'flyby';
    // Chegada: novo trecho centrado na Lua, em escala própria, para a órbita lunar (de ~50 km) ficar visível
    const moonMpu = 4e5;
    const rLunar = BODIES.moon.radius + plan.lunarAltitudeKm * 1000;
    const lunarOrbit = ellipsePoints(rLunar, 0, moonMpu, 128, 0, plan.inclinationDeg);
    const rl = rLunar / moonMpu;
    const approach = arcPoints(new Vector3(-rl * 4.5, 0, rl * 3.2), new Vector3(rl, 0, 0), 3);
    const flyout = arcPoints(new Vector3(rl, 0, 0), new Vector3(rl * 2, 0, -rl * 5), -2);
    return {
      follow,
      legs: [
        {
          label: 'Transferência translunar', body: 'earth', bodyDiameter: (2 * BODIES.earth.radius) / mpu, cameraRadius: 60,
          secondary: [{ kind: 'moon', diameter: Math.max(0.5, (2 * BODIES.moon.radius) / mpu), position: moonPos }],
          paths: [
            { name: 'parking', points: ellipsePoints(rPark, 0, mpu, 64), color: GREY },
            { name: 'transfer', points: transfer, color: AMBER, dashed: true },
          ],
          travel: transfer,
        },
        {
          label: flyby ? 'Sobrevoo da Lua' : 'Inserção na órbita lunar', body: 'moon', bodyDiameter: (2 * BODIES.moon.radius) / moonMpu, cameraRadius: rl * 7,
          paths: [
            { name: 'approach', points: approach, color: AMBER, dashed: true },
            ...(flyby ? [{ name: 'flyby', points: flyout, color: new Color3(1, 0.37, 0.34) }] : [{ name: 'lunar', points: lunarOrbit, color: GREEN }]),
          ],
          travel: flyby ? [...approach, ...flyout] : approach,
        },
      ],
      loop: flyby ? undefined : lunarOrbit,
    };
  }
  // Júpiter
  const helioMpu = AU / 40;
  const rE = BODIES.earth.semiMajorAxisSun ?? AU;
  const rJ = BODIES.jupiter.semiMajorAxisSun ?? 5.2 * AU;
  const hohmann = ellipsePoints((rE + rJ) / 2, (rJ - rE) / (rJ + rE), helioMpu, 256, 0).slice(0, 129);
  const circle = (r: number) => ellipsePoints(r, 0, helioMpu, 180);
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
  const flyby = insertion === 'flyby';
  const jovianRadius = Math.min(400, (a * (1 + e)) / mpu * 1.3);
  return {
    follow,
    legs: [
      {
        label: 'Cruzeiro heliocêntrico Terra → Júpiter (planetas ampliados)', body: 'sun', bodyDiameter: 2.4, cameraRadius: 300,
        secondary: [
          { kind: 'earth', diameter: 1.4, position: hohmann[0]! },
          { kind: 'jupiter', diameter: 4, position: hohmann[hohmann.length - 1]! },
        ],
        paths: [
          { name: 'earth-orbit', points: circle(rE), color: GREY },
          { name: 'jupiter-orbit', points: circle(rJ), color: GREY },
          { name: 'hohmann', points: hohmann, color: AMBER, dashed: true },
        ],
        travel: hohmann,
      },
      {
        label: flyby ? 'Sobrevoo de Júpiter' : 'Aproximação e captura em Júpiter', body: 'jupiter', bodyDiameter: (2 * BODIES.jupiter.radius) / mpu, cameraRadius: jovianRadius,
        paths: [
          { name: 'approach', points: approach, color: AMBER, dashed: true },
          ...(flyby ? [{ name: 'flyby', points: flyout, color: new Color3(1, 0.37, 0.34) }] : [{ name: 'capture', points: orbit, color: GREEN }]),
        ],
        travel: flyby ? [...approach, ...flyout] : approach,
      },
    ],
    loop: flyby ? undefined : orbit,
  };
}

export function configureOrbitView(ctrl: OrbitSceneController, plan: MissionPlan, profile: MissionProfile, insertion: 'captured' | 'high-orbit' | 'flyby' | 'none' = 'captured', follow = false): void {
  ctrl.configure(orbitConfig(plan, profile, insertion, follow));
}
