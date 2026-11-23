// ─── Signal message — shareable 1-minute signal card (Telegram/WhatsApp style) ─
// Mirrors the format of channel-style signal posts: instrument, expiry, entry
// time, direction, score, M5 bias, RSI — entry ONCE per candle boundary.
// No martingale levels by design (see strategy blueprint risk rules).
import { useEffect, useMemo, useState } from 'react';
import { Megaphone, Copy, Check, AlertTriangle } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { fmtTimeHM } from '../lib/format';

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export default function SignalMessage() {
  const { signal, selectedSymbol, settings } = useApp();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const score = signal?.score ?? 0;
  // Publishable: 7+ (strong/full) or 5–6 (weak, labelled). Below 5 → nothing to post.
  const direction = signal?.tradeable ? signal.direction : signal?.lean ?? null;
  const publishable = !!direction && score >= 5 && direction !== ('NO_TRADE' as any);
  const isWeak = score < 7;
  const displayName = selectedSymbol?.display_name ?? settings.symbol;
  const symCode = settings.symbol;
  const targetTime = signal?.targetTime ?? 0;
  const entryHM = targetTime ? fmtTimeHM(targetTime) : '--:--';
  const rsi = signal?.metrics.rsi;
  const adx = signal?.metrics.adx;
  const m5Bullish = signal?.metrics.m5Bullish;
  const emaBullish = signal ? signal.metrics.emaFast >= signal.metrics.emaSlow : undefined;
  const classLabel = !signal ? '' : signal.classification === 'FULL' ? 'FULL CONFIRMATION'
    : signal.classification === 'STRONG' ? 'STRONG SIGNAL'
    : signal.classification === 'WEAK' ? 'WEAK SIGNAL'
    : 'NO SIGNAL';
  const tone = direction === 'RISE' ? 'bull' : direction === 'FALL' ? 'bear' : 'none';
  const dirLine = direction === 'RISE' ? '🟢 UP · RISE (CALL)' : direction === 'FALL' ? '🔴 DOWN · FALL (PUT)' : '';

  const message = useMemo(() => {
    if (!publishable || !signal) return '';
    const lines = [
      `📢 DERIV · ${displayName} (${symCode})`,
      `⏱ Expiry: 1 minute`,
      `🎯 Entry at ${entryHM} UTC — start of next M1 candle`,
      dirLine,
      `💯 Score ${score}/8 — ${classLabel}`,
      `📈 M5 bias: ${m5Bullish == null ? '—' : m5Bullish ? 'BULLISH' : 'BEARISH'} · RSI-14 ${rsi != null ? rsi.toFixed(1) : '—'} · ADX-14 ${adx != null ? adx.toFixed(1) : '—'}`,
      `⚖️ EMA 9/21 aligned ${emaBullish == null ? '—' : emaBullish ? 'bullish' : 'bearish'} · completed candles only, no martingale — one entry`,
    ];
    if (isWeak) lines.push('⚠️ WEAK SETUP — below the 7-point threshold. Informational only, no trade recommended.');
    if (!signal.tradeable) lines.push('⚠️ Sideways-market filters blocked this setup for auto-execution.');
    lines.push('⚠️ Binary options can lose 100% of the stake. Not financial advice.');
    return lines.join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishable, signal, score, classLabel, entryHM, displayName, symCode, isWeak, m5Bullish, rsi, adx, emaBullish]);

  return (
    <section className="panel panel-pad signal-message">
      <div className="panel-title">
        <span><Megaphone size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Signal message — channel format</span>
        <span className="sm-chip">1M · ONE ENTRY · NO MARTINGALE</span>
      </div>

      {publishable && signal ? (
        <>
          <div className={`sm-bubble ${tone}`} aria-live="polite">
            <div className="sm-line sm-title">📢 DERIV · {displayName} <span className="sm-code">({symCode})</span></div>
            <div className="sm-line">⏱ Expiry: <b>1 minute</b></div>
            <div className="sm-line">🎯 Entry at <b>{entryHM} UTC</b> — start of next M1 candle</div>
            <div className={`sm-line sm-dir ${tone}`}>{dirLine}</div>
            <div className="sm-line">💯 Score <b>{score}/8</b> — {classLabel}</div>
            <div className="sm-line">📈 M5 bias: <b>{m5Bullish == null ? '—' : m5Bullish ? 'BULLISH' : 'BEARISH'}</b> · RSI-14 {rsi != null ? rsi.toFixed(1) : '—'} · ADX-14 {adx != null ? adx.toFixed(1) : '—'}</div>
            <div className="sm-line">⚖️ EMA 9/21 aligned {emaBullish == null ? '—' : emaBullish ? 'bullish' : 'bearish'} · completed candles only · no martingale</div>
            {isWeak && <div className="sm-line sm-weak">⚠️ WEAK SETUP — below the 7-point threshold. Informational only, no trade recommended.</div>}
            {!signal.tradeable && <div className="sm-line sm-weak">⚠️ Sideways-market filters blocked this setup for auto-execution.</div>}
            <div className="sm-line sm-fine">⚠️ Binary options can lose 100% of the stake. Not financial advice.</div>
          </div>

          <div className="sm-copy-row">
            <button className="btn btn-primary" onClick={() => copyText(message).then(setCopied)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied to clipboard' : 'Copy message'}
            </button>
            <span style={{ font: '600 9px var(--mono)', color: 'var(--muted)', letterSpacing: '.08em' }}>
              {isWeak ? 'WEAK — POST AT YOUR OWN RISK' : 'READY TO POST'}
            </span>
          </div>
        </>
      ) : (
        <div className="sm-standby">
          <AlertTriangle size={16} style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--amber)' }} />
          Stand aside — score {score}/8 is below the 5-point publish threshold. A message appears here automatically when evidence builds on either side.
        </div>
      )}
    </section>
  );
}
