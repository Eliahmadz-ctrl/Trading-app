// ─── Walk-forward backtester for the M1 NEXT-CANDLE strategy ────────────────
import type { Candle, StrategyParams, SignalResult } from './types';
import { computeIndicators, evaluateAt, DEFAULT_PARAMS } from './strategy';

export interface BacktestTrade {
  epoch: number;
  targetTime: number;
  direction: 'RISE' | 'FALL';
  score: number;
  classification: SignalResult['classification'];
  entry: number;
  exit: number;
  outcome: 'WIN' | 'LOSS' | 'TIE';
  rsi: number;
  adx: number;
  hour: number; // UTC hour of the target candle
}

export interface BacktestStats {
  trades: number;
  wins: number;
  losses: number;
  ties: number;
  accuracy: number;      // 0..100 (wins only; ties count as losses)
  riseTrades: number;
  riseWins: number;
  riseAccuracy: number;
  fallTrades: number;
  fallWins: number;
  fallAccuracy: number;
  totalPnlUnits: number;  // P/L in units of stake
  totalPnl: number;       // P/L in currency at chosen stake
  expectancyUnits: number;
  expectancy: number;     // per trade, currency
  per100: number;         // expected P/L per 100 trades, currency
  profitFactor: number;
  maxConsecLosses: number;
  maxDrawdownUnits: number;
  breakeven: number;      // win rate needed at payout
  payoutPct: number;
  byHour: { hour: number; trades: number; wins: number; accuracy: number; pnl: number }[];
  equity: { x: number; y: number }[];   // cumulative P/L (units) per trade
  edgeOverBreakeven: number;            // accuracy − breakeven (percentage points)
}

export interface BacktestResult {
  trades: BacktestTrade[];
  stats: BacktestStats;
}

export function breakevenWinRate(payoutPct: number): number {
  const r = payoutPct / 100;
  return 100 / (1 + r);
}

export function summarizeTrades(trades: BacktestTrade[], payoutPct: number, stake: number): BacktestStats {
  const r = payoutPct / 100;
  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const ties = trades.filter(t => t.outcome === 'TIE').length;
  const losses = trades.length - wins - ties;
  const totalPnlUnits = wins * r - (losses + ties) * 1;
  const expectancyUnits = trades.length ? totalPnlUnits / trades.length : 0;

  // Max consecutive losses (ties count as losses)
  let maxConsec = 0, run = 0;
  for (const t of trades) {
    if (t.outcome === 'WIN') run = 0;
    else { run += 1; maxConsec = Math.max(maxConsec, run); }
  }

  // Equity curve + max drawdown (units)
  let cum = 0, peak = 0, maxDD = 0;
  const equity: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  trades.forEach((t, i) => {
    cum += t.outcome === 'WIN' ? r : -1;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
    equity.push({ x: i + 1, y: cum });
  });

  const rise = trades.filter(t => t.direction === 'RISE');
  const fall = trades.filter(t => t.direction === 'FALL');
  const riseWins = rise.filter(t => t.outcome === 'WIN').length;
  const fallWins = fall.filter(t => t.outcome === 'WIN').length;

  // Per UTC hour
  const hourMap = new Map<number, { trades: number; wins: number; pnl: number }>();
  for (const t of trades) {
    const h = hourMap.get(t.hour) ?? { trades: 0, wins: 0, pnl: 0 };
    h.trades += 1;
    if (t.outcome === 'WIN') { h.wins += 1; h.pnl += r; } else h.pnl -= 1;
    hourMap.set(t.hour, h);
  }
  const byHour = [...hourMap.entries()]
    .map(([hour, v]) => ({ hour, trades: v.trades, wins: v.wins, accuracy: (v.wins / v.trades) * 100, pnl: v.pnl * stake }))
    .sort((a, b) => a.hour - b.hour);

  const grossWin = wins * r;
  const grossLoss = losses + ties;
  const be = breakevenWinRate(payoutPct);
  const acc = trades.length ? (wins / trades.length) * 100 : 0;

  return {
    trades: trades.length,
    wins, losses, ties,
    accuracy: acc,
    riseTrades: rise.length, riseWins,
    riseAccuracy: rise.length ? (riseWins / rise.length) * 100 : 0,
    fallTrades: fall.length, fallWins,
    fallAccuracy: fall.length ? (fallWins / fall.length) * 100 : 0,
    totalPnlUnits,
    totalPnl: totalPnlUnits * stake,
    expectancyUnits,
    expectancy: expectancyUnits * stake,
    per100: expectancyUnits * stake * 100,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss,
    maxConsecLosses: maxConsec,
    maxDrawdownUnits: maxDD,
    breakeven: be,
    payoutPct,
    byHour,
    equity,
    edgeOverBreakeven: acc - be,
  };
}

export interface RunOptions {
  stake: number;
  payoutPct: number;
  scoreMin?: number;
  /** restrict to candle indices [fromIdx, toIdx) — for walk-forward splits */
  fromIdx?: number;
  toIdx?: number;
}

/** Run the strategy over history. `atIndex` = index of last completed candle before the target. */
export function runBacktest(m1: Candle[], m5: Candle[], params: StrategyParams, opts: RunOptions): BacktestResult {
  const bundle = computeIndicators(m1, m5, params);
  const trades: BacktestTrade[] = [];
  const warmup = Math.max(params.emaTrend, params.adxPeriod * 2 + 1, params.rsiPeriod + 1, 60);
  const from = Math.max(warmup, opts.fromIdx ?? warmup);
  const to = Math.min(m1.length - 1, opts.toIdx ?? m1.length - 1); // need index+1 for outcome
  const p = { ...params, scoreMin: opts.scoreMin ?? params.scoreMin };

  for (let i = from; i < to; i++) {
    const target = m1[i + 1];
    const sig = evaluateAt(m1, bundle, p, { atIndex: i, targetTime: target.time });
    if (!sig.tradeable || sig.direction === 'NO_TRADE') continue;
    const dir = sig.direction;
    const actual = target.close > target.open ? 'RISE' : target.close < target.open ? 'FALL' : 'TIE';
    const outcome: BacktestTrade['outcome'] = actual === 'TIE' ? 'TIE' : actual === dir ? 'WIN' : 'LOSS';
    trades.push({
      epoch: m1[i].time,
      targetTime: target.time,
      direction: dir,
      score: sig.score,
      classification: sig.classification,
      entry: target.open,
      exit: target.close,
      outcome,
      rsi: sig.metrics.rsi,
      adx: sig.metrics.adx,
      hour: new Date(target.time * 1000).getUTCHours(),
    });
  }
  return { trades, stats: summarizeTrades(trades, opts.payoutPct, opts.stake) };
}

// ─── Walk-forward 60/20/20 evaluation ───────────────────────────────────────

export interface SplitEvaluation {
  n1: number;
  devEnd: number;
  valEnd: number;
  dev: BacktestStats;
  val: BacktestStats;
  test: BacktestStats;
  full: BacktestStats;
  bestCombo: StrategyParams;
  bestValAccuracy: number;
  bestTestAccuracy: number;
  bestTestTrades: number;
  bestValStats: BacktestStats;
  bestTestStats: BacktestStats;
  grid: { params: StrategyParams; devAcc: number; valAcc: number; testAcc: number; devTrades: number; valTrades: number; testTrades: number }[];
  overfitGap: number; // val − test (percentage points)
}

const GRID: { emaFast: number; emaSlow: number; adxMin: number }[] = (() => {
  const out: { emaFast: number; emaSlow: number; adxMin: number }[] = [];
  for (const emaFast of [7, 9, 12])
    for (const emaSlow of [18, 21, 26])
      for (const adxMin of [20, 25])
        if (emaFast < emaSlow) out.push({ emaFast, emaSlow, adxMin });
  return out;
})();

export function walkForwardSplit(m1: Candle[], m5: Candle[], base: StrategyParams, stake: number, payoutPct: number): SplitEvaluation {
  const n = m1.length;
  const devEnd = Math.floor(n * 0.6);
  const valEnd = Math.floor(n * 0.8);

  // As-configured stats across segments
  const dev = runBacktest(m1, m5, base, { stake, payoutPct, fromIdx: 0, toIdx: devEnd }).stats;
  const val = runBacktest(m1, m5, base, { stake, payoutPct, fromIdx: devEnd, toIdx: valEnd }).stats;
  const test = runBacktest(m1, m5, base, { stake, payoutPct, fromIdx: valEnd, toIdx: n }).stats;
  const full = runBacktest(m1, m5, base, { stake, payoutPct }).stats;

  // Parameter selection: fit on dev, select on val, report on test
  const grid = GRID.map(g => {
    const params: StrategyParams = { ...base, ...g };
    const d = runBacktest(m1, m5, params, { stake, payoutPct, fromIdx: 0, toIdx: devEnd });
    const v = runBacktest(m1, m5, params, { stake, payoutPct, fromIdx: devEnd, toIdx: valEnd });
    const t = runBacktest(m1, m5, params, { stake, payoutPct, fromIdx: valEnd, toIdx: n });
    return {
      params,
      devAcc: d.stats.accuracy, valAcc: v.stats.accuracy, testAcc: t.stats.accuracy,
      devTrades: d.stats.trades, valTrades: v.stats.trades, testTrades: t.stats.trades,
    };
  });

  // Rank by validation accuracy, requiring at least 15 val trades when possible
  const ranked = [...grid].sort((a, b) => {
    const aOk = a.valTrades >= 15 ? 1 : 0, bOk = b.valTrades >= 15 ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    return b.valAcc - a.valAcc || b.valTrades - a.valTrades;
  });
  const best = ranked[0];
  const bestCombo = best?.params ?? base;
  const bestTest = runBacktest(m1, m5, bestCombo, { stake, payoutPct, fromIdx: valEnd, toIdx: n });
  const bestVal = runBacktest(m1, m5, bestCombo, { stake, payoutPct, fromIdx: devEnd, toIdx: valEnd });

  return {
    n1: n,
    devEnd, valEnd,
    dev, val, test, full,
    bestCombo,
    bestValAccuracy: best?.valAcc ?? 0,
    bestTestAccuracy: best?.testAcc ?? 0,
    bestTestTrades: best?.testTrades ?? 0,
    bestValStats: bestVal.stats,
    bestTestStats: bestTest.stats,
    grid: grid.map(g => g),
    overfitGap: (best?.valAcc ?? 0) - (best?.testAcc ?? 0),
  };
}

export { DEFAULT_PARAMS };
