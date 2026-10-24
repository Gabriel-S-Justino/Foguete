/** Cálculo de orçamento. A reserva de contingência é calculada uma única vez sobre o custo da configuração. */
import type { LaunchVehicle, MissionSpec, TestCampaignId } from '../../types/catalog';
import { missions } from '../catalog';

export interface BudgetBreakdown {
  availableUSD: number;
  componentsUSD: number;
  launchUSD: number;
  operationsUSD: number;
  testsUSD: number;
  configurationUSD: number;
  contingencyPct: number;
  contingencyUSD: number;
  committedUSD: number;
  balanceUSD: number;
  usedPct: number;
  overrunUSD: number;
  withinBudget: boolean;
}

export function computeBudget(
  mission: MissionSpec, componentsUSD: number, vehicle: LaunchVehicle | undefined, testCampaign: TestCampaignId,
): BudgetBreakdown {
  const available = mission.budget.availableUSD;
  const launchUSD = vehicle?.cost.usedUSD ?? 0;
  const operationsUSD = mission.budget.operationsCostUSD;
  const testsUSD = componentsUSD * missions.testCampaigns[testCampaign].costFactor;
  const configurationUSD = componentsUSD + launchUSD + operationsUSD + testsUSD;
  const contingencyPct = mission.budget.contingencyPct;
  const contingencyUSD = configurationUSD * (contingencyPct / 100);
  const committedUSD = configurationUSD + contingencyUSD;
  const balanceUSD = available - committedUSD;
  return {
    availableUSD: available,
    componentsUSD,
    launchUSD,
    operationsUSD,
    testsUSD,
    configurationUSD,
    contingencyPct,
    contingencyUSD,
    committedUSD,
    balanceUSD,
    usedPct: (committedUSD / available) * 100,
    overrunUSD: Math.max(0, -balanceUSD),
    withinBudget: balanceUSD >= 0,
  };
}

const BRL = missions.currencyPolicy.displayAlternatives.find((c) => c.code === 'BRL');

export function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}US$ ${(abs / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} bi`;
  if (abs >= 1e6) return `${sign}US$ ${(abs / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  return `${sign}US$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

/** Conversão ilustrativa para reais com taxa fixa configurada (não é cotação). */
export function formatBRL(valueUSD: number): string {
  if (!BRL) return '';
  const v = valueUSD * BRL.ratePerUSD;
  if (Math.abs(v) >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} bi*`;
  return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi*`;
}

export const brlNotice = BRL?.label ?? '';
