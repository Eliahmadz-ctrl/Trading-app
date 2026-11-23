// ─── Technical indicators (pure functions, NaN-warmup aligned arrays) ───────
import type { Candle } from './types';

/** Exponential moving average. Seeded with first value — converges after ~5×period. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI with Wilder smoothing. */
export function rsi(closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** True range series (index 0 uses high−low of first candle). */
export function trueRange(c: Candle[]): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length === 0) return out;
  out[0] = c[0].high - c[0].low;
  for (let i = 1; i < c.length; i++) {
    out[i] = Math.max(
      c[i].high - c[i].low,
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close),
    );
  }
  return out;
}

/** ATR with Wilder smoothing. */
export function atr(c: Candle[], period = 14): number[] {
  const n = c.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;
  const trs = trueRange(c);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

export interface AdxResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

/** ADX / +DI / −DI with Wilder smoothing (classic J. Welles Wilder Jr. formulation). */
export function adx(c: Candle[], period = 14): AdxResult {
  const n = c.length;
  const adxArr = new Array<number>(n).fill(NaN);
  const plusDI = new Array<number>(n).fill(NaN);
  const minusDI = new Array<number>(n).fill(NaN);
  if (n < period * 2 + 1) return { adx: adxArr, plusDI, minusDI };

  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);
  const tr = trueRange(c);
  for (let i = 1; i < n; i++) {
    const upMove = c[i].high - c[i - 1].high;
    const downMove = c[i - 1].low - c[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  let atrS = 0;
  let pDM = 0;
  let mDM = 0;
  for (let i = 1; i <= period; i++) {
    atrS += tr[i];
    pDM += plusDM[i];
    mDM += minusDM[i];
  }
  const dx = new Array<number>(n).fill(NaN);
  const store = (i: number) => {
    const pdi = atrS === 0 ? 0 : (pDM / atrS) * 100;
    const mdi = atrS === 0 ? 0 : (mDM / atrS) * 100;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const denom = pdi + mdi;
    dx[i] = denom === 0 ? 0 : (Math.abs(pdi - mdi) / denom) * 100;
  };
  store(period);
  for (let i = period + 1; i < n; i++) {
    atrS = atrS - atrS / period + tr[i];
    pDM = pDM - pDM / period + plusDM[i];
    mDM = mDM - mDM / period + minusDM[i];
    store(i);
  }

  // ADX = Wilder-smoothed DX, seeded from the first `period` valid DX values
  let dxSum = 0;
  for (let i = period; i < period + period; i++) dxSum += dx[i];
  let prev = dxSum / period;
  const firstIdx = period * 2;
  adxArr[firstIdx] = prev;
  for (let i = firstIdx + 1; i < n; i++) {
    prev = (prev * (period - 1) + dx[i]) / period;
    adxArr[i] = prev;
  }
  return { adx: adxArr, plusDI, minusDI };
}
