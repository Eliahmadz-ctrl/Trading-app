// ─── M1 NEXT-CANDLE strategy engine ─────────────────────────────────────────
// Liquidity Sweep + EMA + RSI + Candle Momentum — rule-based next-candle
// prediction. Every evaluation uses ONLY completed candles (no look-ahead).

import type { Candle, SignalResult, StrategyParams, ConditionCheck, SignalDirection, SignalClass } from './types';
import { adx, atr, ema, rsi } from './indicators';

export const DEFAULT_PARAMS: StrategyParams = {
  emaFast: 9,
  emaSlow: 21,
  emaTrend: 50,
  rsiPeriod: 14,
  adxPeriod: 14,
  atrPeriod: 14,
  rsiRiseLow: 52,
  rsiRiseHigh: 68,
  rsiFallLow: 32,
  rsiFallHigh: 48,
  adxMin: 20,
  bodyRatioMin: 0.5,
  atrExtensionMax: 2.0,
  churnLookback: 12,
  churnMaxCrosses: 4,
  m5TrendPeriod: 50,
  scoreMin: 7,
};

export interface IndicatorBundle {
  closes: number[];
  emaFast: number[];
  emaSlow: number[];
  emaTrend: number[];
  rsi: number[];
  atr: number[];
  adx: number[];
  plusDI: number[];
  minusDI: number[];
  /** per M1 index i: index of last completed M5 candle usable at t[i] (−1 if none) */
  m5IndexFor: Int32Array;
  m5Close: number[];
  m5EmaTrend: number[];
  /** sign flips of (emaFast − emaSlow) in the window ending at i */
  crossesUpTo: number[];
  n: number;
}

/** Compute the full indicator bundle once; reused by live evaluation and backtests. */
export function computeIndicators(m1: Candle[], m5: Candle[], p: StrategyParams): IndicatorBundle {
  const closes = m1.map(c => c.close);
  const emaFast = ema(closes, p.emaFast);
  const emaSlow = ema(closes, p.emaSlow);
  const emaTrend = ema(closes, p.emaTrend);
  const rsiArr = rsi(closes, p.rsiPeriod);
  const atrArr = atr(m1, p.atrPeriod);
  const { adx: adxArr, plusDI, minusDI } = adx(m1, p.adxPeriod);

  // M5 trend EMA, and for each M1 bar the last M5 candle completed before it opens
  const m5Closes = m5.map(c => c.close);
  const m5EmaTrendFull = ema(m5Closes, p.m5TrendPeriod);
  const m5IndexFor = new Int32Array(m1.length).fill(-1);
  const m5CloseArr = new Array<number>(m1.length).fill(NaN);
  const m5EmaTrendArr = new Array<number>(m1.length).fill(NaN);
  let j = -1;
  for (let i = 0; i < m1.length; i++) {
    const t = m1[i].time;
    while (j + 1 < m5.length && m5[j + 1].time + 300 <= t) j++;
    m5IndexFor[i] = j;
    if (j >= 0) {
      m5CloseArr[i] = m5[j].close;
      m5EmaTrendArr[i] = m5EmaTrendFull[j];
    }
  }

  // EMA churn: count sign flips of (emaFast − emaSlow) within lookback window
  const crossesUpTo = new Array<number>(m1.length).fill(0);
  const diff = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const flipPrefix = new Array<number>(m1.length).fill(0);
  for (let i = 1; i < m1.length; i++) {
    const prevSign = Math.sign(diff[i - 1]);
    const sign = Math.sign(diff[i]);
    flipPrefix[i] = flipPrefix[i - 1] + (prevSign !== 0 && sign !== 0 && prevSign !== sign ? 1 : 0);
  }
  for (let i = 0; i < m1.length; i++) {
    const from = Math.max(0, i - p.churnLookback);
    crossesUpTo[i] = flipPrefix[i] - (from > 0 ? flipPrefix[from] : 0);
  }

  return {
    closes, emaFast, emaSlow, emaTrend, rsi: rsiArr, atr: atrArr,
    adx: adxArr, plusDI, minusDI, m5IndexFor, m5Close: m5CloseArr,
    m5EmaTrend: m5EmaTrendArr, crossesUpTo, n: m1.length,
  };
}

export interface EvalOptions {
  /** index of the LAST COMPLETED candle to evaluate on */
  atIndex: number;
  /** candles this prediction targets — epoch seconds */
  targetTime: number;
}

function fmt(n: number, digits = 5): string {
  if (!Number.isFinite(n)) return '—';
  return n.toPrecision(digits);
}

/** Evaluate the strategy at the boundary AFTER candle `atIndex` (predicting the next candle). */
export function evaluateAt(m1: Candle[], bundle: IndicatorBundle, p: StrategyParams, opts: EvalOptions): SignalResult {
  const i = opts.atIndex;
  const prev = m1[i];
  const body = Math.abs(prev.close - prev.open);
  const range = prev.high - prev.low;
  const bodyRatio = range > 0 ? body / range : 0;
  const prevBullish = prev.close > prev.open;
  const prevBearish = prev.close < prev.open;

  const ef = bundle.emaFast[i];
  const es = bundle.emaSlow[i];
  const et = bundle.emaTrend[i];
  const rsiV = bundle.rsi[i];
  const adxV = bundle.adx[i];
  const atrV = bundle.atr[i];
  const close = prev.close;
  const m5i = bundle.m5IndexFor[i];
  const m5Close = bundle.m5Close[i];
  const m5EmaT = bundle.m5EmaTrend[i];
  const hasM5 = m5i >= 0 && Number.isFinite(m5EmaT);
  const m5Bullish = hasM5 ? m5Close > (m5EmaT as number) : false;
  const churn = bundle.crossesUpTo[i];
  const extAtr = Number.isFinite(atrV) && atrV > 0 ? Math.abs(close - ef) / atrV : 0;
  const deadRsi = rsiV > 48 && rsiV < 52;

  const side = (direction: SignalDirection) => {
    const rise = direction === 'RISE';
    const checks: ConditionCheck[] = [
      {
        id: 'm5', points: 2, mandatory: true,
        label: rise ? 'M5 close above M5 EMA-50' : 'M5 close below M5 EMA-50',
        ok: hasM5 ? (rise ? m5Bullish : !m5Bullish) : false,
        detail: hasM5 ? `M5 close ${fmt(m5Close)} vs EMA-50 ${fmt(m5EmaT as number)}` : 'M5 history not available',
      },
      {
        id: 'emaFastSlow', points: 2, mandatory: true,
        label: rise ? 'EMA-9 above EMA-21' : 'EMA-9 below EMA-21',
        ok: rise ? ef > es : ef < es,
        detail: `EMA-9 ${fmt(ef)} · EMA-21 ${fmt(es)}`,
      },
      {
        id: 'emaTrend', points: 1, mandatory: false,
        label: rise ? 'Close above EMA-50' : 'Close below EMA-50',
        ok: rise ? close > et : close < et,
        detail: `Close ${fmt(close)} vs EMA-50 ${fmt(et)}`,
      },
      {
        id: 'rsi', points: 1, mandatory: true,
        label: rise ? `RSI between ${p.rsiRiseLow}–${p.rsiRiseHigh}` : `RSI between ${p.rsiFallLow}–${p.rsiFallHigh}`,
        ok: rise ? rsiV >= p.rsiRiseLow && rsiV <= p.rsiRiseHigh : rsiV >= p.rsiFallLow && rsiV <= p.rsiFallHigh,
        detail: `RSI-14 ${Number.isFinite(rsiV) ? rsiV.toFixed(2) : '—'}`,
      },
      {
        id: 'adx', points: 1, mandatory: false,
        label: `ADX above ${p.adxMin} (trend strength)`,
        ok: Number.isFinite(adxV) && adxV > p.adxMin,
        detail: `ADX-14 ${Number.isFinite(adxV) ? adxV.toFixed(2) : '—'}`,
      },
      {
        id: 'prevDir', points: 0, mandatory: true,
        label: rise ? 'Previous candle closed bullish' : 'Previous candle closed bearish',
        ok: rise ? prevBullish : prevBearish,
        detail: `O ${fmt(prev.open)} → C ${fmt(prev.close)}`,
      },
      {
        id: 'body', points: 0, mandatory: true,
        label: `Body ≥ ${Math.round(p.bodyRatioMin * 100)}% of candle range`,
        ok: bodyRatio >= p.bodyRatioMin,
        detail: `Body ${(bodyRatio * 100).toFixed(1)}% of range`,
      },
      {
        id: 'closeVsEmaFast', points: 0, mandatory: true,
        label: rise ? 'Previous close above EMA-9' : 'Previous close below EMA-9',
        ok: rise ? close > ef : close < ef,
        detail: `Close ${fmt(close)} vs EMA-9 ${fmt(ef)}`,
      },
      // Scored “strong previous candle”: Direction + body filter in one point
      {
        id: 'strongCandle', points: 1, mandatory: false,
        label: 'Strong previous candle (scored)',
        ok: (rise ? prevBullish : prevBearish) && bodyRatio >= p.bodyRatioMin,
        detail: (rise ? prevBullish : prevBearish) ? `Body ${(bodyRatio * 100).toFixed(1)}% of range` : 'Wrong colour',
      },
    ];
    const score = checks.reduce((s, c) => s + (c.ok ? c.points : 0), 0);
    const mandatoryOk = checks.filter(c => c.mandatory).every(c => c.ok);
    const filters: ConditionCheck[] = [
      {
        id: 'adxFilter', points: 0, mandatory: true,
        label: `ADX > ${p.adxMin}`,
        ok: Number.isFinite(adxV) && adxV > p.adxMin,
        detail: `ADX ${Number.isFinite(adxV) ? adxV.toFixed(2) : '—'} (below = sideways market)`,
      },
      {
        id: 'noDeadRsi', points: 0, mandatory: true,
        label: 'RSI not in 48–52 dead zone',
        ok: !deadRsi,
        detail: `RSI ${Number.isFinite(rsiV) ? rsiV.toFixed(2) : '—'}`,
      },
      {
        id: 'noChurn', points: 0, mandatory: true,
        label: `EMA 9/21 not churning (≤${p.churnMaxCrosses} crosses in ${p.churnLookback} bars)`,
        ok: churn <= p.churnMaxCrosses,
        detail: `${churn} crosses in last ${p.churnLookback} bars`,
      },
      {
        id: 'notExtended', points: 0, mandatory: true,
        label: `Close within ${p.atrExtensionMax}× ATR of EMA-9`,
        ok: extAtr <= p.atrExtensionMax,
        detail: `${extAtr.toFixed(2)}× ATR from EMA-9`,
      },
    ];
    const filtersOk = filters.every(f => f.ok);
    const tradeable = mandatoryOk && filtersOk && score >= p.scoreMin;
    return { checks, filters, score, mandatoryOk, filtersOk, tradeable };
  };

  const up = side('RISE');
  const down = side('FALL');

  // Pick the side with the higher score as the "lean"
  const lean: SignalDirection | null =
    up.score === down.score ? null : up.score > down.score ? 'RISE' : 'FALL';

  const chosen = up.score >= down.score ? up : down;
  const chosenDir: SignalDirection = up.score >= down.score ? 'RISE' : 'FALL';

  let direction: SignalDirection | 'NO_TRADE' = 'NO_TRADE';
  if (up.tradeable && !down.tradeable) direction = 'RISE';
  else if (down.tradeable && !up.tradeable) direction = 'FALL';
  else if (up.tradeable && down.tradeable) direction = chosenDir; // mutually exclusive in practice

  const blockedBy: string[] = [];
  const active = direction === 'FALL' ? down : direction === 'RISE' ? up : chosen;
  if (!active.mandatoryOk) {
    for (const c of active.checks.filter(c => c.mandatory && !c.ok)) blockedBy.push(c.label);
  }
  if (!active.filtersOk) {
    for (const f of active.filters.filter(f => !f.ok)) blockedBy.push(f.label);
  }
  if (active.mandatoryOk && active.filtersOk && active.score < p.scoreMin) {
    blockedBy.push(`Score ${active.score}/8 below required ${p.scoreMin}`);
  }

  let classification: SignalClass = 'NONE';
  if (active.score >= 8) classification = 'FULL';
  else if (active.score >= 7) classification = 'STRONG';
  else if (active.score >= 5) classification = 'WEAK';

  const summary =
    direction === 'NO_TRADE'
      ? `No trade — ${blockedBy[0] ?? 'conditions not met'}`
      : `${direction === 'RISE' ? 'BULLISH ▲' : 'BEARISH ▼'} · ${active.score}/8 ${classification === 'FULL' ? 'full confirmation' : 'strong candidate'}`;

  return {
    direction,
    lean,
    score: active.score,
    maxScore: 8,
    classification,
    mandatoryOk: active.mandatoryOk,
    filtersOk: active.filtersOk,
    tradeable: direction !== 'NO_TRADE',
    blockedBy,
    checks: active.checks,
    filters: active.filters,
    metrics: {
      emaFast: ef, emaSlow: es, emaTrend: et, rsi: rsiV, adx: adxV, atr: atrV,
      plusDI: bundle.plusDI[i], minusDI: bundle.minusDI[i],
      prevOpen: prev.open, prevHigh: prev.high, prevLow: prev.low, prevClose: prev.close,
      prevBullish, bodyRatio,
      m5Close: hasM5 ? m5Close : NaN,
      m5EmaTrend: hasM5 ? (m5EmaT as number) : NaN,
      m5Bullish: hasM5 ? m5Bullish : false,
      closeVsEmaFastAtr: extAtr,
      atrPct: Number.isFinite(atrV) && close > 0 ? (atrV / close) * 100 : NaN,
    },
    targetTime: opts.targetTime,
    summary,
  };
}

/** Convenience wrapper: compute indicators then evaluate at the latest completed candle. */
export function evaluateLatest(m1: Candle[], m5: Candle[], p: StrategyParams): SignalResult | null {
  if (m1.length < 60) return null;
  const bundle = computeIndicators(m1, m5, p);
  // The last candle in the array may still be forming — evaluate on the previous (completed) one.
  const forming = m1[m1.length - 1];
  const now = Date.now() / 1000;
  const isForming = now < forming.time + 60;
  const atIndex = isForming ? m1.length - 2 : m1.length - 1;
  if (atIndex < 55) return null;
  const targetTime = m1[atIndex].time + 60;
  return evaluateAt(m1, bundle, p, { atIndex, targetTime });
}
