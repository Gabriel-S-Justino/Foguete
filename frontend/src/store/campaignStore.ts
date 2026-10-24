/**
 * Estado tipado da campanha (zustand), com persistência local e sincronização best-effort com o backend.
 * Regras de negócio ficam no motor (src/engine); o store apenas aplica decisões e guarda o estado.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AssistanceLevel, MissionId, TestCampaignId } from '../types/catalog';
import type {
  Campaign, CampaignStage, CheckpointResult, FlightEventRecord, FlightOutcome, ManeuverRecord, MissionPlan, MissionReport,
} from '../types/campaign';
import { catalogVersions, findVehicle, getMission } from '../engine/catalog';
import { canInstall, canRemove } from '../engine/entities/spacecraft';
import { defaultPlan } from '../engine/rules/mission-profile';
import { REFERENCE_ARCHITECTURES, referenceConfig } from '../engine/rules/presets';
import { validateMission } from '../engine/rules/validation';
import { buildReport } from '../engine/science/operations';
import { api } from '../services/api';

export const STAGE_ORDER: CampaignStage[] = ['identification', 'mission-select', 'hangar', 'vehicle', 'planning', 'briefing', 'launch-pad', 'flight', 'science', 'report'];
export const STAGE_LABEL: Record<CampaignStage, string> = {
  identification: 'Identificação', 'mission-select': 'Missão', hangar: 'Hangar da sonda', vehicle: 'Lançador', planning: 'Trajetória',
  briefing: 'Briefing', 'launch-pad': 'Plataforma', flight: 'Voo e manobras', science: 'Ciência', report: 'Relatório',
};

export const PLAYER_NAME_MAX = 32;

export function validatePlayerName(raw: string): { ok: boolean; value: string; error: string } {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, value, error: 'Informe um nome (não pode conter apenas espaços).' };
  if (value.length > PLAYER_NAME_MAX) return { ok: false, value, error: `Use no máximo ${PLAYER_NAME_MAX} caracteres.` };
  if (/[<>{}]/.test(value)) return { ok: false, value, error: 'Caracteres < > { } não são permitidos.' };
  return { ok: true, value, error: '' };
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function newCampaign(playerName: string, sessionId: string | null): Campaign {
  return {
    id: uid(), sessionId, playerName, missionId: null, assistance: 'iniciante', stage: 'mission-select',
    spacecraft: { installed: [], propellantKg: 0, testCampaign: 'standard' }, vehicleId: null, plan: null, validation: null,
    flightOutcome: 'pending', flightEvents: [], maneuvers: [], propellantRemainingKg: null, checkpointResults: [], activeEffects: [],
    insertionState: 'none', finalCostUSD: null, report: null, seed: Math.floor(Math.random() * 2 ** 31), attempt: 1,
    versions: { ...catalogVersions }, updatedAt: new Date().toISOString(),
  };
}

export interface GateResult { ok: boolean; reason: string }

/** Pré-condições de cada etapa: o jogador não avança sem as validações exigidas. */
export function canEnter(c: Campaign | null, stage: CampaignStage): GateResult {
  if (stage === 'identification') return { ok: true, reason: '' };
  if (!c) return { ok: false, reason: 'Identifique-se para começar.' };
  const launched = c.flightOutcome !== 'pending';
  const preLaunch: CampaignStage[] = ['mission-select', 'hangar', 'vehicle', 'planning', 'briefing', 'launch-pad'];
  if (launched && preLaunch.includes(stage) && !c.report) return { ok: false, reason: 'O lançamento já ocorreu: a configuração está congelada até o relatório.' };
  switch (stage) {
    case 'mission-select': return { ok: !launched || Boolean(c.report), reason: '' };
    case 'hangar': return c.missionId ? { ok: true, reason: '' } : { ok: false, reason: 'Escolha uma missão.' };
    case 'vehicle': {
      if (!c.missionId) return { ok: false, reason: 'Escolha uma missão.' };
      const hasBus = c.spacecraft.installed.length > 0;
      return hasBus ? { ok: true, reason: '' } : { ok: false, reason: 'Monte ao menos a estrutura principal da sonda.' };
    }
    case 'planning': return c.vehicleId ? { ok: true, reason: '' } : { ok: false, reason: 'Selecione um veículo de lançamento.' };
    case 'briefing': return c.plan && c.vehicleId ? { ok: true, reason: '' } : { ok: false, reason: 'Conclua o planejamento da trajetória.' };
    case 'launch-pad': {
      if (!c.missionId || !c.plan) return { ok: false, reason: 'Conclua o planejamento.' };
      const v = validateMission({ mission: getMission(c.missionId), config: c.spacecraft, vehicleId: c.vehicleId, plan: c.plan, assistance: c.assistance });
      return v.approved ? { ok: true, reason: '' } : { ok: false, reason: `Lançamento bloqueado: ${v.blockers.length} verificação(ões) obrigatória(s) reprovada(s).` };
    }
    case 'flight': return c.flightOutcome === 'orbit' ? { ok: true, reason: '' } : { ok: false, reason: 'A sonda ainda não está em órbita.' };
    case 'science': return c.flightOutcome === 'orbit' && (c.insertionState === 'captured' || c.insertionState === 'high-orbit') ? { ok: true, reason: '' } : { ok: false, reason: 'Conclua a inserção orbital.' };
    case 'report': return c.report || launched ? { ok: true, reason: '' } : { ok: false, reason: 'A missão ainda não terminou.' };
    default: return { ok: true, reason: '' };
  }
}

interface SessionState { sessionId: string | null; token: string | null }

interface Store {
  campaign: Campaign | null;
  session: SessionState;
  history: (MissionReport & { attempt: number })[];
  backend: { online: boolean; lastSync: string | null; message: string };
  notice: string;

  identify(name: string): Promise<GateResult>;
  goTo(stage: CampaignStage): GateResult;
  selectMission(id: MissionId, assistance: AssistanceLevel): void;
  installComponent(componentId: string): GateResult;
  removeComponent(instanceId: string): GateResult;
  setPropellant(kg: number): void;
  setTestCampaign(id: TestCampaignId): void;
  applySuggestion(): void;
  selectVehicle(id: string): void;
  updatePlan(patch: Partial<MissionPlan>): void;
  runValidation(): void;
  recordLaunch(outcome: FlightOutcome, events: FlightEventRecord[], effects: string[]): void;
  recordManeuver(record: ManeuverRecord, event: FlightEventRecord, propellantRemainingKg: number, insertion?: Campaign['insertionState']): void;
  recordEvent(event: FlightEventRecord, effect?: string): void;
  recordCheckpoint(result: CheckpointResult): void;
  finishMission(): Promise<void>;
  newAttempt(): void;
  resetAll(): void;
  sync(): Promise<void>;
  dismissNotice(): void;
}

function touch(c: Campaign): Campaign { return { ...c, updatedAt: new Date().toISOString() }; }

export const useCampaign = create<Store>()(persist((set, get) => {
  const patch = (fn: (c: Campaign) => Campaign) => {
    const c = get().campaign;
    if (!c) return;
    set({ campaign: touch(fn(c)) });
    void get().sync();
  };

  return {
    campaign: null,
    session: { sessionId: null, token: null },
    history: [],
    backend: { online: false, lastSync: null, message: 'Persistência local ativa' },
    notice: '',

    async identify(name) {
      const v = validatePlayerName(name);
      if (!v.ok) return { ok: false, reason: v.error };
      let session: SessionState = { sessionId: null, token: null };
      try {
        const s = await api.createSession(v.value);
        session = { sessionId: s.sessionId, token: s.token };
        set({ backend: { online: true, lastSync: new Date().toISOString(), message: 'Sincronizado com o servidor' } });
      } catch {
        set({ backend: { online: false, lastSync: null, message: 'Servidor indisponível: progresso salvo apenas neste navegador' } });
      }
      set({ session, campaign: newCampaign(v.value, session.sessionId) });
      void get().sync();
      return { ok: true, reason: '' };
    },

    goTo(stage) {
      const c = get().campaign;
      const gate = canEnter(c, stage);
      if (!gate.ok) { set({ notice: gate.reason }); return gate; }
      if (c) patch((x) => ({ ...x, stage }));
      return gate;
    },

    selectMission(id, assistance) {
      patch((c) => {
        const changed = c.missionId !== id;
        return {
          ...c, missionId: id, assistance, stage: 'hangar',
          spacecraft: changed ? { installed: [], propellantKg: 0, testCampaign: 'standard' } : c.spacecraft,
          vehicleId: changed ? null : c.vehicleId,
          plan: changed ? defaultPlan(getMission(id)) : c.plan ?? defaultPlan(getMission(id)),
          validation: null,
          // Após um relatório, escolher missão inicia nova tentativa com o estado de voo limpo
          ...(c.report ? {
            flightOutcome: 'pending' as const, flightEvents: [], maneuvers: [], propellantRemainingKg: null, checkpointResults: [], activeEffects: [],
            insertionState: 'none' as const, finalCostUSD: null, report: null, attempt: c.attempt + 1, seed: Math.floor(Math.random() * 2 ** 31),
          } : {}),
        };
      });
    },

    installComponent(componentId) {
      const c = get().campaign;
      if (!c) return { ok: false, reason: 'Sem campanha.' };
      const check = canInstall(c.spacecraft, componentId);
      if (!check.ok) { set({ notice: check.reason }); return { ok: false, reason: check.reason }; }
      patch((x) => ({ ...x, validation: null, spacecraft: { ...x.spacecraft, installed: [...x.spacecraft.installed, { instanceId: `${componentId}-${uid().slice(0, 8)}`, componentId }] } }));
      return { ok: true, reason: '' };
    },

    removeComponent(instanceId) {
      const c = get().campaign;
      if (!c) return { ok: false, reason: 'Sem campanha.' };
      const check = canRemove(c.spacecraft, instanceId);
      if (!check.ok) { set({ notice: check.reason }); return { ok: false, reason: check.reason }; }
      patch((x) => ({ ...x, validation: null, spacecraft: { ...x.spacecraft, installed: x.spacecraft.installed.filter((i) => i.instanceId !== instanceId) } }));
      return { ok: true, reason: '' };
    },

    setPropellant(kg) { patch((x) => ({ ...x, validation: null, spacecraft: { ...x.spacecraft, propellantKg: Math.max(0, Math.round(kg)) } })); },
    setTestCampaign(id) { patch((x) => ({ ...x, validation: null, spacecraft: { ...x.spacecraft, testCampaign: id } })); },

    applySuggestion() {
      patch((x) => {
        if (!x.missionId) return x;
        const ref = referenceConfig(x.missionId);
        return { ...x, validation: null, spacecraft: { ...ref, installed: ref.installed.map((i) => ({ ...i, instanceId: `${i.componentId}-${uid().slice(0, 8)}` })) } };
      });
    },

    selectVehicle(id) { if (findVehicle(id)) patch((x) => ({ ...x, vehicleId: id, validation: null })); },

    updatePlan(p) {
      patch((x) => (x.plan ? { ...x, validation: null, plan: { ...x.plan, ...p } as MissionPlan } : x));
    },

    runValidation() {
      patch((x) => {
        if (!x.missionId || !x.plan) return x;
        const r = validateMission({ mission: getMission(x.missionId), config: x.spacecraft, vehicleId: x.vehicleId, plan: x.plan, assistance: x.assistance });
        const { context: _ctx, ...report } = r;
        void _ctx;
        return { ...x, validation: report };
      });
    },

    recordLaunch(outcome, events, effects) {
      patch((x) => {
        const mission = x.missionId ? getMission(x.missionId) : null;
        return {
          ...x, flightOutcome: outcome, flightEvents: [...x.flightEvents, ...events], activeEffects: [...new Set([...x.activeEffects, ...effects])],
          propellantRemainingKg: x.spacecraft.propellantKg,
          stage: outcome === 'orbit' ? 'flight' : 'report',
          insertionState: outcome === 'orbit' && mission?.planning.type === 'earth-orbit' ? 'captured' : 'none',
        };
      });
      const c = get().campaign;
      if (c && get().session.token) void api.recordEvents(get().session.token!, c.id, events).catch(() => undefined);
      if (outcome !== 'orbit') void get().finishMission();
    },

    recordManeuver(record, event, remaining, insertion) {
      patch((x) => ({ ...x, maneuvers: [...x.maneuvers, record], flightEvents: [...x.flightEvents, event], propellantRemainingKg: remaining, insertionState: insertion ?? x.insertionState }));
    },

    recordEvent(event, effect) {
      patch((x) => ({ ...x, flightEvents: [...x.flightEvents, event], activeEffects: effect ? [...new Set([...x.activeEffects, effect])] : x.activeEffects }));
    },

    recordCheckpoint(result) {
      patch((x) => ({ ...x, checkpointResults: [...x.checkpointResults.filter((r) => r.checkpointId !== result.checkpointId), result] }));
    },

    async finishMission() {
      const c = get().campaign;
      if (!c || !c.missionId || !c.plan) return;
      const mission = getMission(c.missionId);
      const v = validateMission({ mission, config: c.spacecraft, vehicleId: c.vehicleId, plan: c.plan, assistance: c.assistance });
      const finalCost = v.context.budget.configurationUSD;
      let report = buildReport({
        playerName: c.playerName, mission, plan: c.plan, config: c.spacecraft, vehicleName: findVehicle(c.vehicleId)?.name ?? '—',
        finalCostUSD: finalCost, launchOutcome: c.flightOutcome, insertionState: c.insertionState, results: c.checkpointResults,
        events: c.flightEvents, maneuvers: c.maneuvers, propellantRemainingKg: c.propellantRemainingKg ?? 0,
      });
      const token = get().session.token;
      if (token) {
        try {
          // O backend recalcula e valida antes de aceitar o resultado final
          const r = await api.finalize(token, { ...c, report });
          report = r.report;
        } catch { /* mantém o relatório local */ }
      }
      patch((x) => ({ ...x, report, finalCostUSD: finalCost, stage: 'report' }));
      set({ history: [...get().history, { ...report, attempt: c.attempt }].slice(-20) });
    },

    newAttempt() {
      patch((x) => ({
        ...x, stage: 'hangar', flightOutcome: 'pending', flightEvents: [], maneuvers: [], propellantRemainingKg: null, checkpointResults: [],
        activeEffects: [], insertionState: 'none', finalCostUSD: null, report: null, validation: null, attempt: x.attempt + 1,
        seed: Math.floor(Math.random() * 2 ** 31), versions: { ...catalogVersions },
      }));
    },

    resetAll() { set({ campaign: null, session: { sessionId: null, token: null } }); },

    async sync() {
      const { campaign, session } = get();
      if (!campaign || !session.token) return;
      try {
        await api.saveCampaign(session.token, campaign);
        set({ backend: { online: true, lastSync: new Date().toISOString(), message: 'Campanha salva no servidor' } });
      } catch {
        set({ backend: { online: false, lastSync: get().backend.lastSync, message: 'Servidor indisponível: progresso salvo neste navegador' } });
      }
    },

    dismissNotice() { set({ notice: '' }); },
  };
}, {
  name: 'sma-campaign-v1',
  version: 1,
  storage: createJSONStorage(() => localStorage),
  partialize: (s) => ({ campaign: s.campaign, session: s.session, history: s.history }),
}));

export const referenceVehicleFor = (id: MissionId) => REFERENCE_ARCHITECTURES[id].vehicleId;
