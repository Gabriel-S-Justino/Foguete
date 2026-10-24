/**
 * Operações pós-lançamento: manobras da sonda (Tsiolkovsky com a massa real), checkpoints científicos,
 * pontuação e relatório. Funções puras: recebem o estado e devolvem o novo estado.
 */
import type { Checkpoint, MissionSpec } from '../../types/catalog';
import type {
  CheckpointResult, FlightEventRecord, ManeuverRecord, MissionClassification, MissionPlan, MissionReport, SpacecraftConfig,
} from '../../types/campaign';
import { getComponent, missions as missionCatalog } from '../catalog';
import { analyzeSpacecraft, type SpacecraftSummary } from '../entities/spacecraft';
import { maxLatitudeDeg } from '../orbital-mechanics/orbits';
import { propellantForDeltaV, tsiolkovsky } from '../propulsion/rocket';
import type { MissionProfile } from '../rules/mission-profile';

export interface PlannedManeuver { id: string; label: string; dvMS: number; executable: boolean; critical: boolean; explanation: string }

/** Sequência de manobras executáveis pelo jogador; fases contínuas ficam como reserva de propelente. */
export function plannedManeuvers(profile: MissionProfile): PlannedManeuver[] {
  const reserveIds = new Set(['drag', 'deorbit', 'station', 'cleanup']);
  return profile.phases.map((p) => ({
    id: p.id,
    label: p.label,
    dvMS: p.dvMS,
    executable: !reserveIds.has(p.id) && p.dvMS > 0,
    critical: p.id === 'loi' || p.id === 'joi',
    explanation: p.explanation,
  }));
}

export interface ManeuverOutcome { record: ManeuverRecord; propellantRemainingKg: number; event: FlightEventRecord; insertionState?: 'captured' | 'high-orbit' | 'flyby' }

/**
 * Executa uma manobra com o propelente restante. dispersionFactor > 1 representa erros de navegação
 * acumulados (ex.: correções de trajetória ignoradas).
 */
export function executeManeuver(
  m: PlannedManeuver, summary: SpacecraftSummary, propellantRemainingKg: number, dispersionFactor: number, t: number,
): ManeuverOutcome {
  const engine = summary.mainPropulsion;
  const mass0 = summary.dryMassKg + propellantRemainingKg;
  const needed = m.dvMS * dispersionFactor;
  if (!engine || propellantRemainingKg <= 0) {
    const record: ManeuverRecord = { id: m.id, label: m.label, plannedDvMS: needed, executedDvMS: 0, propellantUsedKg: 0, success: false, note: 'Sem propulsão ou sem propelente.' };
    return { record, propellantRemainingKg, event: { t, phase: 'cruise', id: `mnv-${m.id}`, label: `${m.label}: não executada (sem propelente)`, severity: m.critical ? 'critica' : 'grave' }, insertionState: m.critical ? 'flyby' : undefined };
  }
  const maxDv = tsiolkovsky(engine.ispS, mass0, summary.dryMassKg);
  const executed = Math.min(needed, maxDv);
  const used = propellantForDeltaV(engine.ispS, mass0, executed);
  const remaining = Math.max(0, propellantRemainingKg - used);
  const ratio = needed > 0 ? executed / needed : 1;
  let insertionState: ManeuverOutcome['insertionState'];
  if (m.critical) insertionState = ratio >= 0.999 ? 'captured' : ratio >= 0.85 ? 'high-orbit' : 'flyby';
  const success = ratio >= 0.999;
  const note = success
    ? `Δv ${executed.toFixed(1)} m/s com ${used.toFixed(1)} kg de propelente (${engine.name}, Isp ${engine.ispS} s).`
    : `Propelente insuficiente: ${executed.toFixed(1)} de ${needed.toFixed(1)} m/s.`;
  return {
    record: { id: m.id, label: m.label, plannedDvMS: needed, executedDvMS: executed, propellantUsedKg: used, success, note },
    propellantRemainingKg: remaining,
    insertionState,
    event: {
      t, phase: 'cruise', id: `mnv-${m.id}`,
      label: `${m.label}: ${note}${insertionState === 'high-orbit' ? ' Captura em órbita mais alta que a planejada.' : insertionState === 'flyby' ? ' Captura falhou: a sonda passa direto (sobrevoo).' : ''}`,
      severity: success ? 'info' : m.critical ? 'critica' : 'grave',
    },
  };
}

export interface ScienceState {
  activeEffects: string[];
  insertionState: 'captured' | 'high-orbit' | 'flyby' | 'none';
}

function altitudeFactor(altKm: number, range: [number, number]): number {
  const [lo, hi] = range;
  if (altKm >= lo && altKm <= hi) return 1;
  if (altKm > hi) return Math.max(0.1, hi / altKm);
  return Math.max(0.2, Math.sqrt(altKm / lo));
}

function illuminationFactor(mission: MissionSpec, plan: MissionPlan, cp: Checkpoint): number {
  if (!cp.needsIllumination) return 1;
  if (plan.kind === 'earth-orbit') {
    const lt = plan.localTimeOfNode;
    return lt === '10:30' || lt === '13:30' ? 1 : lt === '09:30' ? 0.95 : 0.35;
  }
  if (plan.kind === 'lunar') return Math.abs(cp.latitudeDeg) > 80 ? 0.4 : 0.9;
  return mission.environment.sunDistanceAU > 3 ? 0.8 : 1;
}

/** Avalia um checkpoint: instrumentos presentes, alcance, altitude, apontamento, iluminação, saúde, energia e enlace. */
export function evaluateCheckpoint(
  mission: MissionSpec, plan: MissionPlan, config: SpacecraftConfig, cp: Checkpoint, state: ScienceState,
): CheckpointResult {
  const summary = analyzeSpacecraft(config, mission, plan);
  const notes: string[] = [];
  const factors: Record<string, number> = {};
  if (state.insertionState === 'flyby' || state.insertionState === 'none') {
    return { checkpointId: cp.id, executed: false, quality: 0, dataGb: 0, factors: { insercao: 0 }, notes: ['A sonda não está na órbita de destino.'] };
  }
  const instruments = summary.parts.filter((p) => p.effects.science && p.effects.science.measures.some((m) => cp.measures.includes(m)));
  const covered = new Set(instruments.flatMap((p) => p.effects.science!.measures).filter((m) => cp.measures.includes(m)));
  factors.instrumentos = covered.size / cp.measures.length;
  if (instruments.length === 0) {
    notes.push('Nenhum instrumento instalado mede esta grandeza: nenhum dado científico válido é produzido.');
    return { checkpointId: cp.id, executed: true, quality: 0, dataGb: 0, factors, notes };
  }
  if (factors.instrumentos < 1) notes.push(`Apenas ${covered.size} de ${cp.measures.length} medidas disponíveis.`);

  const inclination = plan.kind === 'interplanetary' ? plan.inclinationDeg : plan.inclinationDeg;
  const reach = maxLatitudeDeg(inclination);
  factors.alcance = Math.abs(cp.latitudeDeg) <= reach + 2 ? 1 : 0;
  if (!factors.alcance) notes.push(`Latitude ${cp.latitudeDeg}° fora do alcance da órbita (máx. ${reach.toFixed(1)}°).`);

  let alt = plan.kind === 'earth-orbit' ? plan.altitudeKm : plan.kind === 'lunar' ? plan.lunarAltitudeKm : plan.perijoveAltitudeKm;
  if (state.insertionState === 'high-orbit') { alt *= 3; notes.push('Órbita mais alta que a planejada após captura incompleta.'); }
  factors.altitude = instruments.reduce((s, p) => s + altitudeFactor(alt, p.effects.science!.optimalAltitudeKm), 0) / instruments.length;

  const finePointing = instruments.some((p) => p.effects.science!.needsFinePointing);
  const hasRef = summary.capabilities.has('attitude-fine-reference');
  const hasAct = summary.capabilities.has('attitude-fine-actuator') && summary.capabilities.has('momentum-dump') || summary.capabilities.has('attitude-thrusters');
  factors.apontamento = !finePointing ? 1 : hasRef && hasAct ? (state.activeEffects.includes('pointing-degraded') ? 0.6 : 1) : 0.5;
  if (factors.apontamento < 1) notes.push('Apontamento degradado reduz a qualidade das medidas.');

  factors.iluminacao = illuminationFactor(mission, plan, cp);
  if (factors.iluminacao < 1) notes.push('Iluminação desfavorável para instrumentos ópticos.');

  const radiationHealth = instruments.map((p) => {
    const r = summary.radiation.find((x) => x.componentId === p.id);
    return r && r.ratio > 1 ? 1 / r.ratio : 1;
  });
  factors.saude = (radiationHealth.reduce((a, b) => a + b, 0) / radiationHealth.length) * (state.activeEffects.includes('component-damage') ? 0.75 : 1);
  if (factors.saude < 1) notes.push('Instrumentos degradados (radiação ou danos).');

  const powerLoss = state.activeEffects.includes('power-loss-20') ? 0.8 : 1;
  const load = summary.powerConsumptionW;
  factors.energia = Math.min(1, (summary.powerGenerationW * powerLoss) / Math.max(1, load * (1 + summary.eclipseFraction)));
  if (factors.energia < 1) notes.push('Energia insuficiente para operar todos os instrumentos continuamente.');

  const commLoss = state.activeEffects.includes('comm-rate-50') ? 0.5 : 1;
  const generated = instruments.reduce((s, p) => s + p.effects.science!.dataGbPerDay, 0);
  factors.enlace = generated > 0 ? Math.min(1, (summary.downlinkGbPerDay * commLoss) / summary.dataGeneratedGbPerDay) : 1;
  if (factors.enlace < 1) notes.push('Parte dos dados não pôde ser enviada à Terra.');

  factors.tempo = state.activeEffects.includes('safe-mode') ? 0.85 : 1;
  if (plan.kind === 'interplanetary') {
    const needed = cp.measures.includes('gravity-science') ? 8 : 4;
    factors.tempo *= Math.min(1, plan.scienceOrbits / needed);
    if (plan.scienceOrbits < needed) notes.push(`Mais órbitas científicas seriam necessárias (${needed}).`);
  }
  if (state.activeEffects.includes('solar-storm-unprotected')) { factors.tempo *= 0.8; notes.push('Tempestade solar sem modo de proteção: interferência nos sensores.'); }

  const quality = Object.values(factors).reduce((a, b) => a * b, 1);
  const days = mission.scienceDays > 0 ? mission.scienceDays : (plan.kind === 'interplanetary' ? plan.orbitPeriodDays * plan.scienceOrbits : 30);
  const dataGb = generated * days * factors.enlace * (factors.alcance ? 1 : 0) / Math.max(1, mission.checkpoints.length / 2);
  return { checkpointId: cp.id, executed: true, quality, dataGb, factors, notes };
}

const CLASS_LABEL: Record<MissionClassification, string> = {
  sucesso: 'Missão concluída com sucesso',
  parcial: 'Missão parcialmente concluída',
  limitada: 'Missão concluída com resultados científicos limitados',
  abortada: 'Missão abortada',
  fracassada: 'Missão fracassada',
};

export interface ReportInput {
  playerName: string;
  mission: MissionSpec;
  plan: MissionPlan;
  config: SpacecraftConfig;
  vehicleName: string;
  finalCostUSD: number;
  launchOutcome: 'orbit' | 'pad-abort' | 'flight-abort' | 'flight-terminated' | 'launch-failure' | 'pending';
  insertionState: ScienceState['insertionState'];
  results: CheckpointResult[];
  events: FlightEventRecord[];
  maneuvers: ManeuverRecord[];
  propellantRemainingKg: number;
}

/**
 * Critérios objetivos de classificação:
 * - abortada: jogador abortou na plataforma ou em voo;
 * - fracassada: falha de lançamento, captura não realizada ou ciência < 15;
 * - sucesso: ciência ≥ 75 e todos os objetivos primários ≥ 50;
 * - parcial: ciência ≥ 50; limitada: ciência ≥ 15.
 */
export function classify(launchOutcome: ReportInput['launchOutcome'], insertion: ScienceState['insertionState'], science: number, primaryOk: boolean): MissionClassification {
  if (launchOutcome === 'pad-abort' || launchOutcome === 'flight-abort') return 'abortada';
  if (launchOutcome !== 'orbit' || insertion === 'flyby' || insertion === 'none') return 'fracassada';
  if (science >= 75 && primaryOk) return 'sucesso';
  if (science >= 50) return 'parcial';
  if (science >= 15) return 'limitada';
  return 'fracassada';
}

export function buildReport(input: ReportInput): MissionReport {
  const { mission } = input;
  const objectives = mission.objectives.map((o) => {
    const cps = mission.checkpoints.filter((c) => c.objectiveId === o.id);
    const scores = cps.map((c) => input.results.find((r) => r.checkpointId === c.id)?.quality ?? 0);
    const score = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) * 100 : 0;
    return { id: o.id, title: o.title, score, primary: o.primary };
  });
  const scienceScore = objectives.reduce((s, o) => s + (o.score * (mission.objectives.find((x) => x.id === o.id)?.weight ?? 0)), 0);
  const primaryOk = objectives.filter((o) => o.primary).every((o) => o.score >= 50);
  const classification = classify(input.launchOutcome, input.insertionState, scienceScore, primaryOk);
  const budgetScore = input.finalCostUSD <= mission.budget.availableUSD ? 100 * Math.min(1, 0.5 + (mission.budget.availableUSD - input.finalCostUSD) / mission.budget.availableUSD) : 0;
  const critical = input.events.filter((e) => e.severity === 'critica' || e.severity === 'grave');
  const opsScore = Math.max(0, 100 - critical.length * 15);
  const finalScore = classification === 'abortada' || classification === 'fracassada' && input.launchOutcome !== 'orbit'
    ? Math.min(20, budgetScore * 0.1 + opsScore * 0.1)
    : scienceScore * 0.75 + budgetScore * 0.1 + opsScore * 0.15;

  const educational: string[] = [];
  const recommendations: string[] = [];
  const summary = analyzeSpacecraft(input.config, mission, input.plan);
  if (mission.id === 'lunar-he3') {
    educational.push('Os mapas produzidos são INDICADORES (titânio/ilmenita, maturidade, profundidade do regolito). Eles permitem ESTIMAR a abundância potencial de Hélio-3, mas não medem He-3 diretamente.');
    educational.push('Medição ≠ estimativa de abundância ≠ potencial de exploração ≠ viabilidade econômica. Nenhuma região foi declarada reserva economicamente extraível.');
  }
  if (mission.id === 'jupiter-system') {
    educational.push('Os dados de gravidade e magnetosfera alimentam modelos dinâmicos; Júpiter tanto desvia quanto lança pequenos corpos para o Sistema Solar interno. A missão testa hipóteses, não "prova" um escudo.');
  }
  if (mission.id === 'leo-climate') {
    educational.push('Em órbita heliossíncrona a inclinação é consequência da altitude (efeito J2), e o horário local do nodo define a iluminação das imagens.');
  }
  educational.push('Δv da sonda foi calculado pela equação de Tsiolkovsky com a massa efetivamente instalada; o Δv do lançador não é transferido à sonda.');
  for (const o of objectives) if (o.score < 50) recommendations.push(`Melhore "${o.title}": verifique instrumentos, altitude e enlace de dados.`);
  if (summary.downlinkGbPerDay < summary.dataGeneratedGbPerDay) recommendations.push('O enlace de dados limitou o retorno científico: considere uma antena/transmissor de maior taxa.');
  if (input.maneuvers.some((m) => !m.success)) recommendations.push('Alguma manobra ficou sem propelente suficiente: aumente a margem de Δv.');
  if (input.launchOutcome !== 'orbit') recommendations.push('Revise as condições de lançamento: mantenha holds diante de alertas bloqueantes e escolha veículos com maior histórico.');
  if (recommendations.length === 0) recommendations.push('Configuração equilibrada. Tente o modo avançado, com margens mais exigentes.');

  const launchLabels: Record<ReportInput['launchOutcome'], string> = {
    orbit: 'Inserção orbital nominal', 'pad-abort': 'Abortado na plataforma (motores desligados com segurança)', 'flight-abort': 'Corte de motores em voo (sem inserção)',
    'flight-terminated': 'Terminação de voo acionada (destruição controlada)', 'launch-failure': 'Falha de lançamento', pending: 'Não lançado',
  };
  const trajectory = input.insertionState === 'captured' ? 'Captura/inserção nominal' : input.insertionState === 'high-orbit' ? 'Captura em órbita mais alta que a planejada' : input.insertionState === 'flyby' ? 'Captura falhou (sobrevoo)' : 'Trajetória não iniciada';

  return {
    playerName: input.playerName,
    missionId: mission.id,
    missionName: mission.name,
    vehicleName: input.vehicleName,
    components: input.config.installed.map((i) => getComponent(i.componentId).name),
    budgetUSD: mission.budget.availableUSD,
    finalCostUSD: input.finalCostUSD,
    launchResult: launchLabels[input.launchOutcome],
    trajectoryResult: trajectory,
    objectives,
    dataCollectedGb: input.results.reduce((s, r) => s + r.dataGb / Math.max(0.01, r.factors.enlace ?? 1), 0),
    dataReturnedGb: input.results.reduce((s, r) => s + r.dataGb, 0),
    criticalEvents: critical,
    failures: input.events.filter((e) => e.id.startsWith('fail-')).map((e) => e.label),
    remainingPropellantKg: input.propellantRemainingKg,
    scienceScore,
    finalScore,
    classification,
    classificationLabel: CLASS_LABEL[classification],
    educational,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

export const testCampaigns = missionCatalog.testCampaigns;
