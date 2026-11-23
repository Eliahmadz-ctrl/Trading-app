# M1 NEXT-CANDLE — Deriv next-candle signal engine & auto-bot

A complete, honest implementation of the **M1 NEXT-CANDLE** strategy: *Liquidity Sweep + EMA + RSI + Candle Momentum* — a rule-based system that predicts whether the **next** 1-minute candle on Deriv closes bullish or bearish, scores its own confidence 0–8, refuses to trade when the evidence is weak, measures itself out-of-sample, and executes with hard risk limits.

> **Not financial advice.** Binary options can lose 100% of the stake. Every number in this repo is a measurement of history, not a promise about the future. Test, backtest, forward-test on demo — then decide.

![Stack](https://img.shields.io/badge/stack-Vite%20·%20React%2018%20·%20TypeScript%20·%20lightweight--charts-22d3ee?style=flat-square)

## What's in the box

| Module | Path | What it does |
| --- | --- | --- |
| Strategy engine | `src/lib/strategy.ts` | The exact 8-condition RISE/FALL checklist, sideways-market hard filters, 0–8 scoring, full/strong/weak classification. **No look-ahead: evaluates completed candles only.** |
| Indicators | `src/lib/indicators.ts` | EMA, RSI (Wilder), ATR (Wilder), ADX/+DI/−DI (Wilder) — pure functions. |
| Deriv client | `src/lib/derivApi.ts` | Deriv **Options API** client: public market data via `wss://api.derivws.com/trading/v1/options/ws/public` (no auth) with automatic fallback to the legacy v3 feeds; `ticks_history` (snapshot + live `ohlc` stream), `active_symbols`, PAT-token auth (REST account lookup → single-use OTP WebSocket), `balance`, `proposal` → `buy` (1-minute `CALL`=RISE / `PUT`=FALL), contract settlement tracking, auto-reconnect with OTP re-mint, ping. |
| Backtester | `src/lib/backtest.ts` | Walk-forward simulation on real candles; win/loss/tie accounting (ties lose, like Deriv), equity curve, per-hour breakdown, max drawdown, consecutive losses, 60/20/20 split with a parameter grid (EMA 7/9/12 × 18/21/26 × ADX 20/25) to expose overfitting. |
| Risk engine | `src/lib/risk.ts` | Stake sizing (default 1% of balance), daily loss cap (3%), 3-consecutive-loss stop, one-open-contract rule, day rollover resets. Martingale deliberately absent. |
| Terminal UI | `src/pages/*` | **Live Signal** (next-candle prediction, checklist, countdown, verified self-grading prediction log), **Backtest Lab** (up to 10,000 candles, CSV export of candles + trades), **Auto-Bot** (paper → Deriv demo → live, journaled), **Strategy Guide** (rules + break-even calculator). |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (or npm run build && npm run preview)
```

No configuration is required for the Live Signal page — the terminal streams public candle data from Deriv's Options API (`wss://api.derivws.com/trading/v1/options/ws/public`) directly in your browser. If the public Options endpoint is unreachable, it automatically falls back to the legacy feeds (`ws.derivws.com` → `ws.binaryws.com` → `wss.derivws.com`).

Optional, for the Auto-Bot (demo or live execution):
1. Log in at <https://developers.deriv.com/> and **register a PAT-type application** — this generates your own App ID. (Deriv retired legacy App IDs, including the public `1089` playground, for the new API.)
2. In the dashboard, create a **PAT token** (`pat_…`) with scopes **read + trade** (demo first!).
3. Auto-Bot → *Deriv demo* → enter your **App ID** and the **PAT token** → **Authorize** → arm the bot.
4. Paper mode needs no token or App ID at all.

Under the hood the app lists your Options accounts via REST (`GET /trading/v1/options/accounts`), picks the matching demo/real account, mints a single-use OTP WebSocket URL (`POST …/accounts/{id}/otp`) and connects to it — the socket stays authenticated and re-mints a fresh OTP automatically on reconnect. Monetary fields are parsed as strings per Deriv's current API. Legacy `a1-…` tokens and the legacy `authorize` WebSocket call are no longer supported by Deriv.

## The strategy in one paragraph

Before a new M1 candle opens, using only completed candles: M5 must agree with direction (M5 close vs M5 EMA-50, **2 pts, mandatory**), EMA-9/21 must be aligned (**2 pts, mandatory**), close vs EMA-50 (1), RSI-14 in 52–68 (rise) / 32–48 (fall) (**1 pt, mandatory**, 48–52 dead-zone always blocks), ADX-14 > 20 (1, hard filter), previous candle in direction and its body ≥ 50% of range (**+1 strong-candle**). **Score ≥ 7 with all mandatory groups passing = trade. 5–6 = weak, skip. ≤4 = no trade.** Entry at the boundary, 1-minute duration. A confirmation score measures *evidence quality*, not win probability — its predictive value must be measured on your instrument via the Backtest Lab before it earns a stake.

**Deriv specifics:** Rise/Fall settles on spot prices (exit vs entry), not candle colours; ties lose unless you explicitly buy Allow Equals. The bot places `CALL` (RISE) / `PUT` (FALL) for 1 minute. Synthetic indices are algorithmically generated and may not follow conventional technical analysis — backtest each instrument separately.

## Verification

- Strategy + backtest engine unit-exercised on synthetic random-walk and trending series (no crashes; correctly finds zero edge on random data; tradeable signals fire on both sides in trending regimes).
- `tsc --noEmit` clean; production build succeeds.
- Predicted vs actual accuracy is **measured in-browser** on every closed candle (Live Signal → "Verified predictions — graded after close").

## Honest limitations

1. **No demonstrated edge.** This is a disciplined framework around a discretionary idea, not an alpha guarantee. The backtester and 60/20/20 split exist precisely so you can measure whether *you* can get an edge on *your* instrument — or kill the idea.
2. **Payout asymmetry.** At 85% payout you need > 54.05% just to break even. Small edges are invisible to noise at binary payouts.
3. **Synthetic indices** are random-process instruments; apparent historical regularities are often coincidental. Forex adds spread/news/session risk. Boom/Crash spike geometry breaks continuation assumptions.
4. Execution differences (entry spot ≠ candle open, latency, contract cancellations) mean live results diverge from candle-colour backtests. Use demo to size the gap.

## Scripts

```bash
npm run dev         # dev server with HMR
npm run build       # type-check + production build → dist/
npm run preview     # serve the production build
npm run typecheck   # tsc --noEmit only
```

## Repository layout

```
src/
  lib/        indicators · strategy · backtest · derivApi · risk · format · storage · types · useNow
  state/      AppContext — connection lifecycle, candle subscriptions, candle-close engine, bot executor
  components/ CandleChart (lightweight-charts) · SymbolPicker · ScoreRing · Toasts
  pages/      Dashboard (Live Signal) · Backtest (Backtest Lab) · Bot (Auto-Bot) · Guide (Strategy Guide)
  styles/     global.css — design system
```
