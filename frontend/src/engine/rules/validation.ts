/**
 * Motor de regras centralizado. Todas as verificações de aprovação de lançamento vivem aqui
 * (e são repetidas no backend para as decisões persistidas). A interface apenas exibe o resultado.
 */
import type { AssistanceLevel, LaunchVehicle, MissionSpec } from '../../types/catalog';
import type { MissionPlan, SpacecraftConfig, ValidationCheck, ValidationReport } from '../../types/campaign';
import { catalogVersions, findVehicle, launchVehicles, simulationConfig } from '../catalog';
import { analyzeSpacecraft, type SpacecraftSummary } from '../entities/spacecraft';
import { maxLatitudeDeg, sunSynchronousInclination } from '../orbital-mechanics/orbits';
import { burnTime, G0, thrustToWeight } from '../propulsion/rocket';
import { computeBudget, formatUSD } from './budget';
import { computeMissionProfile, type MissionProfile } from './mission-profile';

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const kg = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
const ms = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m/s`;

export interface ValidationInput {
  mission: MissionSpec;
  config: SpacecraftConfig;
  vehicleId: string | null;
  plan: MissionPlan;
  assistance: AssistanceLevel;
}

export interface ValidationContext {
  summary: SpacecraftSummary;
  profile: MissionProfile;
  vehicle: LaunchVehicle | undefined;
  budget: ReturnType<typeof computeBudget>;
}

export function buildContext(input: ValidationInput): ValidationContext {
  const summary = analyzeSpacecraft(input.config, input.mission, input.plan);
  const profile = computeMissionProfile(input.mission, input.plan, input.assistance, summary.capabilities.has('navigation-radio'));
  const vehicle = findVehicle(input.vehicleId);
  const budget = computeBudget(input.mission, summary.componentCostUSD, vehicle, input.config.testCampaign);
  return { summary, profile, vehicle, budget };
}

/** Capacidade do veículo para o perfil (null se pendente/ausente). */
export function vehicleCapacity(vehicle: LaunchVehicle | undefined, profileId: MissionProfile['launchProfile']) {
  if (!vehicle) return null;
  return vehicle.capacities[profileId];
}

/** Verificações críticas reimplementadas no backend (mesmos ids e status; ver data/test-vectors). */
export const SERVER_CHECK_PREFIXES = ['budget-total', 'vehicle-selected', 'vehicle-capacity', 'structure-limit', 'propellant-tank', 'delta-v', 'mission-', 'dep-'];

export function validateMission(input: ValidationInput): ValidationReport & { context: ValidationContext } {
  const ctx = buildContext(input);
  const { summary, profile, vehicle, budget } = ctx;
  const { mission, plan, assistance } = input;
  const checks: ValidationCheck[] = [];
  const add = (c: ValidationCheck) => checks.push(c);

  // ───────────── Financeira ─────────────
  add({
    id: 'budget-total', group: 'financeira', title: 'Orçamento total com reserva de contingência',
    status: budget.withinBudget ? (budget.balanceUSD < budget.availableUSD * 0.03 ? 'aviso' : 'aprovada') : 'reprovada',
    value: formatUSD(budget.committedUSD), limit: formatUSD(budget.availableUSD),
    margin: formatUSD(budget.balanceUSD),
    explanation: `Componentes ${formatUSD(budget.componentsUSD)} + lançamento ${formatUSD(budget.launchUSD)} + operações ${formatUSD(budget.operationsUSD)} + testes ${formatUSD(budget.testsUSD)} = ${formatUSD(budget.configurationUSD)}; reserva de ${budget.contingencyPct}% = ${formatUSD(budget.contingencyUSD)} (contabilizada uma única vez).`,
    action: budget.withinBudget ? '' : 'Remova componentes não essenciais, escolha um lançador mais barato ou uma campanha de testes menor.',
    fixStage: budget.withinBudget ? null : 'hangar', sourceId: 'doc-orcamento',
  });

  // ───────────── Veículo e massa ─────────────
  const cap = vehicleCapacity(vehicle, profile.launchProfile);
  const profileName = launchVehicles.profiles[profile.launchProfile].name;
  if (!vehicle) {
    add({ id: 'vehicle-selected', group: 'massa', title: 'Veículo de lançamento selecionado', status: 'reprovada', value: 'nenhum', limit: '1 veículo', margin: '—', explanation: 'Nenhum veículo foi escolhido.', action: 'Selecione um veículo no hangar de lançadores.', fixStage: 'vehicle' });
  } else if (!cap || cap.status === 'pendente' || cap.massKg === null) {
    add({
      id: 'vehicle-capacity', group: 'massa', title: `Capacidade documentada do ${vehicle.name} para o perfil`,
      status: 'reprovada', value: kg(summary.wetMassKg), limit: 'não documentada', margin: '—',
      explanation: `Não há capacidade validada do ${vehicle.name} para "${profileName}". ${cap?.notes ?? ''} O jogo não deduz capacidades lunares ou interplanetárias a partir da capacidade para órbita baixa.`,
      action: 'Escolha um veículo com capacidade documentada para este perfil.', fixStage: 'vehicle', sourceId: cap?.sourceId ?? null,
    });
  } else {
    const requiredMargin = simulationConfig.assistance[assistance].payloadMarginPct;
    const allowed = cap.massKg * (1 - requiredMargin / 100);
    const marginPct = ((cap.massKg - summary.wetMassKg) / cap.massKg) * 100;
    add({
      id: 'vehicle-capacity', group: 'massa', title: `Carga útil × capacidade (${profileName})`,
      status: summary.wetMassKg <= allowed ? 'aprovada' : summary.wetMassKg <= cap.massKg ? 'aviso' : 'reprovada',
      value: kg(summary.wetMassKg), limit: `${kg(cap.massKg)} (${cap.status})`, margin: pct(marginPct),
      explanation: `${cap.notes} Margem mínima exigida no modo ${simulationConfig.assistance[assistance].label}: ${requiredMargin}%.`,
      action: summary.wetMassKg > cap.massKg ? 'Reduza a massa da sonda (componentes ou propelente) ou selecione um veículo com maior capacidade.' : '',
      fixStage: summary.wetMassKg > cap.massKg ? 'hangar' : null, sourceId: cap.sourceId,
    });
    const liftoffThrust = vehicle.stages.filter((_s, i) => i === 0 || vehicle.stages[i - 1]?.parallel).reduce((sum, s) => sum + s.thrustSLkN * 1000, 0);
    const gross = vehicle.stages.reduce((s, st) => s + st.dryMassKg + st.propMassKg, 0) + vehicle.fairingMassKg + summary.wetMassKg;
    const twr = thrustToWeight(liftoffThrust, gross);
    add({
      id: 'vehicle-twr', group: 'propulsao', title: 'Relação empuxo-peso do lançador na decolagem',
      status: twr >= 1.15 ? 'aprovada' : twr > 1 ? 'aviso' : 'reprovada', value: twr.toFixed(2), limit: '≥ 1,15', margin: pct((twr / 1.15 - 1) * 100),
      explanation: 'Empuxo ao nível do mar dividido pelo peso total (lançador + carga). Abaixo de 1 o foguete não sai da plataforma; perto de 1 as perdas gravitacionais são enormes.',
      action: twr >= 1.15 ? '' : 'Escolha um veículo mais potente.', fixStage: twr >= 1.15 ? null : 'vehicle', sourceId: null,
    });
  }
  if (summary.structuralLimitKg !== null) {
    add({
      id: 'structure-limit', group: 'massa', title: 'Massa total × limite estrutural do barramento',
      status: summary.wetMassKg <= summary.structuralLimitKg ? 'aprovada' : 'reprovada',
      value: kg(summary.wetMassKg), limit: kg(summary.structuralLimitKg), margin: pct(((summary.structuralLimitKg - summary.wetMassKg) / summary.structuralLimitKg) * 100),
      explanation: 'O barramento é dimensionado para as cargas de lançamento de uma massa máxima.',
      action: summary.wetMassKg <= summary.structuralLimitKg ? '' : 'Use um barramento mais robusto ou reduza a massa.', fixStage: summary.wetMassKg <= summary.structuralLimitKg ? null : 'hangar',
    });
  } else {
    add({ id: 'structure-limit', group: 'massa', title: 'Estrutura principal', status: 'reprovada', value: 'ausente', limit: '1 barramento', margin: '—', explanation: 'Sem barramento não há sonda.', action: 'Instale uma estrutura principal.', fixStage: 'hangar' });
  }
  const [gmin, gmax] = mission.massGuidelineKg;
  add({
    id: 'mass-guideline', group: 'massa', title: 'Massa × ordem de grandeza da arquitetura de referência',
    status: summary.wetMassKg >= gmin * 0.5 && summary.wetMassKg <= gmax * 1.5 ? 'aprovada' : 'aviso',
    value: kg(summary.wetMassKg), limit: `${kg(gmin)} – ${kg(gmax)}`, margin: '—',
    explanation: 'Faixa citada em componentes-sondas.md como ordem de grandeza (não é requisito rígido).', action: '', fixStage: null, sourceId: 'doc-componentes',
  });
  add({
    id: 'propellant-tank', group: 'massa', title: 'Propelente carregado × capacidade do tanque',
    status: input.config.propellantKg <= summary.tankCapacityKg ? 'aprovada' : 'reprovada',
    value: kg(input.config.propellantKg), limit: kg(summary.tankCapacityKg), margin: kg(summary.tankCapacityKg - input.config.propellantKg),
    explanation: 'O propelente precisa caber nos tanques do barramento.', action: input.config.propellantKg <= summary.tankCapacityKg ? '' : 'Reduza o propelente ou use o barramento com tanque grande.', fixStage: input.config.propellantKg <= summary.tankCapacityKg ? null : 'hangar',
  });

  // ───────────── Propulsão ─────────────
  const dvOk = summary.deltaVAvailableMS >= profile.requiredDvMS;
  add({
    id: 'delta-v', group: 'propulsao', title: 'Δv disponível × Δv necessário (com margem)',
    status: dvOk ? 'aprovada' : summary.deltaVAvailableMS >= profile.totalDvMS ? 'aviso' : 'reprovada',
    value: ms(summary.deltaVAvailableMS), limit: `${ms(profile.requiredDvMS)} (${ms(profile.totalDvMS)} + ${profile.marginPct}%)`,
    margin: pct(profile.requiredDvMS > 0 ? (summary.deltaVAvailableMS / profile.requiredDvMS - 1) * 100 : 100),
    explanation: summary.mainPropulsion
      ? `Δv = Isp·g0·ln(m0/mf) = ${summary.mainPropulsion.ispS} s × ${G0} m/s² × ln(${summary.wetMassKg.toFixed(0)}/${summary.dryMassKg.toFixed(0)}). Fases: ${profile.phases.map((p) => `${p.label} ${ms(p.dvMS)}`).join('; ')}.`
      : 'Sem sistema de propulsão a sonda não executa nenhuma manobra.',
    action: dvOk ? '' : 'Aumente o propelente (dentro do tanque), use motor de maior Isp ou reduza a massa seca.',
    fixStage: dvOk ? null : 'hangar',
  });
  if (profile.capture && summary.mainPropulsion) {
    const tb = burnTime(summary.mainPropulsion.ispS, summary.mainPropulsion.thrustN, summary.wetMassKg, profile.capture.dvMS);
    const tRef = 2 * Math.PI * Math.sqrt(profile.capture.rp ** 3 / profile.capture.mu);
    const ratio = tb / tRef;
    add({
      id: 'capture-thrust', group: 'propulsao', title: `Empuxo para a captura em ${profile.capture.bodyName}`,
      status: ratio <= 0.25 ? 'aprovada' : ratio <= 0.6 ? 'aviso' : 'reprovada',
      value: `${(tb / 60).toFixed(1)} min de queima`, limit: `≤ ${((0.6 * tRef) / 60).toFixed(0)} min`, margin: pct((0.6 / Math.max(ratio, 1e-9) - 1) * 100),
      explanation: `Empuxo de ${summary.mainPropulsion.thrustN} N para ${summary.wetMassKg.toFixed(0)} kg (T/P local ${(summary.mainPropulsion.thrustN / (summary.wetMassKg * G0)).toFixed(3)} em g0). Queimas longas em relação ao período orbital no periapse (${(tRef / 60).toFixed(0)} min) sofrem grandes perdas gravitacionais.`,
      action: ratio <= 0.6 ? '' : 'Instale um motor principal de maior empuxo (propulsores elétricos não executam capturas).', fixStage: ratio <= 0.6 ? null : 'hangar',
    });
  }

  // ───────────── Subsistemas ─────────────
  for (const req of mission.requirements) {
    const ok = req.anyOf.some((c) => summary.capabilities.has(c));
    add({
      id: `mission-${req.id}`, group: 'subsistemas', title: `Requisito da missão: ${req.reason.split(':')[0]}`,
      status: ok ? 'aprovada' : req.severity === 'obrigatoria' ? 'reprovada' : 'aviso',
      value: ok ? 'atendido' : 'ausente', limit: req.severity === 'obrigatoria' ? 'obrigatório' : 'recomendado', margin: '—',
      explanation: req.reason, action: ok ? '' : `Instale um componente que forneça: ${req.anyOf.join(' ou ')}.`, fixStage: ok ? null : 'hangar', sourceId: 'doc-componentes',
    });
  }
  for (const part of summary.parts) {
    for (const r of part.requires) {
      const ok = r.anyOf.some((c) => summary.capabilities.has(c));
      if (ok) continue;
      const soft = r.anyOf.includes('attitude-fine-reference');
      add({
        id: `dep-${part.id}-${r.anyOf.join('-')}`, group: 'subsistemas', title: `Dependência: ${part.name}`,
        status: soft ? 'aviso' : 'reprovada', value: 'não atendida', limit: r.anyOf.join(' ou '), margin: '—',
        explanation: r.reason, action: 'Instale o componente de suporte ou remova este item.', fixStage: 'hangar',
      });
    }
  }
  const needsActuator = summary.parts.some((p) => p.effects.science?.needsFinePointing);
  if (needsActuator) {
    const ok = summary.capabilities.has('attitude-fine-actuator') || summary.capabilities.has('attitude-thrusters');
    add({
      id: 'attitude-actuator', group: 'subsistemas', title: 'Controle de atitude para instrumentos de apontamento',
      status: ok ? 'aprovada' : 'aviso', value: ok ? 'disponível' : 'ausente', limit: 'rodas de reação ou propulsores de controle', margin: '—',
      explanation: 'Instrumentos de apontamento fino precisam de atuadores que mantenham a orientação estável.', action: ok ? '' : 'Instale rodas de reação (com descarga de momento) ou propulsores de controle.', fixStage: ok ? null : 'hangar',
    });
  }
  // Energia
  const loadW = summary.powerConsumptionW;
  const f = summary.eclipseFraction;
  const neededGen = loadW * (1 + 0.15 * f) / Math.max(0.05, 1 - f);
  const genOk = summary.powerGenerationW >= neededGen;
  add({
    id: 'power-balance', group: 'subsistemas', title: 'Geração × consumo de energia (fim de vida)',
    status: genOk ? (summary.powerGenerationW < neededGen * 1.1 ? 'aviso' : 'aprovada') : summary.powerGenerationW >= loadW * 0.7 ? 'aviso' : 'reprovada',
    value: `${summary.powerGenerationW.toFixed(0)} W`, limit: `${neededGen.toFixed(0)} W`, margin: pct((summary.powerGenerationW / Math.max(1, neededGen) - 1) * 100),
    explanation: `Consumo médio ${loadW.toFixed(0)} W; ${(f * 100).toFixed(0)}% da órbita em eclipse. Painéis geram ${summary.solarAtDistanceW.toFixed(0)} W a ${mission.environment.sunDistanceAU} UA (potência ∝ 1/d², degradação ${simulationConfig.physics.solarArrayDegradationPerYear * 100}%/ano)${summary.rtgW > 0 ? `; RTG ${summary.rtgW} W` : ''}.`,
    action: genOk ? '' : 'Aumente a geração (painéis maiores ou RTG) ou reduza as cargas.', fixStage: genOk ? null : 'hangar',
  });
  if (f > 0) {
    const eclipseWh = (loadW * summary.eclipseDurationS) / 3600;
    const usable = summary.batteryWh * simulationConfig.physics.batteryDepthOfDischarge;
    add({
      id: 'battery-eclipse', group: 'subsistemas', title: 'Baterias × energia consumida no eclipse',
      status: usable >= eclipseWh ? 'aprovada' : 'reprovada', value: `${usable.toFixed(0)} Wh úteis`, limit: `${eclipseWh.toFixed(0)} Wh`,
      margin: pct((usable / Math.max(1, eclipseWh) - 1) * 100),
      explanation: `Eclipse de ${(summary.eclipseDurationS / 60).toFixed(0)} min por órbita; profundidade de descarga limitada a ${simulationConfig.physics.batteryDepthOfDischarge * 100}% para preservar a vida útil.`,
      action: usable >= eclipseWh ? '' : 'Adicione baterias ou reduza o consumo.', fixStage: usable >= eclipseWh ? null : 'hangar',
    });
  }
  // Comunicação
  const cmdOk = summary.commandRateKbps >= 1;
  add({
    id: 'comm-command', group: 'subsistemas', title: 'Enlace de comando e telemetria na distância da missão',
    status: cmdOk ? 'aprovada' : 'reprovada', value: `${summary.commandRateKbps < 1 ? summary.commandRateKbps.toFixed(3) : summary.commandRateKbps.toFixed(1)} kbps`, limit: '≥ 1 kbps', margin: '—',
    explanation: `A taxa cai com o quadrado da distância (${(summary.communicationDelayS < 1 ? `${(summary.communicationDelayS * 1000).toFixed(0)} ms` : `${(summary.communicationDelayS / 60).toFixed(1)} min`)} de atraso de luz).`,
    action: cmdOk ? '' : 'Instale um sistema de comunicação dimensionado para esta distância.', fixStage: cmdOk ? null : 'hangar',
  });
  if (summary.dataGeneratedGbPerDay > 0) {
    const ratio = summary.downlinkGbPerDay / summary.dataGeneratedGbPerDay;
    add({
      id: 'comm-data', group: 'subsistemas', title: 'Capacidade de envio × dados científicos gerados',
      status: ratio >= 1 ? 'aprovada' : ratio >= 0.3 ? 'aviso' : 'reprovada',
      value: `${summary.downlinkGbPerDay.toFixed(2)} GB/dia`, limit: `${summary.dataGeneratedGbPerDay.toFixed(2)} GB/dia`, margin: pct((ratio - 1) * 100),
      explanation: `${summary.scienceRateMbps.toFixed(3)} Mbps durante ${mission.environment.contactHoursPerDay} h/dia de contato. Dados que não descem são perdidos ou precisam ser descartados a bordo.`,
      action: ratio >= 1 ? '' : 'Use um enlace de maior taxa ou reduza o volume de instrumentos.', fixStage: ratio >= 1 ? null : 'hangar',
    });
    const storageNeeded = summary.dataGeneratedGbPerDay;
    add({
      id: 'storage', group: 'subsistemas', title: 'Armazenamento a bordo entre contatos',
      status: summary.storageGb >= storageNeeded ? 'aprovada' : 'aviso', value: `${summary.storageGb} GB`, limit: `${storageNeeded.toFixed(1)} GB (1 dia)`, margin: '—',
      explanation: 'A memória precisa acumular os dados de ao menos um dia entre passagens.', action: summary.storageGb >= storageNeeded ? '' : 'Computador com mais memória ou menos instrumentos de alto volume.', fixStage: summary.storageGb >= storageNeeded ? null : 'hangar',
    });
  }
  // Térmico
  const needsRadiator = summary.thermalDissipationW > 400 && mission.environment.sunDistanceAU < 2;
  if (needsRadiator) {
    const ok = summary.capabilities.has('thermal-rejection');
    add({
      id: 'thermal-rejection', group: 'subsistemas', title: 'Rejeição de calor',
      status: ok ? 'aprovada' : 'aviso', value: `${summary.thermalDissipationW.toFixed(0)} W dissipados`, limit: 'radiadores acima de 400 W', margin: '—',
      explanation: 'Quase toda a energia elétrica consumida vira calor que precisa ser irradiado.', action: ok ? '' : 'Instale radiadores para evitar superaquecimento.', fixStage: ok ? null : 'hangar',
    });
  }
  // Radiação
  for (const r of summary.radiation) {
    if (r.ratio <= 1) continue;
    const critical = summary.parts.find((p) => p.id === r.componentId)?.provides.includes('computer');
    add({
      id: `radiation-${r.componentId}`, group: 'subsistemas', title: `Dose de radiação: ${r.name}`,
      status: critical ? 'reprovada' : 'aviso', value: `${r.doseKrad.toFixed(0)} krad`, limit: `${r.toleranceKrad} krad`, margin: pct((1 / r.ratio - 1) * 100),
      explanation: `Dose acumulada estimada (parâmetro didático) ${r.shielded ? 'dentro do cofre' : 'sem cofre de radiação'}. Acima da tolerância a eletrônica degrada.`,
      action: critical ? 'Use computador endurecido e/ou cofre de radiação.' : 'O instrumento operará degradado; considere reduzir a exposição.', fixStage: critical ? 'hangar' : null,
    });
  }

  // ───────────── Orbital ─────────────
  if (plan.kind === 'earth-orbit') {
    const sso = sunSynchronousInclination(plan.altitudeKm * 1000, plan.eccentricity);
    const inc = profile.launchInclinationDeg;
    const dev = sso === null ? 99 : Math.abs(inc - sso);
    add({
      id: 'sso', group: 'orbital', title: 'Condição heliossíncrona',
      status: dev <= 0.1 ? 'aprovada' : dev <= 1 ? 'aviso' : 'reprovada', value: `${inc.toFixed(2)}°`, limit: `${sso?.toFixed(2) ?? '—'}° (J2)`, margin: `${dev.toFixed(2)}°`,
      explanation: 'A inclinação heliossíncrona decorre da altitude (precessão nodal por J2 igual a ~0,9856°/dia). Fora dela o horário local de passagem deriva e as imagens deixam de ser comparáveis.',
      action: dev <= 1 ? '' : 'Use a inclinação heliossíncrona calculada.', fixStage: dev <= 1 ? null : 'planning', sourceId: 'jpl-astro-par',
    });
    const reach = maxLatitudeDeg(inc);
    const unreachable = mission.checkpoints.filter((c) => Math.abs(c.latitudeDeg) > reach + 2);
    add({
      id: 'coverage', group: 'orbital', title: 'Cobertura dos checkpoints científicos',
      status: unreachable.length === 0 ? 'aprovada' : 'aviso', value: `latitude máx. ${reach.toFixed(1)}°`, limit: 'todos os checkpoints', margin: `${unreachable.length} fora`,
      explanation: unreachable.length ? `Fora de alcance: ${unreachable.map((c) => c.name).join('; ')}.` : 'Todos os alvos estão dentro da faixa de latitudes sobrevoada.', action: '', fixStage: unreachable.length ? 'planning' : null,
    });
    const lt = plan.localTimeOfNode;
    add({
      id: 'local-time', group: 'orbital', title: 'Horário local do nodo e iluminação',
      status: lt === '06:00' || lt === '18:00' ? 'aviso' : 'aprovada', value: lt, limit: '09:30–13:30 para imageamento', margin: '—',
      explanation: lt === '06:00' || lt === '18:00' ? 'Órbita terminadora (alvorada/crepúsculo): energia solar quase contínua, mas iluminação rasante ruim para imagens no visível.' : 'Iluminação adequada para instrumentos ópticos.', action: '', fixStage: null,
    });
    add({ id: 'window', group: 'orbital', title: 'Janela de lançamento', status: 'aprovada', value: 'diária', limit: '—', margin: '—', explanation: 'Para órbita heliossíncrona a janela é diária: o horário de lançamento define o horário local do nodo (calculado pelo modelo educacional).', action: '', fixStage: null });
  } else if (plan.kind === 'lunar') {
    const reach = maxLatitudeDeg(plan.inclinationDeg);
    const unreachable = mission.checkpoints.filter((c) => Math.abs(c.latitudeDeg) > reach + 2);
    add({
      id: 'coverage', group: 'orbital', title: 'Cobertura dos checkpoints lunares', status: unreachable.length === 0 ? 'aprovada' : 'aviso',
      value: `latitude máx. ${reach.toFixed(1)}°`, limit: 'todos os checkpoints', margin: `${unreachable.length} fora`,
      explanation: unreachable.length ? `Fora de alcance: ${unreachable.map((c) => c.name).join('; ')}. Órbitas polares cobrem toda a Lua à medida que ela gira sob a órbita.` : 'Órbita polar: toda a superfície passa sob a sonda ao longo de um mês lunar.',
      action: '', fixStage: unreachable.length ? 'planning' : null,
    });
    add({
      id: 'low-orbit', group: 'orbital', title: 'Estabilidade da órbita lunar baixa', status: plan.lunarAltitudeKm < 30 ? 'aviso' : 'aprovada', value: `${plan.lunarAltitudeKm} km`, limit: '≥ 30 km recomendado', margin: '—',
      explanation: 'Mascons tornam órbitas muito baixas instáveis: o custo de manutenção cresce e há risco de impacto.', action: '', fixStage: null,
    });
    add({ id: 'window', group: 'orbital', title: 'Janela de lançamento e transferência', status: 'aprovada', value: `${(profile.transferTimeS / 86400).toFixed(1)} dias de transferência`, limit: '—', margin: '—', explanation: `C3 ≈ ${profile.c3KmS2?.toFixed(2)} km²/s². Janela calculada pelo modelo educacional de cônicas ajustadas coplanares (não é efeméride operacional).`, action: '', fixStage: null });
  } else if (profile.window) {
    const w = profile.window;
    add({
      id: 'window', group: 'orbital', title: 'Janela Terra → Júpiter', status: w.errorDays <= w.toleranceDays ? 'aprovada' : 'reprovada',
      value: `${w.errorDays.toFixed(0)} dias de erro de fase`, limit: `≤ ${w.toleranceDays} dias`, margin: '—',
      explanation: `Fase Júpiter–Terra avaliada em ${w.phasingDate} (partida ou sobrevoo da Terra). Janelas se repetem a cada período sinódico (~399 dias). Modelo educacional de órbitas circulares coplanares.`,
      action: w.errorDays <= w.toleranceDays ? '' : `Ajuste a data de partida: janela mais próxima em ${w.nearest}.`, fixStage: w.errorDays <= w.toleranceDays ? null : 'planning', sourceId: 'jpl-approx-positions',
    });
    add({
      id: 'perijove', group: 'orbital', title: 'Perijove e ambiente de radiação', status: plan.perijoveAltitudeKm < 3000 ? 'aviso' : 'aprovada', value: `${plan.perijoveAltitudeKm} km`, limit: '≥ 3 000 km recomendado', margin: '—',
      explanation: 'Perijoves baixos melhoram gravidade e micro-ondas, mas cruzam regiões de radiação mais intensa e arrasto atmosférico residual.', action: '', fixStage: null,
    });
    add({
      id: 'coverage', group: 'orbital', title: 'Cobertura polar', status: plan.inclinationDeg >= 70 ? 'aprovada' : 'aviso', value: `${plan.inclinationDeg}°`, limit: '≥ 70° para auroras/polos', margin: '—',
      explanation: 'Uma órbita polar permite medir o campo magnético e as auroras em altas latitudes.', action: '', fixStage: plan.inclinationDeg >= 70 ? null : 'planning',
    });
  }

  const blockers = checks.filter((c) => c.status === 'reprovada');
  return {
    approved: blockers.length === 0,
    checks,
    blockers,
    warnings: checks.filter((c) => c.status === 'aviso'),
    computedAt: new Date().toISOString(),
    engineVersion: catalogVersions.simulationModel,
    context: ctx,
  };
}

/** Compatibilidade rápida de veículos para exibição no hangar de lançadores. */
export function vehicleCompatibility(vehicle: LaunchVehicle, profileId: MissionProfile['launchProfile'], wetMassKg: number) {
  const cap = vehicle.capacities[profileId];
  if (!cap || cap.status === 'pendente' || cap.massKg === null) {
    return { status: 'pendente' as const, text: `Capacidade não documentada para este perfil. ${cap?.notes ?? ''}`, marginPct: null };
  }
  const marginPct = ((cap.massKg - wetMassKg) / cap.massKg) * 100;
  return {
    status: wetMassKg <= cap.massKg ? ('compativel' as const) : ('insuficiente' as const),
    text: wetMassKg <= cap.massKg
      ? `Capacidade de ${cap.massKg.toLocaleString('pt-BR')} kg (${cap.status}) acomoda a sonda com margem de ${marginPct.toFixed(0)}%.`
      : `Sonda de ${wetMassKg.toFixed(0)} kg excede a capacidade de ${cap.massKg.toLocaleString('pt-BR')} kg.`,
    marginPct,
  };
}
