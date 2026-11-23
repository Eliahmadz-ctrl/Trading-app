// ─── Shared domain types ─────────────────────────────────────────────────────

export interface Candle {
  /** epoch seconds of candle open */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type DerivWsStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'authorized'
  | 'disconnected'
  | 'error';

export interface ActiveSymbol {
  symbol: string;
  display_name: string;
  market: string;
  submarket: string;
  exchange_is_open: number | boolean;
  is_trading_suspended: number | boolean;
  pip?: number;
}

export interface AccountInfo {
  loginid: string;
  balance: number;
  currency: string;
  isVirtual: boolean;
  email?: string;
}

export interface StrategyParams {
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  rsiPeriod: number;
  adxPeriod: number;
  atrPeriod: number;
  rsiRiseLow: number;
  rsiRiseHigh: number;
  rsiFallLow: number;
  rsiFallHigh: number;
  adxMin: number;
  /** previous candle body must be >= this fraction of its total range */
  bodyRatioMin: number;
  /** block when |close - emaFast| > atrExtensionMax * ATR (chasing extended moves) */
  atrExtensionMax: number;
  /** count of EMA9/21 sign flips within lookback that triggers the churn filter */
  churnLookback: number;
  churnMaxCrosses: number;
  /** M5 trend EMA period (direction filter) */
  m5TrendPeriod: number;
  /** minimum score (0–8) required to take the trade */
  scoreMin: number;
}

export type SignalDirection = 'RISE' | 'FALL';

export interface ConditionCheck {
  id: string;
  label: string;
  ok: boolean;
  /** score contribution when ok */
  points: number;
  mandatory: boolean;
  detail: string;
}

export type SignalClass = 'FULL' | 'STRONG' | 'WEAK' | 'NONE';

export interface SignalResult {
  /** 'NO_TRADE' when nothing qualifies */
  direction: SignalDirection | 'NO_TRADE';
  /** higher-scoring side regardless of tradeability (for display) */
  lean: SignalDirection | null;
  score: number;
  maxScore: 8;
  classification: SignalClass;
  /** all three mandatory groups pass (M5, EMA alignment, RSI band) */
  mandatoryOk: boolean;
  /** ADX / candle-body / close-vs-EMA9 / churn / extension filters pass */
  filtersOk: boolean;
  tradeable: boolean;
  blockedBy: string[];
  checks: ConditionCheck[];
  filters: ConditionCheck[];
  metrics: {
    emaFast: number;
    emaSlow: number;
    emaTrend: number;
    rsi: number;
    adx: number;
    atr: number;
    plusDI: number;
    minusDI: number;
    prevOpen: number;
    prevHigh: number;
    prevLow: number;
    prevClose: number;
    prevBullish: boolean;
    bodyRatio: number;
    m5Close: number;
    m5EmaTrend: number;
    m5Bullish: boolean;
    closeVsEmaFastAtr: number;
    atrPct: number;
  };
  /** epoch (s) of the candle this prediction is FOR (i.e. next candle open) */
  targetTime: number;
  /** human readable one-line summary */
  summary: string;
}

export interface PredictionLogEntry {
  id: string;
  /** epoch (s) of the candle this prediction TARGETS */
  targetTime: number;
  symbol: string;
  direction: SignalDirection | 'LEAN_RISE' | 'LEAN_FALL';
  lean: SignalDirection | null;
  tradeable: boolean;
  score: number;
  rsi: number;
  adx: number;
  /** graded once the target candle closes */
  actual?: SignalDirection | 'TIE' | null;
  correct?: boolean | null;
}

export type JournalMode = 'paper' | 'demo' | 'live';

export interface JournalEntry {
  id: string;
  epoch: number;
  symbol: string;
  mode: JournalMode;
  direction: SignalDirection;
  score: number;
  stake: number;
  currency: string;
  payoutPct: number;
  entryPrice: number;
  exitPrice?: number;
  result?: 'WIN' | 'LOSS' | 'TIE';
  pnl?: number;
  contractId?: number | string;
  settledAt?: number;
  note?: string;
}

export interface RiskState {
  consecutiveLosses: number;
  dailyPnl: number;
  dayKey: string;
  stopped: boolean;
  stoppedReason?: string;
  tradesToday: number;
}
