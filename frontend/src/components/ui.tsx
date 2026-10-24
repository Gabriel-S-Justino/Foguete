import type { ReactNode } from 'react';
import { getSource } from '../engine/catalog';
import type { ValidationStatus } from '../types/catalog';
import type { CheckStatus } from '../types/campaign';

export function Panel({ title, actions, children, className = '', bodyClass = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel ${className}`}>
      {title !== undefined && <div className="panel-title"><h2>{title}</h2>{actions}</div>}
      <div className={`panel-body ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, meter, testId }: { label: string; value: ReactNode; sub?: ReactNode; meter?: number; testId?: string }) {
  const cls = meter === undefined ? '' : meter > 1 ? 'over' : meter > 0.9 ? 'near' : '';
  return (
    <div className="panel stat" data-testid={testId}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
      {meter !== undefined && <div className={`meter ${cls}`}><div style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }} /></div>}
    </div>
  );
}

export function StatusChip({ status }: { status: CheckStatus | ValidationStatus | string }) {
  const cls = status === 'aprovada' || status === 'validado' || status === 'ok' ? 'ok'
    : status === 'aviso' || status === 'aproximado' || status === 'derivado' || status === 'didático' ? 'warn'
      : status === 'reprovada' || status === 'pendente' || status === 'falha' ? 'bad' : 'info';
  return <span className={`chip ${cls}`}>{status}</span>;
}

export function SourceRef({ id }: { id: string | null | undefined }) {
  const s = getSource(id);
  if (!s) return null;
  const href = s.url.startsWith('http') ? s.url : undefined;
  return (
    <span className="small muted" title={s.notes}>
      Fonte: {href ? <a href={href} target="_blank" rel="noreferrer">{s.title}</a> : s.title}{s.verified ? '' : ' (conferência pendente)'}
    </span>
  );
}

export const fmtKg = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
export const fmtW = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} W`;
export const fmtMs = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m/s`;
