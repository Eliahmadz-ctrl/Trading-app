// ─── Strategy Guide — the rules, the maths, the honest limits ───────────────
import { useMemo, useState } from 'react';
import {
  BookOpenText, ArrowRight, CheckCircle2, ShieldAlert, Sigma, FunctionSquare,
  ListChecks, FlaskConical, Gauge, AlertTriangle, Info, Ban,
} from 'lucide-react';
import { fmtMoney } from '../lib/format';
import { useApp } from '../state/AppContext';

export default function Guide() {
  const { settings } = useApp();
  const [payout, setPayout] = useState(settings.payoutPct);
  const [accuracy, setAccuracy] = useState(58);
  const [calcStake, setCalcStake] = useState(100);

  const calc = useMemo(() => {
    const r = payout / 100;
    const be = 100 / (1 + r);
    const p = accuracy / 100;
    const evTrade = p * calcStake * r - (1 - p) * calcStake;
    const per100 = evTrade * 100;
    return { be, evTrade, per100 };
  }, [payout, accuracy, calcStake]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1060 }}>
      {/* ═══ Hero ═══ */}
      <section className="panel guide-hero">
        <div style={{ font: '700 10px var(--sans)', letterSpacing: '.28em', color: 'var(--cyan)', textTransform: 'uppercase' }}>Deriv · 1-Minute Rise/Fall</div>
        <h1 style={{ marginTop: 10 }}>M1 <b>NEXT-CANDLE</b></h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10, maxWidth: 640, lineHeight: 1.65 }}>
          Liquidity sweep + EMA + RSI + candle momentum — a rule-based system that predicts whether the <b style={{ color: '#e8edf7' }}>next</b> 1-minute candle closes bullish or bearish, scores its own confidence from 0–8, and refuses to trade when the evidence is weak. Built for Deriv Rise/Fall contracts, evaluated strictly out-of-sample.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <span className="chip chip-live"><span className="dot" />Rule-based</span>
          <span className="chip chip-paper"><span className="dot" />No look-ahead</span>
          <span className="chip chip-demo"><span className="dot" />0–8 confidence score</span>
          <span className="chip"><span className="dot" />Human override always</span>
        </div>
        <svg className="watermark" viewBox="0 0 120 60" aria-hidden="true">
          <path d="M4 52 L22 40 L34 46 L52 24 L66 33 L84 12 L98 19 L116 3" fill="none" stroke="rgba(34,211,238,0.16)" strokeWidth="3" strokeLinejoin="round" />
        </svg>
      </section>

      {/* ═══ The 3-step loop ═══ */}
      <section className="panel panel-pad">
        <div className="panel-title"><span><ArrowRight size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />The boundary ritual</span></div>
        <div className="split-cards">
          {[
            { n: '1', t: 'Wait for the candle to CLOSE', d: 'Never evaluate mid-candle for entries. The engine reads only completed M1 candles — open, high, low, close, and indicators derived from them.' },
            { n: '2', t: 'Score 8 factors', d: 'M5 bias (2) · EMA 9/21 alignment (2) · close vs EMA-50 (1) · RSI band (1) · ADX>20 (1) · strong previous candle (1). Plus sideways-market hard filters.' },
            { n: '3', t: 'Enter at the boundary', d: 'If the score is ≥7 and every mandatory group passes, the bot (or you) enters RISE/FALL as the new candle opens — 1-minute duration, stake = your risk %.' },
          ].map(s => (
            <div key={s.n} className="split-card">
              <div className="sc-tag" style={{ color: 'var(--cyan)' }}>Step {s.n}</div>
              <div style={{ fontWeight: 800, margin: '6px 0', fontSize: 13.5 }}>{s.t}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ Exact conditions ═══ */}
      <section className="panel panel-pad">
        <div className="panel-title"><span><ListChecks size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />The eight conditions (all required unless noted)</span><span style={{ font: '600 9px var(--mono)', color: 'var(--muted)' }}>◆ = MANDATORY GROUPS</span></div>
        <div className="guide-grid">
          <div className="condition-col rise">
            <h3 style={{ fontSize: 13, letterSpacing: '.18em', color: 'var(--bull)' }}>▲ RISE — BULLISH PREDICTION</h3>
            <ol>
              <li>M5 close is above its EMA-50 <span style={{ color: 'var(--amber)' }}>◆</span> <em style={{ color: 'var(--muted)' }}>(macro bias agrees)</em></li>
              <li>M1 EMA-9 above EMA-21 <span style={{ color: 'var(--amber)' }}>◆</span></li>
              <li>M1 close above EMA-50 <em style={{ color: 'var(--muted)' }}>(+1 point, not mandatory)</em></li>
              <li>RSI-14 between 52 and 68 <span style={{ color: 'var(--amber)' }}>◆</span> <em style={{ color: 'var(--muted)' }}>(momentum, not exhaustion)</em></li>
              <li>ADX-14 above 20 <em style={{ color: 'var(--muted)' }}>(trend, not drift — hard filter)</em></li>
              <li>Previous candle closed bullish</li>
              <li>That candle's body ≥ 50% of its range <em style={{ color: 'var(--muted)' }}>(conviction candle)</em></li>
              <li>It closed above EMA-9</li>
            </ol>
          </div>
          <div className="condition-col fall">
            <h3 style={{ fontSize: 13, letterSpacing: '.18em', color: 'var(--bear)' }}>▼ FALL — BEARISH PREDICTION</h3>
            <ol>
              <li>M5 close is below its EMA-50 <span style={{ color: 'var(--amber)' }}>◆</span></li>
              <li>M1 EMA-9 below EMA-21 <span style={{ color: 'var(--amber)' }}>◆</span></li>
              <li>M1 close below EMA-50 <em style={{ color: 'var(--muted)' }}>(+1 point, not mandatory)</em></li>
              <li>RSI-14 between 32 and 48 <span style={{ color: 'var(--amber)' }}>◆</span></li>
              <li>ADX-14 above 20 <em style={{ color: 'var(--muted)' }}>(hard filter)</em></li>
              <li>Previous candle closed bearish</li>
              <li>That candle's body ≥ 50% of its range</li>
              <li>It closed below EMA-9</li>
            </ol>
          </div>
        </div>

        <div className="divider">How the 8 points distribute</div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Confirmation</th><th>Points</th><th>Notes</th></tr></thead>
            <tbody>
              <tr><td>M5 directional alignment</td><td>2</td><td>Mandatory — disagreeing timeframes = no trade</td></tr>
              <tr><td>EMA 9 / 21 alignment</td><td>2</td><td>Mandatory — the momentum spine</td></tr>
              <tr><td>Price vs EMA-50</td><td>1</td><td>Trend quality, scored not mandatory</td></tr>
              <tr><td>RSI in directional band</td><td>1</td><td>Mandatory — dead zone 48–52 blocks always</td></tr>
              <tr><td>ADX above 20</td><td>1</td><td>Scored + hard filter</td></tr>
              <tr><td>Strong previous candle</td><td>1</td><td>Direction + body ≥ 50% of range</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <span className="class-badge class-NONE" style={{ marginTop: 0 }}>0–4 · no trade</span>
          <span className="class-badge class-WEAK" style={{ marginTop: 0 }}>5–6 · weak — skip</span>
          <span className="class-badge class-STRONG" style={{ marginTop: 0 }}>7 · strong candidate</span>
          <span className="class-badge class-FULL" style={{ marginTop: 0 }}>8 · full confirmation</span>
        </div>
      </section>

      {/* ═══ No-trade filters ═══ */}
      <section className="panel panel-pad">
        <div className="panel-title"><span><Ban size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--bear)' }} />When there is no signal: stand aside</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            'RSI in the 48–52 dead zone',
            'ADX below 20 (sideways tape)',
            'EMA 9/21 chopping — more than 4 crosses in 12 bars',
            'Previous body under 50% of range',
            'Close extended > 2× ATR from EMA-9',
            'M5 and M1 directions disagree',
            'Spread/cost exceeds quoted payout edge',
          ].map(f => (
            <span key={f} className="chip" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 10.5, color: '#c4cfe6' }}>{f}</span>
          ))}
        </div>
        <div className="guide-note" style={{ marginTop: 12 }}>
          I would rather build a system that gives 5 well-tested signals than 50 unreliable ones. If the engine says NO TRADE, the most profitable trade is the one you didn't take.
        </div>
      </section>

      {/* ═══ Break-even maths + calculator ═══ */}
      <section className="panel panel-pad">
        <div className="panel-title"><span><FunctionSquare size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />The brutal arithmetic of binary options</span></div>
        <div className="kv">
          <dt>Break-even win rate</dt>
          <dd style={{ fontFamily: 'var(--mono)', fontSize: 15, color: 'var(--cyan)' }}>W = 1 ÷ (1 + r)&nbsp;&nbsp;→&nbsp;&nbsp;at 85% payout: 54.05%</dd>
          <dt>Per 100 trades · K10 stake</dt>
          <dd style={{ fontFamily: 'var(--mono)' }}>45% → −K107.50 · 50% → −K75.00 · 55% → +K5.00 · 60% → +K90.00 · 65% → +K175.00 · 70% → +K260.00</dd>
          <dt>Equal entry/exit</dt>
          <dd>Generally a loss unless you explicitly buy an <b>Allow Equals</b> contract. This backtester counts ties as losses.</dd>
          <dt>Rise/Fall settlement</dt>
          <dd>Deriv settles on spot prices at start vs end — not on candle colours. Entering at the boundary approximates it; verify your entry/exit spots on the contract itself.</dd>
        </div>

        <div className="divider"><Sigma size={11} style={{ marginRight: 6 }} />Break-even calculator</div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            <div className="field">
              <label>Payout % <span className="hint">{payout}%</span></label>
              <input type="range" min={70} max={95} step={1} value={payout} onChange={e => setPayout(Number(e.target.value))} style={{ accentColor: 'var(--cyan)', width: '100%' }} />
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Win rate % <span className="hint">{accuracy}%</span></label>
              <input type="range" min={40} max={75} step={0.5} value={accuracy} onChange={e => setAccuracy(Number(e.target.value))} style={{ accentColor: 'var(--cyan)', width: '100%' }} />
            </div>
            <div className="field" style={{ marginTop: 12, width: 150 }}>
              <label>Stake</label>
              <input className="input" type="number" min={1} value={calcStake} onChange={e => setCalcStake(Number(e.target.value) || 0)} />
            </div>
          </div>
          <div className="calc-out" style={{ flex: '1 1 320px' }}>
            <div className="calc-stat"><div className="kpi-label">Break-even</div><div className="kpi-value" style={{ fontSize: 19, color: 'var(--cyan)' }}>{calc.be.toFixed(2)}%</div></div>
            <div className="calc-stat"><div className="kpi-label">Expectancy / trade</div><div className="kpi-value" style={{ fontSize: 19, color: calc.evTrade >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{calc.evTrade >= 0 ? '+' : ''}{fmtMoney(calc.evTrade, 'USD')}</div></div>
            <div className="calc-stat"><div className="kpi-label">Expected / 100 trades</div><div className="kpi-value" style={{ fontSize: 19, color: calc.per100 >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{calc.per100 >= 0 ? '+' : ''}{fmtMoney(calc.per100, 'USD')}</div></div>
            <div className="calc-stat"><div className="kpi-label">Verdict</div><div className="kpi-value" style={{ fontSize: 13, color: accuracy >= calc.be ? 'var(--bull)' : 'var(--bear)', marginTop: 10 }}>{accuracy >= calc.be ? 'PROFITABLE IF REAL' : 'LOSING SYSTEM'}</div></div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#5d6c8f', marginTop: 10 }}>Sliders are illustrative — Deriv payouts vary by instrument, duration and market conditions. Always use the payout shown on the actual proposal, and note Omitted "Allow Equals" means exact ties lose.</div>
      </section>

      {/* ═══ Risk rules ═══ */}
      <section className="panel panel-pad">
        <div className="panel-title"><span><ShieldAlert size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--amber)' }} />Non-negotiable risk rules</span></div>
        <ol style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            'Risk 0.5–1% of account per trade — never more',
            'Never raise stakes to recover a loss — no martingale, ever',
            'Stop after 3 consecutive losses — walk away for the day',
            'Daily loss limit 3% — the bot enforces this automatically',
            'Do not trade through major news on forex instruments',
            'Backtest → demo 2–4 weeks → only then consider real money',
          ].map((r, i) => (
            <li key={i} style={{ display: 'flex', gap: 10, fontSize: 11.5, color: '#c4cfe6', lineHeight: 1.5, background: 'var(--panel-c)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 12px' }}>
              <CheckCircle2 size={15} color="#fbbf24" style={{ flex: '0 0 auto', marginTop: 1 }} />{r}
            </li>
          ))}
        </ol>
      </section>

      {/* ═══ 60/20/20 protocol ═══ */}
      <section className="panel panel-pad">
        <div className="panel-title"><span><FlaskConical size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Testing protocol — 60 / 20 / 20</span></div>
        <div className="kv">
          <dt>Develop (60%)</dt><dd>Use the oldest 60% of candles to define and tune the rules. Anything you eyeball here is not a discovery — it's fitting.</dd>
          <dt>Select (20%)</dt><dd>The middle 20% selects between a small, sane parameter grid (this terminal tests EMA 7/9/12 × 18/21/26 × ADX 20/25).</dd>
          <dt>Test (20%)</dt><dd>The newest 20% is touched once. If the system doesn't survive it, it doesn't survive — full stop.</dd>
          <dt>Then demo</dt><dd>Deriv demo account, minimum 2–4 weeks, tracking accuracy by instrument and hour. Real money only if BOTH the unseen test and demo stay profitable.</dd>
        </div>
        <div className="guide-note" style={{ marginTop: 12 }}>
          <AlertTriangle size={12} style={{ verticalAlign: '-1px', marginRight: 6 }} />
          Overfitting is the default failure mode: tweak indicators until history looks golden and the future quietly pays the bill. If your test-segment edge needs a "special market regime" excuse, you have no edge.
        </div>
      </section>

      {/* ═══ Instrument caveats ═══ */}
      <section className="panel panel-pad">
        <div className="panel-title"><span><Info size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Instrument reality check</span></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Deriv instrument</th><th>How to approach it with this system</th></tr></thead>
            <tbody>
              <tr><td>Volatility 10/25/50/75/100 &amp; 1s</td><td>Test each independently — momentum behaviour differs per index. 1s indices produce far more candles and more noise; raise score threshold.</td></tr>
              <tr><td>Boom / Crash</td><td>Asymmetric jumps invalidate continuation logic — test reversion and spike-frequency separately, or skip.</td></tr>
              <tr><td>Step Index</td><td>Fixed-step moves behave unlike continuous indices — test continuation vs reversal separately.</td></tr>
              <tr><td>Range Break</td><td>Boundary breaks need their own breakout-confirmation rules, not this momentum template.</td></tr>
              <tr><td>Forex majors</td><td>Add session filters (London/NY overlap) and avoid news spikes — spread and slippage eat binary payouts fast.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="guide-note" style={{ marginTop: 12 }}>
          <AlertTriangle size={12} style={{ verticalAlign: '-1px', marginRight: 6 }} />
          Deriv's own documentation notes synthetic indices (apart from Range Break) may not suit conventional technical indicators — historical patterns can be coincidental. There is no exchange order book or "smart money" behind Volatility 75. The 6-point score is a <b>filter for evidence quality</b>, not a probability. Its predictive value must be measured on your instrument with this terminal's Backtest Lab before it earns a stake.
        </div>
      </section>

      {/* ═══ Footer honesty ═══ */}
      <div style={{ textAlign: 'center', color: '#4c5a80', fontSize: 10, padding: '6px 0 10px', lineHeight: 1.7 }}>
        M1 NEXT-CANDLE · built for education, research and disciplined forward-testing<br />
        Not financial advice · Past performance ≠ future results · Deriv Bot / API use carries its own risks<br />
        <Gauge size={11} style={{ verticalAlign: '-1px' }} /> Measured accuracy is the only currency that matters here.
      </div>
    </div>
  );
}
