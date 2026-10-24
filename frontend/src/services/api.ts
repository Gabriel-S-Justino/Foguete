/**
 * Cliente da API versionada (/api/v1). Todas as chamadas são tolerantes a falhas: o jogo continua
 * jogável offline (persistência local) e sincroniza quando o backend estiver disponível.
 */
import type { Campaign, MissionReport } from '../types/campaign';
import { getMission } from '../engine/catalog';
import { validateMission } from '../engine/rules/validation';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';

export interface SessionInfo { sessionId: string; token: string; playerName: string }

/** Resultado da revalidação no servidor (ids e status iguais aos do motor local). */
export interface ServerValidation {
  approved: boolean;
  checks: Record<string, string>;
  blockers: string[];
  warnings: string[];
  computedAt: string;
  engineVersion: string;
  serverMetrics: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit & { token?: string; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${BASE}/v1${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { 'X-Session-Token': init.token } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = ((await res.json()) as { detail?: string }).detail ?? detail; } catch { /* corpo não-JSON */ }
      throw new ApiError(res.status, String(detail));
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request<{ status: string; database: string; version: string }>('/health', { timeoutMs: 3000 }),
  createSession: (playerName: string) => request<SessionInfo>('/sessions', { method: 'POST', body: JSON.stringify({ playerName }) }),
  saveCampaign: (token: string, campaign: Campaign) =>
    request<{ id: string; revision: number }>(`/campaigns/${campaign.id}`, { method: 'PUT', token, body: JSON.stringify(serializeCampaign(campaign)) }),
  getCampaign: (token: string, id: string) => request<{ campaign: Campaign }>(`/campaigns/${id}`, { token }),
  listCampaigns: (token: string) => request<{ campaigns: { id: string; missionId: string | null; stage: string; attempt: number; updatedAt: string }[] }>('/campaigns', { token }),
  validate: (token: string, campaign: Campaign) =>
    request<ServerValidation>(`/campaigns/${campaign.id}/validate`, { method: 'POST', token, body: JSON.stringify(serializeCampaign(campaign)) }),
  recordEvents: (token: string, campaignId: string, events: Campaign['flightEvents']) =>
    request<{ stored: number }>(`/campaigns/${campaignId}/events`, { method: 'POST', token, body: JSON.stringify({ events }) }),
  finalize: (token: string, campaign: Campaign) =>
    request<{ report: MissionReport; serverChecks: { approved: boolean; blockers: string[] } }>(`/campaigns/${campaign.id}/finalize`, { method: 'POST', token, body: JSON.stringify(serializeCampaign(campaign)) }),
  listReports: (token: string) => request<{ reports: (MissionReport & { attempt: number })[] }>('/reports', { token }),
};

/**
 * Remove dados volumosos antes do envio e anexa o perfil de Δv calculado pelo motor orbital
 * (o servidor recalcula massa, custo, capacidade e Δv disponível por conta própria).
 */
function serializeCampaign(c: Campaign) {
  let derived = null;
  if (c.missionId && c.plan) {
    const p = validateMission({ mission: getMission(c.missionId), config: c.spacecraft, vehicleId: c.vehicleId, plan: c.plan, assistance: c.assistance }).context.profile;
    derived = { requiredDvMS: p.requiredDvMS, totalDvMS: p.totalDvMS, launchProfile: p.launchProfile };
  }
  return { ...c, derived, validation: c.validation ? { approved: c.validation.approved, blockers: c.validation.blockers.map((b) => b.id) } : null };
}
