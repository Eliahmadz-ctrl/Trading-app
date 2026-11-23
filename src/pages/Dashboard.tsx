// ─── Live Signal — NEXT M1 CANDLE prediction terminal ───────────────────────
import { useMemo } from 'react';
import {
  CandlestickChart, ArrowUpRight, ArrowDownRight, Minus, Check, X, ShieldCheck,
  ShieldX, Timer, Radio, TrendingUp, TrendingDown, Trash2, AlertTriangle, Zap,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { useNow } from '../lib/useNow';
import CandleChart from '../components/CandleChart';
import ScoreRing from '../components/ScoreRing';
import SignalMessage from '../components/SignalMessage';
import { fmtPrice, fmtTimeHM, fmtPct, fmtNum, clamp } from '../lib/format';
import type { SignalResult } from '../lib/types';

function SignalArrow({ direction }: { direction: SignalResult['direction'] }) {
  if (direction === 'RISE')
    return (
      <div className="signal-arrow bull">
        <ArrowUpRight size={52} strokeWidth={2.4} color="#34d399" />
      </div>
    );
  if (direction === 'FALL')
    return (
      <div className="signal-arrow bear">
        <ArrowDownRight size={52} strokeWidth={2.4} color="#fb7185" />
      </div>
    );
  return (
    <div className="signal-arrow none">
      <Minus size={46} strokeWidth={2.2} color="#8296bb" />
    </div>
  );
}

export default function Dashboard() {
  const {
    settings, status, selectedSymbol, m1Candles, m5Candles, signal, lastTickAt,
    predictions, clearPredictions, botArmed, risk,
  } = useApp();
  const now = useNow(250);

  const forming = m1Candles.length ? m1Candles[m1Candles.length - 1] : null;
  const completedTail = m1Candles.length > 1 ? m1Candles[m1Candles.length - 2] : null;
  const targetTime = signal?.targetTime ?? (completedTail ? completedTail.time + 60 : forming ? forming.time + 60 : 0);
  const remainingMs = targetTime ? Math.max(0, targetTime * 1000 + 60000 - now) : 0;
  const countdownFrac = targetTime ? clamp(remainingMs / 60000, 0, 1) : 0;

  const price = forming?.close ?? completedTail?.close;
  const prevClose = completedTail?.close;
  const chg = price != null && prevClose != null && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : 0;

  const marketOpen = Number(selectedSymbol?.exchange_is_open ?? 1) === 1 && Number(selectedSymbol?.is_trading_suspended ?? 0) === 0;

  // ── verified track record (this browser, current instrument + overall) ──
  const track = useMemo(() => {
    const graded = predictions.filter(p => p.correct !== undefined && p.correct !== null);
    const sym = graded.filter(p => p.symbol === settings.symbol);
    const tble = graded.filter(p => p.tradeable);
    const symTble = sym.filter(p => p.tradeable);
    const pct = (arr: typeof graded) => (arr.length ? (arr.filter(p => p.correct).length / arr.length) * 100 : null);
    const dots = predictions.slice(0, 24).reverse();
    return {
      symAcc: pct(sym), symN: sym.length,
      allAcc: pct(graded), allN: graded.length,
      tbleAcc: pct(tble), tbleN: tble.length,
      symTbleAcc: pct(symTble), symTbleN: symTble.length,
      dots,
    };
  }, [predictions, settings.symbol]);

  const signalTone: 'bull' | 'bear' | 'muted' =
    signal?.direction === 'RISE' ? 'bull' : signal?.direction === 'FALL' ? 'bear' : 'muted';

  const sideLabel = signal && !signal.tradeable
    ? signal.lean
      ? `Leaning ${signal.lean === 'RISE' ? 'bullish' : 'bearish'} — no trade`
      : 'No clear direction — no trade'
    : null;

  return (
    <div className="dash-grid">
      {/* ════════ Left: chart + verified record ════════ */}
      <div className="dash-left">
        <section className="panel">
          <div className="chart-head">
            <div className="chart-symbol" style={{ alignItems: 'center' }}>
              <CandlestickChart size={26} color="var(--cyan)" strokeWidth={1.6} style={{ opacity: 0.9 }} />
              <h2>{selectedSymbol?.display_name ?? settings.symbol}</h2>
              <span className="sym-code">{settings.symbol} · M1</span>
              {!marketOpen && <span className="chip chip-closed"><span className="dot" />CLOSED</span>}
            </div>
            <div className="price-block">
              <div className="price-now" style={{ color: chg >= 0 ? 'var(--bull)' : 'var(--bear)' }}>
                {fmtPrice(price)}
              </div>
              <div className={`price-chg ${chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat'}`}>
                {chg >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(chg))} · candle change
              </div>
            </div>
          </div>

          {m1Candles.length > 30 ? (
            <CandleChart candles={m1Candles} height={446} />
          ) : (
            <div style={{ height: 446, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
              <div style={{ textAlign: 'center' }}>
                <Radio size={30} className="icon-spin" style={{ color: 'var(--cyan)', marginBottom: 12 }} />
                <div style={{ fontWeight: 700 }}>{status === 'error' ? 'Connection error' : 'Subscribing to candles…'}</div>
                <div style={{ fontSize: 11, marginTop: 6 }}>Connecting to Deriv WebSocket API — this usually takes a second.</div>
              </div>
            </div>
          )}

          <div className="chart-foot">
            <span>
              {m1Candles.length} candles loaded · M5 bias feed {m5Candles.length >= 60 ? 'OK' : 'buffering…'} · ATR-derived signals use <b>completed candles only</b>
            </span>
            <span>
              Last tick {lastTickAt ? `${Math.max(0, Math.round((now - lastTickAt) / 1000))}s ago` : '—'} · {fmtTimeHM(targetTime || 0)} target
            </span>
          </div>
        </section>

        {/* ═══ Verified track record ═══ */}
        <section className="panel panel-pad">
          <div className="panel-title">
            <span><ShieldCheck size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Verified predictions — graded after close</span>
            <button className="btn btn-sm" onClick={clearPredictions} title="Clear logged predictions">
              <Trash2 size={12} /> Clear
            </button>
          </div>

          {track.allN === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '6px 2px 10px', lineHeight: 1.6 }}>
              No graded predictions yet. Every closed M1 candle generates a logged prediction in this browser — the log grades itself when the candle prints, so you can audit the engine on your own feed instead of trusting marketing numbers.
            </div>
          ) : (
            <div className="track-strip" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 108 }}>
                <div className="kpi-label">Accuracy · this instrument</div>
                <div className="kpi-value" style={{ color: (track.symAcc ?? 0) >= 54 ? 'var(--bull)' : 'var(--bear)' }}>
                  {track.symAcc == null ? '—' : `${track.symAcc.toFixed(1)}%`}
                </div>
                <div className="kpi-sub">n={track.symN} graded{track.symTbleN ? ` · ${track.symTbleAcc!.toFixed(0)}% on tradeable` : ''}</div>
              </div>
              <div style={{ minWidth: 108 }}>
                <div className="kpi-label">Accuracy · all instruments</div>
                <div className="kpi-value" style={{ color: (track.allAcc ?? 0) >= 54 ? 'var(--bull)' : 'var(--bear)' }}>
                  {track.allAcc!.toFixed(1)}%
                </div>
                <div className="kpi-sub">n={track.allN} · tradeable {track.tbleN} @ {track.tbleAcc == null ? '—' : `${track.tbleAcc.toFixed(1)}%`}</div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="kpi-label" style={{ marginBottom: 6 }}>Last {track.dots.length} predictions</div>
                <div className="track-record-dots">
                  {track.dots.map(p => {
                    const cls = p.correct === undefined || p.correct === null
                      ? p.actual === 'TIE' ? 'tie' : 'pending'
                      : p.correct ? 'win' : 'loss';
                    const title = `${new Date(p.targetTime * 1000).toUTCString().slice(17, 22)} · ${p.lean ?? '—'} · score ${p.score}/8 · ${p.correct === undefined || p.correct === null ? (p.actual ?? 'pending') : p.correct ? 'correct' : 'wrong'}`;
                    return <span key={p.id} className={`pred-dot ${cls}`} title={title}>{p.score}</span>;
                  })}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ════════ Right: signal panel ════════ */}
      <div className="dash-right">
        <section className="panel signal-hero">
          <div className="signal-meta">
            <span className="panel-title" style={{ margin: 0 }}>
              {status === 'connected' || status === 'authorized'
                ? <span className="chip chip-live" style={{ padding: '3px 9px' }}><span className="dot" />Next M1 Candle</span>
                : <span className="chip chip-connecting" style={{ padding: '3px 9px' }}><span className="dot" />Offline</span>}
            </span>
            <span className="signal-target">
              {targetTime ? <>candle <b>{fmtTimeHM(targetTime)}–{fmtTimeHM(targetTime + 60)}</b> UTC</> : 'awaiting data…'}
            </span>
          </div>

          <div className="signal-main">
            <SignalArrow direction={signal?.direction ?? 'NO_TRADE'} />
            <div style={{ textAlign: 'left' }}>
              <div className={`signal-word ${signalTone === 'muted' ? 'none' : signalTone}`}>
                {signal ? (signal.direction === 'RISE' ? 'BULLISH' : signal.direction === 'FALL' ? 'BEARISH' : 'NO TRADE') : 'SYNCING'}
              </div>
              <div className="signal-sub">
                {signal?.direction === 'NO_TRADE' || !signal ? 'Stand aside' : signal.direction === 'RISE' ? '▲ Close > Open' : '▼ Close < Open'}
              </div>
              {sideLabel && <div style={{ font: '600 10px var(--mono)', color: 'var(--amber)', marginTop: 6 }}>{sideLabel} · score {signal?.score ?? 0}/8</div>}
              <div className={`class-badge class-${signal?.classification ?? 'NONE'}`}>
                <Zap size={10} />
                {signal ? ({ FULL: 'Full confirmation', STRONG: 'Strong candidate', WEAK: 'Weak signal', NONE: 'No signal' } as const)[signal.classification] : 'No signal'}
              </div>
            </div>
          </div>

          {/* Score ring + side stats */}
          <div className="score-wrap">
            <ScoreRing score={signal?.score ?? 0} tone={signalTone} size={118} />
            <div className="score-side">
              <div className="ss-label">Confirmation</div>
              <div className={`ss-value ${signalTone === 'muted' ? '' : signalTone}`}>{signal?.score ?? 0} of 8 factors</div>
              <div className="ss-label" style={{ marginTop: 10 }}>Auto-execution</div>
              <div className="ss-value" style={{ color: botArmed ? 'var(--bull)' : 'var(--muted)', fontSize: 11.5 }}>
                {botArmed ? `ARMED · ${settings.botMode.toUpperCase()}` : 'disarmed'}{risk.stopped ? ' · HALTED' : ''}
              </div>
            </div>
          </div>

          {/* Countdown */}
          <div className="countdown">
            <div className="countdown-track"><div className="countdown-fill" style={{ width: `${countdownFrac * 100}%` }} /></div>
            <div className="countdown-row">
              <span><Timer size={11} style={{ verticalAlign: '-1px', marginRight: 5 }} />Candle closes in</span>
              <b>{Math.floor(remainingMs / 60000)}:{String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}</b>
            </div>
          </div>

          {!marketOpen && (
            <div className="verdict-box verdict-warn" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />
              This market is closed right now — the signal below reflects the last available completed candles. Deriv will not accept new Rise/Fall contracts until it reopens.
            </div>
          )}
        </section>

        {/* ═══ Signal message — channel-style post ═══ */}
        <SignalMessage />

        {/* ═══ Checklist ═══ */}
        <section className="panel panel-pad">
          <div className="panel-title">
            <span><TrendingUp size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Confirmation checklist — {signal?.lean ?? 'RISE'} side</span>
            <span style={{ font: '600 9px var(--mono)', color: 'var(--muted)' }}>MANDATORY <span style={{ color: 'var(--amber)' }}>◆</span></span>
          </div>
          <div className="checklist">
            {signal?.checks.map(c => (
              <div key={c.id} className={`cond-row ${c.ok ? 'ok' : 'fail'}`}>
                <span className="cond-icon">{c.ok ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}</span>
                <span className="cond-label">
                  {c.label}{c.mandatory && <span className="cond-mand">◆</span>}
                  <span className="cond-detail">{c.detail}</span>
                </span>
                <span className="cond-points">{c.points > 0 ? `+${c.points}` : 'req'}</span>
              </div>
            )) ?? <div style={{ color: 'var(--muted)', fontSize: 12 }}>Waiting for indicator warmup…</div>}
          </div>

          <div className="divider">Sideways-market filters</div>
          <div className="checklist">
            {signal?.filters.map(f => (
              <div key={f.id} className={`cond-row ${f.ok ? 'ok' : 'fail'}`}>
                <span className="cond-icon">{f.ok ? <ShieldCheck size={12} strokeWidth={2.4} /> : <ShieldX size={12} strokeWidth={2.4} />}</span>
                <span className="cond-label">
                  {f.label}
                  <span className="cond-detail">{f.detail}</span>
                </span>
                <span className="cond-points">{f.ok ? 'pass' : 'block'}</span>
              </div>
            ))}
          </div>

          {signal && signal.blockedBy.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 10, color: '#fbbf24', lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: 9 }}>
              <b style={{ letterSpacing: '.14em', fontSize: 8.5 }}>WHY NO TRADE · </b>{signal.blockedBy.join(' · ')}
            </div>
          )}
        </section>

        {/* ═══ Market metric tiles ═══ */}
        <section className="panel panel-pad">
          <div className="panel-title"><span>Momentum &amp; volatility</span><span style={{ font: '600 9px var(--mono)', color: 'var(--muted)' }}>M1</span></div>
          <div className="metric-grid">
            <div className="metric">
              <div className="m-label">RSI-14</div>
              <div className={`m-value ${(signal?.metrics.rsi ?? 50) > 60 || (signal?.metrics.rsi ?? 50) < 40 ? 'cool' : ''}`}>{fmtNum(signal?.metrics.rsi, 1)}</div>
              <div className="m-sub">band 52–68 / 32–48</div>
            </div>
            <div className="metric">
              <div className="m-label">ADX-14</div>
              <div className={`m-value ${(signal?.metrics.adx ?? 0) > 20 ? 'good' : 'bad'}`}>{fmtNum(signal?.metrics.adx, 1)}</div>
              <div className="m-sub">{(signal?.metrics.adx ?? 0) > 20 ? 'trend strong' : 'sideways — no trade'}</div>
            </div>
            <div className="metric">
              <div className="m-label">ATR-14</div>
              <div className="m-value">{fmtNum(signal?.metrics.atr, 5)}</div>
              <div className="m-sub">{fmtNum(signal?.metrics.atrPct, 3)}% of price</div>
            </div>
            <div className="metric">
              <div className="m-label">Body ratio</div>
              <div className={`m-value ${(signal?.metrics.bodyRatio ?? 0) >= 0.5 ? 'good' : 'bad'}`}>{fmtNum((signal?.metrics.bodyRatio ?? 0) * 100, 0)}%</div>
              <div className="m-sub">prev candle conviction</div>
            </div>
            <div className="metric">
              <div className="m-label">M5 bias</div>
              <div className={`m-value ${signal?.metrics.m5Bullish ? 'good' : 'bad'}`}>{signal ? (signal.metrics.m5Bullish ? 'BULL' : 'BEAR') : '—'}</div>
              <div className="m-sub">M5 close vs EMA-50</div>
            </div>
            <div className="metric">
              <div className="m-label">EMA 9 / 21</div>
              <div className={`m-value ${(signal?.metrics.emaFast ?? 0) >= (signal?.metrics.emaSlow ?? 0) ? 'good' : 'bad'}`}>
                {(signal?.metrics.emaFast ?? 0) >= (signal?.metrics.emaSlow ?? 0) ? '9 > 21' : '9 < 21'}
              </div>
              <div className="m-sub">{fmtNum(signal?.metrics.emaFast, 4)} / {fmtNum(signal?.metrics.emaSlow, 4)}</div>
            </div>
            <div className="metric">
              <div className="m-label">Close vs EMA-9</div>
              <div className="m-value">{fmtNum(signal?.metrics.closeVsEmaFastAtr, 2)}× ATR</div>
              <div className="m-sub">extension filter ≤ 2.0</div>
            </div>
            <div className="metric">
              <div className="m-label">DI + / DI −</div>
              <div className="m-value" style={{ fontSize: 12.5 }}>{fmtNum(signal?.metrics.plusDI, 1)} / {fmtNum(signal?.metrics.minusDI, 1)}</div>
              <div className="m-sub">{(signal?.metrics.plusDI ?? 0) > (signal?.metrics.minusDI ?? 0) ? 'buyers in control' : 'sellers in control'}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
