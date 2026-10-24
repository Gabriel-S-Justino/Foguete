/**
 * Vetores de teste compartilhados com o backend (data/test-vectors/validation-vectors.json).
 * O backend reimplementa as regras críticas em Python e precisa produzir os mesmos resultados.
 * Para regenerar após mudanças intencionais: UPDATE_VECTORS=1 npx vitest run vectors
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMission } from '../catalog';
import { defaultPlan } from '../rules/mission-profile';
import { REFERENCE_ARCHITECTURES, referenceConfig } from '../rules/presets';
import { SERVER_CHECK_PREFIXES, validateMission } from '../rules/validation';
import type { AssistanceLevel, MissionId } from '../../types/catalog';
import type { SpacecraftConfig } from '../../types/campaign';

const FILE = new URL('../../../../data/test-vectors/validation-vectors.json', import.meta.url);

interface Case { name: string; missionId: MissionId; vehicleId: string | null; assistance: AssistanceLevel; config: SpacecraftConfig }

function cases(): Case[] {
  const out: Case[] = [];
  for (const id of ['leo-climate', 'lunar-he3', 'jupiter-system'] as MissionId[]) {
    const ref = referenceConfig(id);
    const vehicleId = REFERENCE_ARCHITECTURES[id].vehicleId;
    out.push({ name: `${id}-referencia`, missionId: id, vehicleId, assistance: 'iniciante', config: ref });
    out.push({ name: `${id}-avancado`, missionId: id, vehicleId, assistance: 'avancado', config: ref });
    out.push({ name: `${id}-sem-propelente`, missionId: id, vehicleId, assistance: 'intermediario', config: { ...ref, propellantKg: 0 } });
    out.push({ name: `${id}-tanque-excedido`, missionId: id, vehicleId, assistance: 'iniciante', config: { ...ref, propellantKg: ref.propellantKg + 100000 } });
    out.push({ name: `${id}-sem-veiculo`, missionId: id, vehicleId: null, assistance: 'iniciante', config: ref });
    out.push({ name: `${id}-starship-pendente`, missionId: id, vehicleId: 'starship', assistance: 'iniciante', config: ref });
    out.push({ name: `${id}-sls`, missionId: id, vehicleId: 'sls', assistance: 'iniciante', config: ref });
    out.push({ name: `${id}-sem-barramento`, missionId: id, vehicleId, assistance: 'iniciante', config: { ...ref, installed: ref.installed.filter((i) => !i.componentId.startsWith('bus')) } });
    out.push({ name: `${id}-testes-extensivos`, missionId: id, vehicleId, assistance: 'iniciante', config: { ...ref, testCampaign: 'extensive' } });
  }
  return out;
}

function compute(c: Case) {
  const mission = getMission(c.missionId);
  const plan = defaultPlan(mission);
  const r = validateMission({ mission, config: c.config, vehicleId: c.vehicleId, plan, assistance: c.assistance });
  const checks = Object.fromEntries(r.checks.filter((x) => SERVER_CHECK_PREFIXES.some((p) => x.id.startsWith(p))).map((x) => [x.id, x.status]));
  return {
    input: { missionId: c.missionId, vehicleId: c.vehicleId, assistance: c.assistance, spacecraft: c.config, plan, derived: { requiredDvMS: r.context.profile.requiredDvMS, totalDvMS: r.context.profile.totalDvMS, launchProfile: r.context.profile.launchProfile } },
    expected: {
      dryMassKg: r.context.summary.dryMassKg,
      wetMassKg: r.context.summary.wetMassKg,
      componentCostUSD: r.context.summary.componentCostUSD,
      committedUSD: r.context.budget.committedUSD,
      deltaVAvailableMS: r.context.summary.deltaVAvailableMS,
      checks,
      approved: Object.values(checks).every((s) => s !== 'reprovada'),
    },
  };
}

describe('vetores compartilhados frontend/backend', () => {
  const generated = cases().map((c) => ({ name: c.name, ...compute(c) }));
  if (process.env.UPDATE_VECTORS) {
    writeFileSync(FILE, `${JSON.stringify({ description: 'Gerado pelo motor TypeScript (vectors.test.ts). O backend deve reproduzir os mesmos resultados.', cases: generated }, null, 2)}\n`);
  }
  const stored = JSON.parse(readFileSync(FILE, 'utf8')) as { cases: typeof generated };
  it('os vetores gravados correspondem ao motor atual', () => {
    expect(stored.cases.length).toBe(generated.length);
    for (const [i, g] of generated.entries()) {
      const s = stored.cases[i]!;
      expect(s.name).toBe(g.name);
      expect(s.expected.checks).toEqual(g.expected.checks);
      expect(s.expected.approved).toBe(g.expected.approved);
      expect(s.expected.wetMassKg).toBeCloseTo(g.expected.wetMassKg, 6);
      expect(s.expected.committedUSD).toBeCloseTo(g.expected.committedUSD, 2);
      expect(s.expected.deltaVAvailableMS).toBeCloseTo(g.expected.deltaVAvailableMS, 6);
    }
  });
  it('cobre aprovação e reprovação', () => {
    expect(generated.some((g) => g.expected.approved)).toBe(true);
    expect(generated.some((g) => !g.expected.approved)).toBe(true);
  });
});
