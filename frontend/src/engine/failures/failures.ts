/**
 * Sistema de falhas: probabilidades transparentes, derivadas de parâmetros configurados e das decisões do jogador.
 * Usa gerador determinístico por campanha (mesma semente => mesmos eventos), para permitir aprendizado.
 */
import type { FailureEventSpec, MissionSpec } from '../../types/catalog';
import type { SpacecraftConfig } from '../../types/campaign';
import { missions, simulationConfig } from '../catalog';
import { createRng, hashSeed } from '../core/rng';
import type { SpacecraftSummary } from '../entities/spacecraft';

export interface FailureContext {
  mission: MissionSpec;
  config: SpacecraftConfig;
  summary: SpacecraftSummary;
  vehicleId: string;
  weatherAdverse?: boolean;
  vibrationG?: number;
}

/** Fator por veículo (didático): veículos com menos histórico operacional recebem fator maior. */
const VEHICLE_FACTOR: Record<string, number> = {
  'falcon-9': 0.6, 'falcon-heavy': 1.0, soyuz: 0.8, 'new-glenn': 1.6, starship: 2.5, sls: 1.4,
};

export interface FailureProbability { spec: FailureEventSpec; probability: number; factors: { name: string; value: number }[] }

export function failureProbability(spec: FailureEventSpec, ctx: FailureContext): FailureProbability {
  const factors: { name: string; value: number }[] = [];
  let p = spec.baseProbability;
  for (const f of spec.factors) {
    let v = 1;
    if (f === 'tests') v = missions.testCampaigns[ctx.config.testCampaign].failureFactor;
    if (f === 'vehicle') v = VEHICLE_FACTOR[ctx.vehicleId] ?? 1;
    if (f === 'weather') v = ctx.weatherAdverse ? 2 : 1;
    if (f === 'vibration') v = (ctx.vibrationG ?? 3) > 5 ? 3 : (ctx.vibrationG ?? 3) > 3 ? 1.5 : 1;
    if (f === 'radiation') {
      const worst = ctx.summary.radiation.reduce((m, r) => Math.max(m, r.ratio), 0);
      v = worst > 1 ? 1 + worst : 1 + worst * 0.5;
    }
    if (f === 'solar') v = ctx.mission.environment.solarActivity === 'alta' ? 2 : 1;
    if (f === 'leo') v = ctx.mission.environment.centralBody === 'earth' ? 1 : 0;
    if (f === 'thermal') {
      const hot = ctx.summary.thermalDissipationW > 400 && !ctx.summary.capabilities.has('thermal-rejection') && ctx.mission.environment.sunDistanceAU < 2;
      v = hot ? 1 : 0;
      if (hot) p = Math.max(p, 0.35);
    }
    factors.push({ name: f, value: v });
    p *= v;
  }
  return { spec, probability: Math.min(0.95, p), factors };
}

export function eventsForPhase(phase: FailureEventSpec['phase']): FailureEventSpec[] {
  return simulationConfig.failures.filter((f) => f.phase === phase);
}

/** Sorteia os eventos de uma fase. Retorna os eventos ocorridos (com a probabilidade usada). */
export function rollPhase(phase: FailureEventSpec['phase'], ctx: FailureContext, seed: number, attempt: number, salt = ''): FailureProbability[] {
  const rng = createRng(hashSeed(seed, attempt, phase, salt));
  const happened: FailureProbability[] = [];
  for (const spec of eventsForPhase(phase)) {
    const fp = failureProbability(spec, ctx);
    if (rng() < fp.probability) happened.push(fp);
  }
  return happened;
}

export function vibrationClass(g: number): string {
  return simulationConfig.vibration.classes.find((c) => g <= c.max)?.label ?? 'Vibração crítica';
}

/** Vibração didática (g RMS) por fase de voo, escalada pela pressão dinâmica e por eventos. */
export function vibrationLevel(phase: string, dynamicPressurePa: number, accelerationG: number, weatherAdverse: boolean): number {
  const base = simulationConfig.vibration.phaseBaseG;
  let g = base.coast ?? 0.01;
  if (phase === 'prelaunch') g = base.pad ?? 0.02;
  else if (phase === 'ignition') g = base.ignition ?? 2;
  else if (phase === 'liftoff') g = base.liftoff ?? 3.4;
  else if (phase === 'staging') g = base.staging ?? 4.2;
  else if (phase === 'ascent') g = 0.8 + (base.maxQ ?? 3) * Math.min(1, dynamicPressurePa / 35000) + accelerationG * 0.15;
  else if (phase === 'upper') g = (base.upper ?? 0.8) + accelerationG * 0.1;
  return g * (weatherAdverse ? 1.35 : 1);
}
