// ─── Auto-Bot — risk-controlled execution (paper → Deriv demo → live) ───────
import { useMemo, useState } from 'react';
import {
  Bot, FlaskConical, Lock, ShieldCheck, ShieldAlert, Radio, KeyRound, LogOut,
  Loader2, RotateCcw, Trash2, Download, Power, TrendingDown, AlertTriangle, Banknote, ExternalLink,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { computeStake, breakevenWinRate } from '../lib/risk';
import { fmtMoney, fmtTimeHM, fmtTimeFull, toCSV, downloadTextFile, clamp, currencySymbol } from '../lib/format';
import type { JournalMode } from '../lib/types';

const MODES: { id: JournalMode; title: string; desc: string; icon: React.ReactNode; live?: boolean }[] = [
  { id: 'paper', title: 'Paper', desc: 'Simulated fills at candle prices. Zero risk. Balance tracked locally (default 10,000).', icon: <FlaskConical size={17} color="#22d3ee" /> },
  { id: 'demo', title: 'Deriv demo', desc: 'Places REAL 1-minute Rise/Fall contracts on your Deriv DEMO account via API token.', icon: <Radio size={17} color="#fbbf24" /> },
  { id: 'live', title: 'Live · real money', desc: 'Places real contracts with real funds. Requires a real-account token and explicit acknowledgement.', icon: <ShieldAlert size={17} color="#fb7185" />, live: true },
];

export default function BotPage() {
  const {
    settings, updateSettings, account, authorizing, authorize, logout,
    botArmed, armBot, disarmBot, journal, clearJournal,
    risk, resetRisk, paperBalance, resetPaperBalance, dayBaseline, toast, signal,
  } = useApp();

  const [tokenInput, setTokenInput] = useState('');
  const [liveAck, setLiveAck] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const mode = settings.botMode;
  const currency = mode === 'paper' ? settings.paperCurrency : (account?.currency ?? 'USD');
  const balance = mode === 'paper' ? paperBalance : (account?.balance ?? 0);
  const stakePreview = settings.useAutoStake ? computeStake(balance, settings.riskPct) : settings.stake;
  const dailyLimit = ((dayBaseline > 0 ? dayBaseline : balance) * settings.dailyLossPct) / 100;
  const dailyUsed = risk.dailyPnl < 0 ? clamp((-risk.dailyPnl / Math.max(dailyLimit, 1e-9)) * 100, 0, 100) : 0;
  const breakEven = breakevenWinRate(settings.payoutPct);

  const todays = useMemo(() => {
    const key = new Date().toISOString().slice(0, 10);
    return journal.filter(j => new Date(j.epoch * 1000).toISOString().slice(0, 10) === key);
  }, [journal]);
  const todaysPnl = todays.reduce((s, j) => s + (j.pnl ?? 0), 0);
  const todaysSettled = todays.filter(j => j.result !== undefined);
  const todaysWins = todaysSettled.filter(j => j.result === 'WIN').length;
  const openPositions = journal.filter(j => j.result === undefined);

  const canArm =
    mode === 'paper'
      ? true
      : mode === 'demo'
        ? Boolean(account?.isVirtual)
        : Boolean(account && !account.isVirtual && liveAck);

  const handleArm = () => {
    if (!canArm) {
      toast('error',
        mode === 'demo' ? 'Authorize your Deriv DEMO token first (the account must use virtual funds).'
        : 'Live mode requires a real-account token and the risk acknowledgement below.');
      return;
    }
    armBot(mode);
  };

  const exportJournal = () => {
    const rows: (string | number)[][] = [['time_utc', 'symbol', 'mode', 'direction', 'score', 'stake', 'currency', 'result', 'pnl']];
    for (const j of [...journal].reverse())
      rows.push([new Date(j.epoch * 1000).toISOString(), j.symbol, j.mode, j.direction, j.score, j.stake, j.currency, j.result ?? 'OPEN', j.pnl != null ? j.pnl.toFixed(2) : '']);
    downloadTextFile(`m1nc_journal_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows));
  };

  const sessionGrade = todaysSettled.length
    ? `${((todaysWins / todaysSettled.length) * 100).toFixed(0)}% win (${todaysWins}/${todaysSettled.length})`
    : 'no settled trades yet';

  return (
    <div className="bot-grid">
      {/* ══════════ Left: mode + auth + arming ══════════ */}
      <div className="bot-left">
        <section className="panel panel-pad">
          <div className="panel-title"><span><Bot size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Execution mode</span><span style={{ font: '600 9px var(--mono)', color: 'var(--muted)' }}>1-MINUTE RISE/FALL · STAKE IN / PAYOUT ON WIN</span></div>
          <div className="mode-grid">
            {MODES.map(m => (
              <button
                key={m.id}
                className={`mode-card ${mode === m.id ? 'selected' : ''} ${m.live ? 'live-card' : ''}`}
                onClick={() => updateSettings({ botMode: m.id })}
                aria-pressed={mode === m.id}
              >
                <h4>{m.icon}{m.title}</h4>
                <p>{m.desc}</p>
              </button>
            ))}
          </div>

          {/* ── Deriv authorization ── */}
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            {!account ? (
              <>
                <div className="field">
                  <label htmlFor="deriv-token">
                    Deriv API token
                    <span className="hint"><a href="https://app.deriv.com/account/api-token" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>create one <ExternalLink size={9} style={{ verticalAlign: '-1px' }} /></a></span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <KeyRound size={14} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--muted)' }} />
                      <input
                        id="deriv-token"
                        type="password"
                        className="input"
                        style={{ paddingLeft: 33 }}
                        placeholder={mode === 'live' ? 'Real-account token (read + trade scope)' : 'Demo-account token'}
                        value={tokenInput}
                        onChange={e => setTokenInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') authorize(tokenInput); }}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <button className="btn btn-primary" onClick={() => authorize(tokenInput)} disabled={authorizing || !tokenInput.trim()}>
                      {authorizing ? <Loader2 size={16} className="icon-spin" /> : <Lock size={15} />}
                      Authorize
                    </button>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                  <input type="checkbox" className="toggle" style={{ width: 34, height: 19 }} checked={settings.rememberToken} onChange={e => updateSettings({ rememberToken: e.target.checked })} />
                  Remember token on this device (stored in browser localStorage)
                </label>
                <div style={{ fontSize: 9.5, color: '#5d6c8f', marginTop: 6 }}>Scope required: <b>read + trade</b>. The token is sent only to Deriv over WSS — never to any third party. Paper mode needs no token.</div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'var(--panel-c)', border: '1px solid var(--border)', borderRadius: 13, padding: '12px 14px' }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', background: account.isVirtual ? 'rgba(251,191,36,.12)' : 'rgba(251,113,133,.12)', border: `1px solid ${account.isVirtual ? 'rgba(251,191,36,.4)' : 'rgba(251,113,133,.4)'}` }}>
                  <Banknote size={20} color={account.isVirtual ? '#fbbf24' : '#fb7185'} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: '700 13px var(--mono)' }}>{account.loginid}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{account.isVirtual ? 'DEMO account — virtual funds' : 'REAL account — real money'}</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div className="kpi-value" style={{ fontSize: 19 }}>{fmtMoney(account.balance, account.currency)}</div>
                  <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={logout}><LogOut size={11} /> Sign out</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Live acknowledgement ── */}
          {mode === 'live' && (
            <div className="verdict-box verdict-bad" style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', gap: 10, cursor: 'pointer', alignItems: 'flex-start' }}>
                <input type="checkbox" className="toggle" style={{ marginTop: 2, flex: '0 0 auto' }} checked={liveAck} onChange={e => setLiveAck(e.target.checked)} />
                <span style={{ fontSize: 11, lineHeight: 1.55 }}>
                  <b>I understand the risk.</b> Deriv Rise/Fall contracts can lose 100% of the stake. This bot will place real 1-minute contracts with real money based on technical rules that have not been proven to hold on unseen data. Winning trades return only the quoted payout. I have read the backtest and demo results for my chosen instrument and accept full responsibility.
                </span>
              </label>
            </div>
          )}
        </section>

        {/* ── Arm / disarm ── */}
        <section className="panel arm-panel">
          <div className="panel-title" style={{ justifyContent: 'center' }}><span><Power size={12} style={{ verticalAlign: '-1px', marginRight: 6 }} />Bot switch</span></div>
          <div className={`arm-status ${botArmed ? 'armed' : 'disarmed'}`}>{botArmed ? `● Armed — ${mode.toUpperCase()}` : '○ Disarmed'}</div>
          <div style={{ font: '500 10.5px var(--mono)', color: 'var(--muted)', marginTop: 4 }}>
            {signal?.tradeable
              ? <>current signal: <b style={{ color: signal.direction === 'RISE' ? 'var(--bull)' : 'var(--bear)' }}>{signal.direction}</b> @ {signal.score}/8{signal.score >= settings.minScore ? ' — would execute on next boundary' : ''}</>
              : 'waiting for a 7–8/8 signal at a candle boundary'}
          </div>
          <button
            className={`btn btn-lg arm-big-btn ${botArmed ? 'btn-danger' : mode === 'live' ? 'btn-bear' : 'btn-primary'}`}
            onClick={() => (botArmed ? disarmBot() : handleArm())}
          >
            <Power size={18} strokeWidth={2.4} />
            {botArmed ? 'DISARM BOT' : `ARM ${mode.toUpperCase()} BOT`}
          </button>
          <div className="arm-meta">
            stake <b style={{ color: '#e8edf7' }}>{fmtMoney(stakePreview, currency)}</b> ({settings.useAutoStake ? `${settings.riskPct}% of balance` : 'fixed'}) · payout {settings.payoutPct}% (break-even {breakEven.toFixed(2)}%) · min score {settings.minScore}/8 · one open contract max · no martingale
          </div>
          {risk.stopped && (
            <div className="halt-banner" style={{ marginTop: 12 }}>
              <ShieldAlert size={18} style={{ flex: '0 0 auto' }} />
              <span><b>Bot halted by risk rules.</b> {risk.stoppedReason}. Trading does not resume until you reset the counters.</span>
              <button className="btn btn-sm" onClick={resetRisk} style={{ marginLeft: 'auto', flex: '0 0 auto' }}><RotateCcw size={12} /> Reset</button>
            </div>
          )}
        </section>

        {/* ── Risk & stake configuration ── */}
        <section className="panel panel-pad">
          <div className="panel-title"><span><ShieldCheck size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Risk rules</span><span style={{ font: '600 9px var(--mono)', color: 'var(--muted)' }}>HARD LIMITS — NOT SUGGESTIONS</span></div>
          <div className="field-grid">
            <div className="field">
              <label>Risk per trade<span className="hint">% of balance</span></label>
              <input className="input" type="number" min={0.1} max={5} step={0.1} value={settings.riskPct} disabled={!settings.useAutoStake} onChange={e => updateSettings({ riskPct: clamp(Number(e.target.value) || 0.1, 0.1, 5) })} />
            </div>
            <div className="field">
              <label>Stake mode<span className="hint">auto = % of balance</span></label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', height: 42 }}>
                <input id="auto-stake" type="checkbox" className="toggle" checked={settings.useAutoStake} onChange={e => updateSettings({ useAutoStake: e.target.checked })} />
                <label htmlFor="auto-stake" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>{settings.useAutoStake ? 'Auto (recommended)' : 'Fixed stake'}</label>
              </div>
            </div>
            {!settings.useAutoStake && (
              <div className="field">
                <label>Fixed stake<span className="hint">{currency}</span></label>
                <input className="input" type="number" min={0.35} step={0.5} value={settings.stake} onChange={e => updateSettings({ stake: Math.max(0.35, Number(e.target.value) || 0) })} />
              </div>
            )}
            <div className="field">
              <label>Payout %<span className="hint">net on win</span></label>
              <input className="input" type="number" min={10} max={100} step={1} value={settings.payoutPct} onChange={e => updateSettings({ payoutPct: clamp(Number(e.target.value) || 85, 10, 100) })} />
            </div>
            <div className="field">
              <label>Max daily loss<span className="hint">% of day-open balance</span></label>
              <input className="input" type="number" min={0.5} max={20} step={0.5} value={settings.dailyLossPct} onChange={e => updateSettings({ dailyLossPct: clamp(Number(e.target.value) || 3, 0.5, 20) })} />
            </div>
            <div className="field">
              <label>Stop after N losses<span className="hint">consecutive</span></label>
              <input className="input" type="number" min={1} max={10} step={1} value={settings.maxConsecLosses} onChange={e => updateSettings({ maxConsecLosses: clamp(Math.round(Number(e.target.value) || 3), 1, 10) })} />
            </div>
            <div className="field">
              <label>Minimum score<span className="hint">of 8 factors</span></label>
              <div className="segmented">
                {[7, 8].map(s => (
                  <button key={s} className={settings.minScore === s ? 'active' : ''} onClick={() => updateSettings({ minScore: s })}>{s}/8</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Paper currency<span className="hint">simulation ledger</span></label>
              <select className="input" value={settings.paperCurrency} onChange={e => updateSettings({ paperCurrency: e.target.value })}>
                {['ZMW', 'USD', 'EUR', 'GBP', 'ZAR', 'AUD', 'CAD', 'JPY', 'NGN', 'KES', 'GHS'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
            <Lock size={10} style={{ verticalAlign: '-1px', marginRight: 5 }} />
            Martingale is not implemented and never will be here — stakes do not increase after losses. Stake is sized from balance at execution time and capped by your risk %; the daily-loss and consecutive-loss halts override everything, including a perfect-looking signal.
          </div>
        </section>
      </div>

      {/* ══════════ Right: ledger + journal ══════════ */}
      <div className="bot-right">
        <section className="panel panel-pad">
          <div className="panel-title">
            <span><TrendingDown size={12} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--cyan)' }} />Risk status — today ({new Date().toISOString().slice(0, 10)})</span>
            <button className="btn btn-sm" onClick={resetPaperBalance} title="Reset paper balance to 10,000"><RotateCcw size={12} /> Paper reset</button>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
            <div className="kpi"><div className="kpi-label">Balance · {mode}</div><div className="kpi-value" style={{ fontSize: 18 }}>{fmtMoney(balance, currency)}</div><div className="kpi-sub">{mode === 'paper' ? 'simulated ledger' : account?.isVirtual ? 'demo account' : 'real account'}</div></div>
            <div className="kpi"><div className="kpi-label">Today P/L</div><div className="kpi-value" style={{ fontSize: 18, color: todaysPnl >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{todaysPnl >= 0 ? '+' : ''}{fmtMoney(todaysPnl, currency)}</div><div className="kpi-sub">{sessionGrade}</div></div>
            <div className="kpi"><div className="kpi-label">Trades today</div><div className="kpi-value" style={{ fontSize: 18 }}>{todays.length}</div><div className="kpi-sub">{openPositions.length} open</div></div>
            <div className="kpi"><div className="kpi-label">Break-even win rate</div><div className="kpi-value" style={{ fontSize: 18 }}>{breakEven.toFixed(1)}%</div><div className="kpi-sub">at {settings.payoutPct}% payout</div></div>
          </div>

          <div className="risk-meter">
            <div style={{ display: 'flex', justifyContent: 'space-between', font: '600 9.5px var(--mono)', color: 'var(--muted)', marginBottom: 5 }}>
              <span>DAILY LOSS USED</span>
              <span>{risk.dailyPnl >= 0 ? '+' : ''}{fmtMoney(risk.dailyPnl, currency)} / limit −{fmtMoney(dailyLimit, currency)} ({settings.dailyLossPct}%)</span>
            </div>
            <div className="risk-meter-track"><div className="risk-meter-fill" style={{ width: `${dailyUsed}%` }} /></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div className="kpi-label" style={{ marginBottom: 6 }}>Consecutive losses</div>
              <div className="consec-dots">
                {Array.from({ length: settings.maxConsecLosses }, (_, i) => (
                  <div key={i} className={`consec-dot ${i < risk.consecutiveLosses ? 'hit' : ''}`}>{i + 1}</div>
                ))}
              </div>
            </div>
            {risk.stopped
              ? <span className="chip chip-closed"><span className="dot" />HALTED</span>
              : botArmed
                ? <span className="chip chip-live"><span className="dot" />TRADING</span>
                : <span className="chip"><span className="dot" />STANDBY</span>}
          </div>
        </section>

        <section className="panel panel-pad">
          <div className="panel-title">
            <span>Execution journal</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={exportJournal} disabled={journal.length === 0}><Download size={12} /> CSV</button>
              {confirmClear ? (
                <button className="btn btn-sm btn-danger" onClick={() => { clearJournal(); setConfirmClear(false); }}><Trash2 size={12} /> Confirm clear</button>
              ) : (
                <button className="btn btn-sm" onClick={() => { setConfirmClear(true); window.setTimeout(() => setConfirmClear(false), 3000); }}><Trash2 size={12} /> Clear</button>
              )}
            </span>
          </div>
          {journal.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, padding: '26px 16px', lineHeight: 1.7 }}>
              <Bot size={26} style={{ opacity: 0.6, marginBottom: 10 }} /><br />
              No executions logged yet. Arm the bot in <b>paper</b> mode and walk away —<br />every 7/8 signal at a candle boundary gets journaled here with its outcome.
            </div>
          ) : (
            <div className="table-wrap journal-wrap">
              <table className="data">
                <thead><tr><th>Time (UTC)</th><th>Mode</th><th>Side</th><th>Score</th><th>Stake</th><th>Result</th><th>P/L</th></tr></thead>
                <tbody>
                  {journal.slice(0, 60).map(j => (
                    <tr key={j.id}>
                      <td title={fmtTimeFull(j.epoch)}>{fmtTimeHM(j.epoch)}</td>
                      <td><span className={`chip ${j.mode === 'paper' ? 'chip-paper' : j.mode === 'demo' ? 'chip-demo' : 'chip-real'}`} style={{ padding: '2px 7px', fontSize: 8.5 }}>{j.mode.toUpperCase()}</span></td>
                      <td style={{ color: j.direction === 'RISE' ? 'var(--bull)' : 'var(--bear)' }}>{j.direction === 'RISE' ? '▲ RISE' : '▼ FALL'}</td>
                      <td>{j.score}/8</td>
                      <td>{currencySymbol(j.currency)}{j.stake.toFixed(2)}</td>
                      <td className={j.result ? `outcome-${j.result}` : ''}>{j.result ?? 'OPEN…'}</td>
                      <td style={{ color: (j.pnl ?? 0) >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{j.pnl == null ? '—' : `${j.pnl >= 0 ? '+' : ''}${fmtMoney(j.pnl, j.currency)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 9.5, color: '#5d6c8f', marginTop: 10, lineHeight: 1.6 }}>
            Journal is stored locally in this browser. Deriv settles 1-minute contracts against its own spot prices — entry/exit spots can differ a fraction from chart opens. Paper results approximate; demo results are real contract outcomes on virtual funds.
          </div>
        </section>
      </div>
    </div>
  );
}
