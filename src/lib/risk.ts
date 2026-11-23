// ─── Risk engine: stake sizing, daily loss cap, consecutive-loss stop ───────
import type { RiskState } from './types';

export const DEFAULT_RISK: RiskState = {
  consecutiveLosses: 0,
  dailyPnl: 0,
  dayKey: new Date().toISOString().slice(0, 10),
  stopped: false,
  tradesToday: 0,
};

export function currentDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function resetRiskIfNewDay(risk: RiskState): RiskState {
  const key = currentDayKey();
  if (risk.dayKey !== key) {
    return { ...DEFAULT_RISK, dayKey: key };
  }
  return risk;
}

/** Minimum contract stake on Deriv is ~0.35 USD; we cap by balance and 1% risk. */
export function computeStake(balance: number, riskPct: number): number {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  const raw = (balance * riskPct) / 100;
  const staked = Math.floor(raw * 100) / 100;
  return Math.max(0.35, staked);
}

/** Win rate (%) needed to break even given net payout r (e.g. 0.85). */
export function breakevenWinRate(payoutPct: number): number {
  return 100 / (1 + payoutPct / 100);
}

export interface RiskCheckInput {
  risk: RiskState;
  stake: number;
  balance: number;
  dailyLossPct: number;      // e.g. 3 → stop after losing 3% of daily baseline
  maxConsecLosses: number;   // e.g. 3
  baselineBalance: number;   // balance at start of day (or session)
  openPositions: number;
  maxOpenPositions?: number;
}

export interface RiskCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkRiskAllowsTrade(input: RiskCheckInput): RiskCheckResult {
  const { risk, stake, balance, dailyLossPct, maxConsecLosses, baselineBalance, openPositions } = input;
  const maxOpen = input.maxOpenPositions ?? 1;
  if (risk.stopped) return { ok: false, reason: risk.stoppedReason ?? 'Trading halted by risk rules' };
  if (risk.consecutiveLosses >= maxConsecLosses)
    return { ok: false, reason: `${risk.consecutiveLosses} consecutive losses — stop-loss rule hit` };
  const dailyLimit = (Math.max(baselineBalance, 0) * dailyLossPct) / 100;
  if (risk.dailyPnl <= -dailyLimit && dailyLimit > 0)
    return { ok: false, reason: `Daily loss limit reached (−${dailyLossPct}% = ${dailyLimit.toFixed(2)})` };
  if (openPositions >= maxOpen) return { ok: false, reason: 'A contract is already open' };
  if (stake <= 0) return { ok: false, reason: 'Invalid stake' };
  if (balance < stake) return { ok: false, reason: 'Insufficient balance' };
  return { ok: true };
}

/** Register a settled result; returns updated risk state (auto-stops on breach). */
export function applySettlement(risk: RiskState, pnl: number, dailyLossPct: number, baselineBalance: number, maxConsecLosses: number): RiskState {
  const next: RiskState = {
    ...risk,
    dailyPnl: risk.dailyPnl + pnl,
    tradesToday: risk.tradesToday + 1,
    consecutiveLosses: pnl > 0 ? 0 : risk.consecutiveLosses + 1,
  };
  const dailyLimit = (Math.max(baselineBalance, 0) * dailyLossPct) / 100;
  if (next.consecutiveLosses >= maxConsecLosses) {
    next.stopped = true;
    next.stoppedReason = `${next.consecutiveLosses} consecutive losses — bot halted for today`;
  } else if (dailyLimit > 0 && next.dailyPnl <= -dailyLimit) {
    next.stopped = true;
    next.stoppedReason = `Daily loss limit reached (${dailyLossPct}%) — bot halted for today`;
  }
  return next;
}
