// ─── Backtest Lab — historical measurement + 60/20/20 walk-forward ───────────
import { useCallback, useMemo, useState } from 'react';
import {
  FlaskConical, Play, Loader2, Download, ShieldCheck, AlertTriangle, CheckCircle2, Info,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { DEFAULT_PARAMS, runBacktest, walkForwardSplit, type SplitEvaluation, type BacktestResult } from '../lib/backtest';
import type { Candle } from '../lib/types';
import { toCSV, downloadTextFile, fmtMoney, fmtPct, clamp } from '../lib/format';

const COUNTS = [1000, 2500, 5000, 10000];

export default function Backtest() {
  const { settings, updateSettings, fetchCandles, toast } = useApp();
  const [count, setCount] = useState(2000);
  const [payoutPct, setPayoutPct] = useState(settings.payoutPct);
  const [stake, setStake] = useState(100);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ full: BacktestResult; split: SplitEvaluation; m1: Candle[] } | null>(null);


  const payout = clamp(payoutPct || 0, 10, 100);
  const beWin = 100 / (1 + payout / 100);
  const currency = settings.paperCurrency;

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setPhase('Fetching M1 candles from Deriv…');
      const m1 = await fetchCandles(settings.symbol, 60, count);
      if (m1.length < 300) throw new Error(`Only ${m1.length} candles returned — not enough history to backtest.`);
      setPhase('Fetching M5 bias candles…');
      const m5 = await fetchCandles(settings.symbol, 300, Math.min(10000, Math.ceil(m1.length / 5) + 150));
      setPhase('Running strategy + parameter grid (dev → val → test)…');
      await new Promise(r => setTimeout(r, 60)); // let the spinner paint
      const params = { ...DEFAULT_PARAMS, scoreMin: settings.minScore, adxMin: 20 };
      const full = runBacktest(m1, m5, params, { stake, payoutPct: payout });
      const split = walkForwardSplit(m1, m5, params, stake, payout);
      updateSettings({ payoutPct: payout });
      setResult({ full, split, m1 });
      setPhase('');
    } catch (e: any) {
      setError(e?.message ?? 'Backtest failed');
    } finally {
      setRunning(false);
    }
  }, [count, fetchCandles, payout, settings.minScore, settings.symbol, stake, updateSettings]);

  const exportCandles = useCallback(() => {
    if (!result) return;
    const rows: (string | number)[][] = [['epoch', 'datetime_utc', 'open', 'high', 'low', 'close']];
    for (const c of result.m1) rows.push([c.time, new Date(c.time * 1000).toISOString(), c.open, c.high, c.low, c.close]);
    downloadTextFile(`deriv_${settings.symbol}_M1_${result.m1.length}.csv`, toCSV(rows));
  }, [result, settings.symbol]);

  const exportTrades = useCallback(() => {
    if (!result) return;
    const rows: (string | number)[][] = [['target_time_utc', 'direction', 'score', 'outcome', 'rsi', 'adx', 'entry', 'exit']];
    for (const t of result.full.trades)
      rows.push([new Date(t.targetTime * 1000).toISOString(), t.direction, t.score, t.outcome, t.rsi.toFixed(2), t.adx.toFixed(2), t.entry, t.exit]);
    downloadTextFile(`m1nc_backtest_${settings.symbol}_trades.csv`, toCSV(rows));
  }, [result, settings.symbol]);

  const stats = result?.full.stats ?? null;
  const split = result?.split ?? null;

  const equityPath = useMemo(() => {
    if (!stats || stats.equity.length < 2) return null;
    const pts = stats.equity;
    const ys = pts.map(p => p.y);
    const min = Math.min(...ys, 0);
    const max = Math.max(...ys, 0);
    const span = Math.max(1e-9, max - min);
    const W = 640, H = 170, PAD = 8;
    const toXY = (p: { x: number; y: number }) => {
      const x = (p.x / (pts.length - 1)) * (W - PAD * 2) + PAD;
      const y = H - PAD - ((p.y - min) / span) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toXY(p)}`).join(' ');
    const area = `${line} L${(PAD + ((pts.length - 1) / (pts.length - 1)) * (W - PAD * 2)).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
    const zeroY = H - PAD - ((0 - min) / span) * (H - PAD * 2);
    return { line, area, zeroY, positive: pts[pts.length - 1].y >= 0 };
  }, [stats]);

  const topGrid = useMemo(() => {
    if (!split) return [];
    return [...split.grid].sort((a, b) => b.valAcc - a.valAcc).slice(0, 8);
  }, [split]);

  const verdict = useMemo(() => {
    if (!split) return null;
    const t = split.bestTestStats;
    if (t.trades < 30) return { tone: 'warn' as const, text: `Only ${t.trades} trades in the unseen test window — not enough evidence to trust any percentage. Gather more data before drawing conclusions.` };
    if (t.accuracy > split.bestTestStats.breakeven && split.bestTestStats.totalPnlUnits > 0)
      return { tone: 'good' as const, text: `Out-of-sample test: ${t.accuracy.toFixed(1)}% over ${t.trades} trades — above the ${t.breakeven.toFixed(2)}% break-even for ${payout}% payout. This is the only honest signal that the edge might be real, and even this can evaporate. Confirm in forward demo trading.` };
    return { tone: 'bad' as const, text: `Out-of-sample test: ${t.accuracy.toFixed(1)}% over ${t.trades} trades — below the ${t.breakeven.toFixed(2)}% break-even required at ${payout}% payout. This configuration is not profitable on unseen data. Do not trade it with real money.` };
  }, [split, payout]);

  return (
    <div className="dash-left" style={{ maxWidth: 1080 }}>
      {/* ── controls ─────────────────────────────────────────── */}
      <section className="panel panel-pad">
        <div className="panel-title">
          <span><FlaskConical size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Backtest controls — {settings.symbol}</span>
          <span style={{ font: '600 9px var(--mono)', color: 'var(--muted)' }}>NO LOOK-AHEAD · TIES LOSE</span>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field">
            <label>Candles<span className="hint">per run</span></label>
            <div className="segmented">
              {COUNTS.map(c => (
                <button key={c} className={count === c ? 'active' : ''} onClick={() => setCount(c)}>{c.toLocaleString()}</button>
              ))}
            </div>
          </div>
          <div className="field" style={{ width: 130 }}>
            <label>Payout %<span className="hint">net win</span></label>
            <input className="input" type="number" min={10} max={100} step={1} value={payoutPct} onChange={e => setPayoutPct(Number(e.target.value))} />
          </div>
          <div className="field" style={{ width: 130 }}>
            <label>Stake<span className="hint">{currency}</span></label>
            <input className="input" type="number" min={0.35} step={1} value={stake} onChange={e => setStake(Number(e.target.value))} />
          </div>
          <button className="btn btn-primary btn-lg" onClick={run} disabled={running}>
            {running ? <><Loader2 size={17} className="icon-spin" /> Running…</> : <><Play size={17} strokeWidth={2.4} /> Run backtest</>}
          </button>
        </div>

        {running && <div style={{ marginTop: 12, font: '600 11px var(--mono)', color: 'var(--cyan)' }}>{phase}</div>}
        {error && (
          <div className="verdict-box verdict-bad" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />{error}
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          Break-even at {payout}% payout ≈ <b style={{ color: '#e8edf7' }}>{beWin.toFixed(2)}%</b> win rate. The strategy fires only on 7–8/8 confirmations — a small number of high-quality trades by design. Results depend entirely on the instrument: test each Deriv market separately.
        </div>
      </section>

      {/* ── headline results ─────────────────────────────────── */}
      {stats && (
        <>
          <section className="panel panel-pad">
            <div className="panel-title"><span>As-configured performance · full sample ({split?.n1.toLocaleString()} candles)</span><span style={{ color: stats.accuracy >= beWin ? 'var(--bull)' : 'var(--bear)', font: '700 10px var(--mono)' }}>{stats.accuracy >= beWin ? 'ABOVE BREAK-EVEN' : 'BELOW BREAK-EVEN'}</span></div>
            <div className="kpi-grid">
              <div className="kpi"><div className="kpi-label">Accuracy</div><div className="kpi-value" style={{ color: stats.accuracy >= beWin ? 'var(--bull)' : 'var(--bear)' }}>{stats.accuracy.toFixed(1)}%</div><div className="kpi-sub">{stats.wins}W · {stats.losses}L · {stats.ties}T · n={stats.trades}</div></div>
              <div className="kpi"><div className="kpi-label">Net P/L</div><div className="kpi-value" style={{ color: stats.totalPnl >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{stats.totalPnl >= 0 ? '+' : ''}{fmtMoney(stats.totalPnl, currency)}</div><div className="kpi-sub">stake {fmtMoney(stake, currency)} × {stats.trades}</div></div>
              <div className="kpi"><div className="kpi-label">Expectancy / trade</div><div className="kpi-value" style={{ color: stats.expectancy >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{stats.expectancy >= 0 ? '+' : ''}{fmtMoney(stats.expectancy, currency)}</div><div className="kpi-sub">{fmtMoney(stats.per100, currency)} per 100 trades</div></div>
              <div className="kpi"><div className="kpi-label">Profit factor</div><div className="kpi-value">{Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}</div><div className="kpi-sub">gross profit / gross loss</div></div>
              <div className="kpi"><div className="kpi-label">Max drawdown</div><div className="kpi-value" style={{ color: 'var(--amber)' }}>{fmtMoney(stats.maxDrawdownUnits * stake, currency)}</div><div className="kpi-sub">peak → trough of equity</div></div>
              <div className="kpi"><div className="kpi-label">Max consec. losses</div><div className="kpi-value" style={{ color: stats.maxConsecLosses >= 3 ? 'var(--bear)' : '#e8edf7' }}>{stats.maxConsecLosses}</div><div className="kpi-sub">stop-rule threshold = 3</div></div>
            </div>
          </section>

          <section className="panel panel-pad">
            <div className="panel-title"><span>Equity curve (stake units)</span><span style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={exportCandles}><Download size={12} /> Candles CSV</button>
              <button className="btn btn-sm" onClick={exportTrades}><Download size={12} /> Trades CSV</button>
            </span></div>
            {equityPath ? (
              <svg className="equity-svg" viewBox="0 0 640 170" preserveAspectRatio="none" role="img" aria-label="Cumulative P and L in stake units">
                <defs>
                  <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={equityPath.positive ? '#34d399' : '#fb7185'} stopOpacity="0.34" />
                    <stop offset="100%" stopColor={equityPath.positive ? '#34d399' : '#fb7185'} stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <line x1="0" y1={equityPath.zeroY} x2="640" y2={equityPath.zeroY} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" strokeWidth="1" />
                <path d={equityPath.area} fill="url(#eqfill)" stroke="none" />
                <path d={equityPath.line} fill="none" stroke={equityPath.positive ? '#34d399' : '#fb7185'} strokeWidth="1.8" />
              </svg>
            ) : <div style={{ color: 'var(--muted)', fontSize: 12 }}>No trades were triggered in this sample.</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              {(['RISE', 'FALL'] as const).map(dir => {
                const acc = dir === 'RISE' ? stats.riseAccuracy : stats.fallAccuracy;
                const n = dir === 'RISE' ? stats.riseTrades : stats.fallTrades;
                return (
                  <div key={dir} className="kpi">
                    <div className="kpi-label">{dir === 'RISE' ? '▲ RISE' : '▼ FALL'} accuracy</div>
                    <div className="kpi-value">{n ? `${acc.toFixed(1)}%` : '—'}</div>
                    <div className="kpi-sub">n={n}</div>
                    <div className="risk-meter-track" style={{ marginTop: 8 }}>
                      <div className="risk-meter-fill" style={{ width: `${clamp(acc, 0, 100)}%`, background: dir === 'RISE' ? 'linear-gradient(90deg,#34d399,#10b981)' : 'linear-gradient(90deg,#fb7185,#f43f5e)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── by-hour breakdown ─────────────────────────────── */}
          {stats.byHour.length > 0 && (
            <section className="panel panel-pad">
              <div className="panel-title"><span>Accuracy by UTC hour</span><span style={{ font: '600 9px var(--mono)', color: 'var(--muted)' }}>WHERE YOUR EDGE LIVES (IF ANY)</span></div>
              <div className="table-wrap" style={{ maxHeight: 230 }}>
                <table className="data">
                  <thead><tr><th>UTC hour</th><th>Trades</th><th>Win rate</th><th>P/L</th></tr></thead>
                  <tbody>
                    {stats.byHour.map(h => (
                      <tr key={h.hour}>
                        <td>{String(h.hour).padStart(2, '0')}:00–{String(h.hour).padStart(2, '0')}:59</td>
                        <td>{h.trades}</td>
                        <td style={{ color: h.accuracy >= beWin ? 'var(--bull)' : h.trades >= 5 ? 'var(--bear)' : 'var(--muted)' }}>{h.accuracy.toFixed(1)}%</td>
                        <td style={{ color: h.pnl >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{h.pnl >= 0 ? '+' : ''}{fmtMoney(h.pnl, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── 60/20/20 walk-forward ──────────────────────────── */}
          {split && (
            <section className="panel panel-pad">
              <div className="panel-title"><span><ShieldCheck size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />60/20/20 walk-forward — the overfitting trap detector</span></div>
              <div className="split-cards">
                <div className="split-card">
                  <div className="sc-tag">1 · Develop (60%)</div>
                  <div className="split-acc">{split.dev.trades ? split.dev.accuracy.toFixed(1) + '%' : '—'}</div>
                  <div className="kpi-sub">n={split.dev.trades} trades · used to shape rules</div>
                </div>
                <div className="split-card">
                  <div className="sc-tag">2 · Select (20%)</div>
                  <div className="split-acc">{split.val.trades ? split.val.accuracy.toFixed(1) + '%' : '—'}</div>
                  <div className="kpi-sub">n={split.val.trades} trades · parameter selection</div>
                </div>
                <div className="split-card test">
                  <div className="sc-tag">3 · Unseen test (20%)</div>
                  <div className="split-acc" style={{ color: split.test.accuracy >= split.test.breakeven ? 'var(--bull)' : 'var(--bear)' }}>{split.test.trades ? split.test.accuracy.toFixed(1) + '%' : '—'}</div>
                  <div className="kpi-sub">n={split.test.trades} trades · never used to fit</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0', font: '500 10px var(--mono)', color: 'var(--muted)' }}>
                <span>Best grid combo → EMA <b style={{ color: '#e8edf7' }}>{split.bestCombo.emaFast}/{split.bestCombo.emaSlow}</b> · ADX min <b style={{ color: '#e8edf7' }}>{split.bestCombo.adxMin}</b></span>
                <span>·</span>
                <span>val {split.bestValAccuracy.toFixed(1)}% → test {split.bestTestAccuracy.toFixed(1)}%</span>
                <span>·</span>
                <span>overfit gap <b style={{ color: split.overfitGap > 8 ? 'var(--bear)' : '#e8edf7' }}>{split.overfitGap.toFixed(1)} pts</b></span>
              </div>

              {verdict && (
                <div className={`verdict-box ${verdict.tone === 'good' ? 'verdict-good' : verdict.tone === 'bad' ? 'verdict-bad' : 'verdict-warn'}`} style={{ display: 'flex', gap: 10 }}>
                  {verdict.tone === 'good' ? <CheckCircle2 size={16} style={{ flex: '0 0 auto', marginTop: 1 }} /> : <AlertTriangle size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />}
                  <span>{verdict.text}</span>
                </div>
              )}

              <div className="table-wrap" style={{ marginTop: 12, maxHeight: 250 }}>
                <table className="data">
                  <thead><tr><th>EMA 9/21 → grid</th><th>dev acc (n)</th><th>val acc (n)</th><th>test acc (n)</th></tr></thead>
                  <tbody>
                    {topGrid.map((g, i) => (
                      <tr key={i} style={g.params.emaFast === split.bestCombo.emaFast && g.params.emaSlow === split.bestCombo.emaSlow && g.params.adxMin === split.bestCombo.adxMin ? { background: 'rgba(34,211,238,0.06)' } : undefined}>
                        <td>{g.params.emaFast}/{g.params.emaSlow} · ADX≥{g.params.adxMin}{i === 0 ? ' ◄ val pick' : ''}</td>
                        <td>{g.devAcc.toFixed(1)}% ({g.devTrades})</td>
                        <td>{g.valAcc.toFixed(1)}% ({g.valTrades})</td>
                        <td style={{ color: g.testAcc >= beWin ? 'var(--bull)' : 'var(--bear)' }}>{g.testAcc.toFixed(1)}% ({g.testTrades})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="guide-note" style={{ marginTop: 12 }}>
                <Info size={12} style={{ verticalAlign: '-1px', marginRight: 6 }} />
                Reading this correctly: the grid was selected on validation data, and the test column is the closest thing to the future you have. If test accuracy is below break-even, the honest action is to not trade the system — or to restrict it to the instruments/hours where it survives out-of-sample. The 60/20/20 split exists precisely to stop you from curve-fitting indicator settings to history.
              </div>
            </section>
          )}
        </>
      )}

      {!stats && !running && (
        <section className="panel panel-pad" style={{ textAlign: 'center', padding: '34px 20px' }}>
          <FlaskConical size={34} style={{ color: 'var(--cyan)', opacity: 0.75, marginBottom: 12 }} />
          <div style={{ fontWeight: 800, fontSize: 16 }}>No backtest yet</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8, maxWidth: 460, marginInline: 'auto', lineHeight: 1.6 }}>
            Pull up to 10,000 real M1 candles for <b>{settings.symbol}</b> straight from Deriv, replay the strategy candle-by-candle, and see the truth: win rate, drawdown, break-even margin — and a 60/20/20 walk-forward so you can smell overfitting.
          </div>
        </section>
      )}
    </div>
  );
}
