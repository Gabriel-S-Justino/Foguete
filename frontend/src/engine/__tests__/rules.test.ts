import { describe, expect, it } from 'vitest';
import type { MissionId } from '../../types/catalog';
import type { JupiterPlan } from '../../types/campaign';
import { getMission, getVehicle } from '../catalog';
import { analyzeSpacecraft, canInstall, canRemove } from '../entities/spacecraft';
import { failureProbability, rollPhase } from '../failures/failures';
import { simulationConfig } from '../catalog';
import { computeBudget } from '../rules/budget';
import { computeMissionProfile, defaultPlan } from '../rules/mission-profile';
import { referenceConfig, REFERENCE_ARCHITECTURES } from '../rules/presets';
import { validateMission, vehicleCompatibility } from '../rules/validation';
import { buildReport, chargedManeuver, classify, evaluateCheckpoint, executeManeuver, plannedManeuvers } from '../science/operations';
import { jupiterWindow } from '../orbital-mechanics/orbits';

function planFor(id: MissionId) {
  const mission = getMission(id);
  const plan = defaultPlan(mission);
  if (plan.kind === 'interplanetary') {
    const w = jupiterWindow(new Date(`${plan.departureDate}T00:00:00Z`), 2);
    (plan as JupiterPlan).departureDate = w.nearestWindow.toISOString().slice(0, 10);
  }
  return { mission, plan };
}

describe('configurações de referência', () => {
  for (const id of ['leo-climate', 'lunar-he3', 'jupiter-system'] as MissionId[]) {
    it(`${id}: arquitetura de referência é aprovada no modo iniciante`, () => {
      const { mission, plan } = planFor(id);
      const report = validateMission({ mission, config: referenceConfig(id), vehicleId: REFERENCE_ARCHITECTURES[id].vehicleId, plan, assistance: 'iniciante' });
      if (!report.approved) console.log(id, report.blockers.map((b) => `${b.id}: ${b.value} vs ${b.limit}`));
      expect(report.approved).toBe(true);
    });
  }
});

describe('massa e custo', () => {
  it('massa total é a soma dos componentes instalados + propelente', () => {
    const { mission, plan } = planFor('leo-climate');
    const cfg = referenceConfig('leo-climate');
    const s = analyzeSpacecraft(cfg, mission, plan);
    expect(s.dryMassKg).toBe(s.parts.reduce((a, p) => a + p.massKg, 0));
    expect(s.wetMassKg).toBe(s.dryMassKg + 70);
    const without = analyzeSpacecraft({ ...cfg, installed: cfg.installed.filter((i) => i.componentId !== 'imager-multispectral') }, mission, plan);
    expect(s.dryMassKg - without.dryMassKg).toBe(120);
    expect(s.componentCostUSD - without.componentCostUSD).toBe(35_000_000);
  });
  it('propelente é limitado pela capacidade do tanque', () => {
    const { mission, plan } = planFor('leo-climate');
    const s = analyzeSpacecraft({ ...referenceConfig('leo-climate'), propellantKg: 5000 }, mission, plan);
    expect(s.propellantKg).toBe(80);
  });
});

describe('orçamento', () => {
  it('reserva calculada uma única vez e excesso detectado', () => {
    const mission = getMission('leo-climate');
    const b = computeBudget(mission, 100e6, getVehicle('falcon-9'), 'standard');
    expect(b.configurationUSD).toBeCloseTo(100e6 + 67e6 + 15e6 + 7e6, 0);
    expect(b.contingencyUSD).toBeCloseTo(b.configurationUSD * 0.1, 0);
    expect(b.committedUSD).toBeCloseTo(b.configurationUSD + b.contingencyUSD, 0);
    expect(b.withinBudget).toBe(true);
    const sls = computeBudget(mission, 100e6, getVehicle('sls'), 'standard');
    expect(sls.withinBudget).toBe(false);
    expect(sls.overrunUSD).toBeGreaterThan(0);
  });
  it('missão acima do orçamento é reprovada', () => {
    const { mission, plan } = planFor('leo-climate');
    const r = validateMission({ mission, config: referenceConfig('leo-climate'), vehicleId: 'sls', plan, assistance: 'iniciante' });
    expect(r.approved).toBe(false);
    expect(r.blockers.map((b) => b.id)).toContain('budget-total');
  });
});

describe('capacidade de carga', () => {
  it('capacidade pendente nunca aprova (New Glenn para TLI)', () => {
    const { mission, plan } = planFor('lunar-he3');
    const r = validateMission({ mission, config: referenceConfig('lunar-he3'), vehicleId: 'new-glenn', plan, assistance: 'iniciante' });
    const c = r.checks.find((x) => x.id === 'vehicle-capacity')!;
    expect(c.status).toBe('reprovada');
    expect(c.fixStage).toBe('vehicle');
  });
  it('capacidade LEO não é usada para TLI: Falcon 9 usa limite derivado de Marte', () => {
    const v = getVehicle('falcon-9');
    expect(v.capacities.tli.massKg).toBe(4020);
    expect(vehicleCompatibility(v, 'tli', 5000).status).toBe('insuficiente');
    expect(vehicleCompatibility(v, 'jupiter-ga', 1000).status).toBe('pendente');
  });
});

describe('validação de subsistemas', () => {
  it('sem enlace de espaço profundo, a missão a Júpiter é reprovada', () => {
    const { mission, plan } = planFor('jupiter-system');
    const cfg = referenceConfig('jupiter-system');
    cfg.installed = cfg.installed.filter((i) => i.componentId !== 'hga-large');
    const r = validateMission({ mission, config: cfg, vehicleId: 'falcon-heavy', plan, assistance: 'iniciante' });
    expect(r.approved).toBe(false);
    expect(r.blockers.some((b) => b.id === 'comm-command')).toBe(true);
  });
  it('banda S de órbita baixa não fecha o enlace na Lua', () => {
    const { mission, plan } = planFor('lunar-he3');
    const cfg = referenceConfig('lunar-he3');
    cfg.installed = cfg.installed.filter((i) => i.componentId !== 'hga-sx').concat({ instanceId: 's', componentId: 'sband-ttc' });
    const r = validateMission({ mission, config: cfg, vehicleId: 'falcon-9', plan, assistance: 'iniciante' });
    expect(r.blockers.some((b) => b.id === 'comm-command')).toBe(true);
  });
  it('propulsor elétrico não executa a LOI (empuxo insuficiente)', () => {
    const { mission, plan } = planFor('lunar-he3');
    const cfg = referenceConfig('lunar-he3');
    cfg.installed = cfg.installed.filter((i) => !['biprop-main', 'rcs-control-thrusters'].includes(i.componentId)).concat({ instanceId: 'e', componentId: 'electric-thruster-small' });
    const r = validateMission({ mission, config: cfg, vehicleId: 'falcon-9', plan, assistance: 'iniciante' });
    expect(r.approved).toBe(false);
    expect(r.blockers.map((b) => b.id)).toEqual(expect.arrayContaining(['mission-req-main']));
  });
  it('rodas de reação sem descarga de momento longe da Terra geram reprovação explicada', () => {
    const { mission, plan } = planFor('lunar-he3');
    const cfg = referenceConfig('lunar-he3');
    cfg.installed = cfg.installed.filter((i) => i.componentId !== 'rcs-control-thrusters').concat({ instanceId: 'm', componentId: 'magnetorquers' });
    const r = validateMission({ mission, config: cfg, vehicleId: 'falcon-9', plan, assistance: 'iniciante' });
    const dep = r.blockers.find((b) => b.id.startsWith('dep-reaction-wheels'));
    expect(dep?.explanation).toMatch(/magnetotorquers/);
  });
  it('janela de Júpiter fora da tolerância bloqueia e sugere data', () => {
    const { mission } = planFor('jupiter-system');
    const plan = defaultPlan(mission) as JupiterPlan;
    const w = jupiterWindow(new Date(`${plan.departureDate}T00:00:00Z`), 2);
    plan.departureDate = new Date(w.nearestWindow.getTime() + 150 * 86400e3).toISOString().slice(0, 10);
    const r = validateMission({ mission, config: referenceConfig('jupiter-system'), vehicleId: 'falcon-heavy', plan, assistance: 'iniciante' });
    const c = r.checks.find((x) => x.id === 'window')!;
    expect(c.status).toBe('reprovada');
    expect(c.action).toMatch(/janela mais próxima/);
  });
  it('energia: painéis a 5,2 UA geram ~1/27 do valor a 1 UA', () => {
    const { mission, plan } = planFor('jupiter-system');
    const s = analyzeSpacecraft(referenceConfig('jupiter-system'), mission, plan);
    expect(s.solarAtDistanceW).toBeLessThan(15000 / 5.2 ** 2 + 1);
    expect(s.solarAtDistanceW).toBeGreaterThan((15000 / 5.2 ** 2) * 0.9);
  });
});

describe('hangar', () => {
  it('exige barramento antes dos demais componentes e impede remover o barramento ocupado', () => {
    expect(canInstall({ installed: [], propellantKg: 0, testCampaign: 'standard' }, 'star-tracker').ok).toBe(false);
    const cfg = { installed: [{ instanceId: 'b', componentId: 'bus-aluminum' }, { instanceId: 's', componentId: 'star-tracker' }], propellantKg: 0, testCampaign: 'standard' as const };
    expect(canInstall(cfg, 'star-tracker').ok).toBe(false);
    expect(canRemove(cfg, 'b').ok).toBe(false);
    expect(canRemove(cfg, 's').ok).toBe(true);
  });
});

describe('delta-v por fase', () => {
  it('orçamento lunar inclui TCM, LOI e manutenção; margem aplicada', () => {
    const { mission, plan } = planFor('lunar-he3');
    const p = computeMissionProfile(mission, plan, 'avancado', true);
    expect(p.phases.map((x) => x.id)).toEqual(['tcm', 'loi', 'station']);
    expect(p.requiredDvMS).toBeCloseTo(p.totalDvMS * 1.15, 6);
  });
});

describe('falhas', () => {
  it('campanha de testes extensiva reduz a probabilidade', () => {
    const { mission, plan } = planFor('leo-climate');
    const cfg = referenceConfig('leo-climate');
    const spec = simulationConfig.failures.find((f) => f.id === 'pad-sensor')!;
    const ctx = (tc: 'minimal' | 'extensive') => ({ mission, config: { ...cfg, testCampaign: tc }, summary: analyzeSpacecraft(cfg, mission, plan), vehicleId: 'falcon-9' });
    expect(failureProbability(spec, ctx('extensive')).probability).toBeLessThan(failureProbability(spec, ctx('minimal')).probability);
  });
  it('sorteio determinístico por semente', () => {
    const { mission, plan } = planFor('leo-climate');
    const cfg = referenceConfig('leo-climate');
    const ctx = { mission, config: cfg, summary: analyzeSpacecraft(cfg, mission, plan), vehicleId: 'falcon-9' };
    expect(rollPhase('pad', ctx, 123, 1).map((e) => e.spec.id)).toEqual(rollPhase('pad', ctx, 123, 1).map((e) => e.spec.id));
  });
  it('detritos só existem no ambiente terrestre', () => {
    const { mission, plan } = planFor('lunar-he3');
    const cfg = referenceConfig('lunar-he3');
    const spec = simulationConfig.failures.find((f) => f.id === 'debris-conjunction')!;
    expect(failureProbability(spec, { mission, config: cfg, summary: analyzeSpacecraft(cfg, mission, plan), vehicleId: 'falcon-9' }).probability).toBe(0);
  });
});

describe('ciência, chegada e relatório', () => {
  it('instrumento ausente não gera dados válidos', () => {
    const { mission, plan } = planFor('leo-climate');
    const cfg = referenceConfig('leo-climate');
    cfg.installed = cfg.installed.filter((i) => i.componentId !== 'imager-multispectral');
    const r = evaluateCheckpoint(mission, plan, cfg, mission.checkpoints[0]!, { activeEffects: [], insertionState: 'captured' });
    expect(r.quality).toBe(0);
    expect(r.dataGb).toBe(0);
  });
  it('captura com propelente insuficiente resulta em sobrevoo', () => {
    const { mission, plan } = planFor('lunar-he3');
    const cfg = { ...referenceConfig('lunar-he3'), propellantKg: 50 };
    const s = analyzeSpacecraft(cfg, mission, plan);
    const loi = plannedManeuvers(computeMissionProfile(mission, plan, 'iniciante', true)).find((m) => m.id === 'loi')!;
    const out = executeManeuver(loi, s, 50, 1, 0);
    expect(out.insertionState).toBe('flyby');
    expect(out.propellantRemainingKg).toBeCloseTo(0, 6);
  });
  it('a manobra cobra o Δv calculado pela trajetória; o orçado é só referência', () => {
    const { mission, plan } = planFor('jupiter-system');
    const cfg = referenceConfig('jupiter-system');
    const s = analyzeSpacecraft(cfg, mission, plan);
    const joi = plannedManeuvers(computeMissionProfile(mission, plan, 'iniciante', true)).find((m) => m.id === 'joi')!;
    const charged = chargedManeuver(joi, joi.dvMS + 110);
    expect(charged.dvMS).toBeCloseTo(joi.dvMS + 110, 9);
    expect(chargedManeuver(joi, undefined).dvMS).toBe(joi.dvMS);
    const byBudget = executeManeuver(joi, s, cfg.propellantKg, 1, 0);
    const byTrajectory = executeManeuver(charged, s, cfg.propellantKg, 1, 0);
    expect(byTrajectory.record.executedDvMS).toBeCloseTo(joi.dvMS + 110, 6);
    expect(byTrajectory.record.propellantUsedKg).toBeGreaterThan(byBudget.record.propellantUsedKg);
    // Propelente que cobre o orçado mas não o calculado: a captura fica incompleta
    const tight = s.dryMassKg * (Math.exp(joi.dvMS / (s.mainPropulsion!.ispS * 9.80665)) - 1) * 1.01;
    expect(executeManeuver(joi, s, tight, 1, 0).insertionState).toBe('captured');
    expect(executeManeuver(charged, s, tight, 1, 0).insertionState).not.toBe('captured');
  });
  it('classificação segue critérios objetivos', () => {
    expect(classify('pad-abort', 'none', 0, false)).toBe('abortada');
    expect(classify('orbit', 'flyby', 0, false)).toBe('fracassada');
    expect(classify('orbit', 'captured', 80, true)).toBe('sucesso');
    expect(classify('orbit', 'captured', 80, false)).toBe('parcial');
    expect(classify('orbit', 'captured', 20, false)).toBe('limitada');
  });
  it('relatório completo da missão de referência não dá nota integral apenas por chegar', () => {
    const { mission, plan } = planFor('leo-climate');
    const cfg = referenceConfig('leo-climate');
    const results = mission.checkpoints.map((cp) => evaluateCheckpoint(mission, plan, cfg, cp, { activeEffects: [], insertionState: 'captured' }));
    const rep = buildReport({ playerName: 'Teste', mission, plan, config: cfg, vehicleName: 'Falcon 9', finalCostUSD: 250e6, launchOutcome: 'orbit', insertionState: 'captured', results, events: [], maneuvers: [], propellantRemainingKg: 60 });
    expect(rep.classification).toBe('sucesso');
    const empty = buildReport({ playerName: 'Teste', mission, plan, config: cfg, vehicleName: 'Falcon 9', finalCostUSD: 250e6, launchOutcome: 'orbit', insertionState: 'captured', results: [], events: [], maneuvers: [], propellantRemainingKg: 60 });
    expect(empty.scienceScore).toBe(0);
    expect(empty.classification).toBe('fracassada');
  });
});
