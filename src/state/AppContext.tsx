// ─── Global app state: connection, candles, signal engine, bot, journal ──────
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { DerivClient, DerivError } from '../lib/derivApi';
import { DEFAULT_PARAMS, computeIndicators, evaluateAt, evaluateLatest } from '../lib/strategy';
import {
  applySettlement, checkRiskAllowsTrade, computeStake, currentDayKey, resetRiskIfNewDay,
} from '../lib/risk';
import { loadJSON, saveJSON, STORAGE_KEYS } from '../lib/storage';
import type {
  AccountInfo, ActiveSymbol, Candle, DerivWsStatus, JournalEntry, JournalMode,
  PredictionLogEntry, RiskState, SignalResult, StrategyParams,
} from '../lib/types';
import { DEFAULT_RISK } from '../lib/risk';

// ─── Settings ────────────────────────────────────────────────────────────────
export interface Settings {
  appId: string;
  token: string;
  rememberToken: boolean;
  symbol: string;
  botMode: JournalMode;
  useAutoStake: boolean;
  stake: number;
  riskPct: number;
  payoutPct: number;
  dailyLossPct: number;
  maxConsecLosses: number;
  minScore: number;
  paperCurrency: string;
}

export const DEFAULT_SETTINGS: Settings = {
  appId: '1089',
  token: '',
  rememberToken: false,
  symbol: 'R_100',
  botMode: 'paper',
  useAutoStake: true,
  stake: 10,
  riskPct: 1,
  payoutPct: 85,
  dailyLossPct: 3,
  maxConsecLosses: 3,
  minScore: 7,
  paperCurrency: 'ZMW',
};

export interface Toast { id: number; kind: 'info' | 'success' | 'warn' | 'error'; text: string }

interface AppContextValue {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  params: StrategyParams;

  status: DerivWsStatus;
  symbols: ActiveSymbol[];
  symbolsLoading: boolean;
  selectedSymbol: ActiveSymbol | null;
  selectSymbol: (s: string) => void;

  m1Candles: Candle[];
  m5Candles: Candle[];
  lastTickAt: number;
  signal: SignalResult | null;
  fetchCandles: (symbol: string, granularity: 60 | 300, count: number) => Promise<Candle[]>;

  account: AccountInfo | null;
  authorizing: boolean;
  authorize: (token?: string) => Promise<void>;
  logout: () => void;

  // Bot / execution
  botArmed: boolean;
  armBot: (mode: JournalMode) => void;
  disarmBot: () => void;
  journal: JournalEntry[];
  clearJournal: () => void;
  risk: RiskState;
  resetRisk: () => void;
  paperBalance: number;
  resetPaperBalance: () => void;
  dayBaseline: number;

  // Track record from logged predictions
  predictions: PredictionLogEntry[];
  clearPredictions: () => void;

  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

const FALLBACK_SYMBOLS: ActiveSymbol[] = [
  { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'R_75', display_name: 'Volatility 75 Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'R_50', display_name: 'Volatility 50 Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'R_25', display_name: 'Volatility 25 Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'R_10', display_name: 'Volatility 10 Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'stpRNG', display_name: 'Step Index', market: 'synthetic_index', submarket: 'random_index', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'frxEURUSD', display_name: 'EUR/USD', market: 'forex', submarket: 'major_pairs', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'frxGBPUSD', display_name: 'GBP/USD', market: 'forex', submarket: 'major_pairs', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'frxUSDJPY', display_name: 'USD/JPY', market: 'forex', submarket: 'major_pairs', exchange_is_open: 1, is_trading_suspended: 0 },
  { symbol: 'frxAUDUSD', display_name: 'AUD/USD', market: 'forex', submarket: 'major_pairs', exchange_is_open: 1, is_trading_suspended: 0 },
];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...loadJSON(STORAGE_KEYS.settings, DEFAULT_SETTINGS) }));
  const [status, setStatus] = useState<DerivWsStatus>('idle');
  const [symbols, setSymbols] = useState<ActiveSymbol[]>(FALLBACK_SYMBOLS);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [m1Candles, setM1Candles] = useState<Candle[]>([]);
  const [m5Candles, setM5Candles] = useState<Candle[]>([]);
  const [lastTickAt, setLastTickAt] = useState(0);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [botArmed, setBotArmed] = useState(false);
  const [journal, setJournal] = useState<JournalEntry[]>(() => loadJSON(STORAGE_KEYS.journal, []));
  const [predictions, setPredictions] = useState<PredictionLogEntry[]>(() => loadJSON(STORAGE_KEYS.predictions, []));
  const [paperBalance, setPaperBalance] = useState<number>(() => loadJSON(STORAGE_KEYS.paperBalance, 10000));
  const [risk, setRisk] = useState<RiskState>(() => resetRiskIfNewDay(loadJSON(STORAGE_KEYS.risk, DEFAULT_RISK)));
  const [dayBaseline, setDayBaseline] = useState<number>(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const clientRef = useRef<DerivClient | null>(null);
  const unsubRef = useRef<Array<() => Promise<void>>>([]);
  const balanceUnsubRef = useRef<(() => Promise<void>) | null>(null);
  const processedCloseRef = useRef<number>(0);
  const processedPredCloseRef = useRef<number>(0);
  const toastId = useRef(0);
  const riskRef = useRef(risk);
  riskRef.current = risk;
  const paperBalanceRef = useRef(paperBalance);
  paperBalanceRef.current = paperBalance;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const accountRef = useRef(account);
  accountRef.current = account;
  const journalRef = useRef(journal);
  journalRef.current = journal;
  const botArmedRef = useRef(botArmed);
  botArmedRef.current = botArmed;
  const dayBaselineRef = useRef(dayBaseline);
  dayBaselineRef.current = dayBaseline;

  const params = useMemo<StrategyParams>(() => ({ ...DEFAULT_PARAMS, scoreMin: settings.minScore }), [settings.minScore]);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts(t => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);

  // ── persist settings ───────────────────────────────────────────────────────
  useEffect(() => {
    saveJSON(STORAGE_KEYS.settings, {
      ...settings,
      token: settings.rememberToken ? settings.token : '',
    });
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(s => {
      const next = { ...s, ...patch };
      if (patch.rememberToken === false) next.token = '';
      return next;
    });
  }, []);

  useEffect(() => { saveJSON(STORAGE_KEYS.journal, journal.slice(0, 300)); }, [journal]);
  useEffect(() => { saveJSON(STORAGE_KEYS.predictions, predictions.slice(0, 300)); }, [predictions]);
  useEffect(() => { saveJSON(STORAGE_KEYS.paperBalance, paperBalance); }, [paperBalance]);
  useEffect(() => { saveJSON(STORAGE_KEYS.risk, risk); }, [risk]);

  // Day rollover guard
  useEffect(() => {
    const id = window.setInterval(() => setRisk(r => resetRiskIfNewDay(r)), 60000);
    return () => window.clearInterval(id);
  }, []);

  // ── Deriv connection ───────────────────────────────────────────────────────
  useEffect(() => {
    const client = new DerivClient(settings.appId);
    clientRef.current = client;
    const offStatus = client.onStatus(setStatus);
    const offError = client.onError(msg => toast('warn', msg));
    client.connect();
    return () => {
      offStatus();
      offError();
      unsubRef.current.forEach(u => u().catch(() => {}));
      unsubRef.current = [];
      client.disconnect();
      clientRef.current = null;
    };
    // reconnect only when appId changes
  }, [settings.appId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load symbol universe once connected
  useEffect(() => {
    if (status !== 'connected' && status !== 'authorized') return;
    const client = clientRef.current;
    if (!client) return;
    setSymbolsLoading(true);
    client.getActiveSymbols()
      .then(list => { if (list.length) setSymbols(list); })
      .catch(() => { /* keep fallback list */ })
      .finally(() => setSymbolsLoading(false));
  }, [status]);

  const selectSymbol = useCallback((s: string) => updateSettings({ symbol: s }), [updateSettings]);

  const fetchCandles = useCallback(async (symbol: string, granularity: 60 | 300, count: number) => {
    const client = clientRef.current;
    if (!client) throw new Error('Not connected to Deriv');
    return client.getCandles(symbol, granularity, count);
  }, []);

  // Subscribe to candles for the selected instrument
  useEffect(() => {
    const client = clientRef.current;
    if (!client || (status !== 'connected' && status !== 'authorized')) return;
    const symbol = settings.symbol;
    setM1Candles([]);
    setM5Candles([]);
    processedCloseRef.current = 0;
    processedPredCloseRef.current = 0;
    let cancelled = false;

    const snapshotTo = (p: 'm1' | 'm5') => (candles: Candle[]) => {
      if (cancelled) return;
      if (p === 'm1') setM1Candles(candles);
      else setM5Candles(candles);
      setLastTickAt(Date.now());
    };
    const updateTo = (p: 'm1' | 'm5') => (candle: Candle) => {
      if (cancelled) return;
      setLastTickAt(Date.now());
      if (p === 'm1') {
        setM1Candles(prev => {
          if (prev.length === 0) return [candle];
          const last = prev[prev.length - 1];
          if (candle.time === last.time) {
            const next = prev.slice(0, -1);
            next.push(candle);
            return next;
          }
          if (candle.time > last.time) {
            const next = [...prev, candle];
            return next.length > 400 ? next.slice(next.length - 400) : next;
          }
          return prev;
        });
      } else {
        setM5Candles(prev => {
          if (prev.length === 0) return [candle];
          const last = prev[prev.length - 1];
          if (candle.time === last.time) {
            const next = prev.slice(0, -1);
            next.push(candle);
            return next;
          }
          if (candle.time > last.time) {
            const next = [...prev, candle];
            return next.length > 300 ? next.slice(next.length - 300) : next;
          }
          return prev;
        });
      }
    };

    client.subscribeCandles(symbol, 60, 240, {
      onSnapshot: snapshotTo('m1'),
      onUpdate: updateTo('m1'),
      onError: m => toast('error', `M1 feed: ${m}`),
    }).then(unsub => { if (cancelled) unsub(); else unsubRef.current.push(unsub); })
      .catch(e => toast('error', `Could not subscribe to ${symbol}: ${e?.message ?? e}`));

    client.subscribeCandles(symbol, 300, 260, {
      onSnapshot: snapshotTo('m5'),
      onUpdate: updateTo('m5'),
      onError: m => toast('error', `M5 feed: ${m}`),
    }).then(unsub => { if (cancelled) unsub(); else unsubRef.current.push(unsub); })
      .catch(e => toast('warn', `M5 feed unavailable for ${symbol}`));

    return () => {
      cancelled = true;
      const subs = unsubRef.current;
      unsubRef.current = [];
      subs.forEach(u => u().catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, settings.symbol]);

  // ── Signal from completed candles ───────────────────────────────────────────
  const signal = useMemo<SignalResult | null>(() => {
    if (m1Candles.length < 60) return null;
    try {
      return evaluateLatest(m1Candles, m5Candles, params);
    } catch {
      return null;
    }
  }, [m1Candles, m5Candles, params]);

  // ── Candle close engine: grade predictions, log new one, execute bot ───────
  useEffect(() => {
    if (m1Candles.length < 2) return;
    const last = m1Candles[m1Candles.length - 1];
    const isForming = Date.now() / 1000 < last.time + 60;
    const closed = isForming ? m1Candles[m1Candles.length - 2] : last;
    if (!closed || closed.time === processedCloseRef.current) return;
    processedCloseRef.current = closed.time;

    // 1) Grade pending predictions targeting this candle
    const actualDir = closed.close > closed.open ? 'RISE' : closed.close < closed.open ? 'FALL' : 'TIE';
    setPredictions(prev => prev.map(p => (
      p.targetTime === closed.time && p.actual === undefined
        ? {
            ...p,
            actual: actualDir,
            correct: actualDir === 'TIE' ? null : p.lean === actualDir,
          }
        : p
    )));

    // 2) Compute fresh signal ON completed candles through `closed`
    const idx = m1Candles.findIndex(c => c.time === closed.time);
    const completed = m1Candles.slice(0, idx + 1);
    let fresh: SignalResult | null = null;
    try {
      const bundle = computeIndicators(completed, m5Candles, params);
      fresh = evaluateAt(completed, bundle, params, { atIndex: completed.length - 1, targetTime: closed.time + 60 });
    } catch { /* ignore */ }

    if (fresh) {
      setPredictions(prev => {
        const lean = fresh!.lean;
        const tradeableDir = fresh!.tradeable && fresh!.direction !== 'NO_TRADE' ? fresh!.direction : null;
        const entry: PredictionLogEntry = {
          id: `${closed.time + 60}-${settingsRef.current.symbol}`,
          targetTime: closed.time + 60,
          symbol: settingsRef.current.symbol,
          direction: tradeableDir ?? (lean === 'FALL' ? 'LEAN_FALL' : 'LEAN_RISE'),
          lean,
          tradeable: fresh!.tradeable,
          score: fresh!.score,
          rsi: fresh!.metrics.rsi,
          adx: fresh!.metrics.adx,
        };
        const dup = prev.some(p => p.id === entry.id);
        return dup ? prev : [entry, ...prev].slice(0, 300);
      });
    }

    // 3) Bot execution
    const s = settingsRef.current;
    if (fresh?.tradeable && fresh.direction !== 'NO_TRADE') {
      executeSignalTrade(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m1Candles]);

  // ── Execution plumbing ─────────────────────────────────────────────────────
  const currentBalance = useCallback(() => {
    const s = settingsRef.current;
    return s.botMode === 'paper' ? paperBalanceRef.current : (accountRef.current?.balance ?? 0);
  }, []);

  const openPositions = journal.filter(j => j.result === undefined).length;
  const openPositionsRef = useRef(openPositions);
  openPositionsRef.current = openPositions;

  const executeSignalTrade = useCallback((sig: SignalResult) => {
    const s = settingsRef.current;
    if (!botArmedRef.current) return;
    const client = clientRef.current;

    const balance = s.botMode === 'paper' ? paperBalanceRef.current : (accountRef.current?.balance ?? 0);
    const stake = s.useAutoStake ? computeStake(balance, s.riskPct) : s.stake;
    const baseline = dayBaselineRef.current > 0 ? dayBaselineRef.current : balance;

    const gate = checkRiskAllowsTrade({
      risk: riskRef.current,
      stake,
      balance,
      dailyLossPct: s.dailyLossPct,
      maxConsecLosses: s.maxConsecLosses,
      baselineBalance: baseline,
      openPositions: openPositionsRef.current,
    });
    if (!gate.ok) {
      toast('warn', `Signal ${sig.direction} skipped — ${gate.reason}`);
      return;
    }
    if (s.botMode !== 'paper') {
      if (!accountRef.current) { toast('error', 'Authorize a Deriv account first'); return; }
      if (s.botMode === 'demo' && !accountRef.current.isVirtual) {
        toast('error', 'Demo mode requires a Deriv DEMO token — authorize your practice account');
        return;
      }
    }

    const direction = sig.direction as 'RISE' | 'FALL';
    const symbol = s.symbol;
    const currency = s.botMode === 'paper' ? s.paperCurrency : (accountRef.current?.currency ?? 'USD');

    if (s.botMode === 'paper') {
      const entry: JournalEntry = {
        id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        epoch: sig.targetTime,
        symbol, mode: 'paper', direction,
        score: sig.score, stake, currency, payoutPct: s.payoutPct,
        entryPrice: sig.metrics.prevClose, // ≈ open of target candle
      };
      setJournal(j => [entry, ...j]);
      markBaseline(balance);
      toast('info', `PAPER ${direction} · stake ${currencySymbolSafe(currency)}${stake.toFixed(2)} · ${sig.score}/8`);
      return;
    }

    // Real API execution (demo or armed live)
    if (!client) { toast('error', 'Not connected to Deriv'); return; }
    client.placeRiseFall({ symbol, direction, stake, currency })
      .then(({ contractId, buyPrice, payout }) => {
        const entry: JournalEntry = {
          id: `${s.botMode}-${contractId}`,
          epoch: sig.targetTime, symbol, mode: s.botMode, direction,
          score: sig.score, stake: buyPrice, currency, payoutPct: s.payoutPct,
          entryPrice: sig.metrics.prevClose, contractId,
        };
        setJournal(j => [entry, ...j]);
        markBaseline(balance);
        toast('success', `${s.botMode === 'demo' ? 'DEMO' : 'LIVE'} ${direction} placed · id ${contractId} · stake ${buyPrice}`);
        // Track until settled
        client.trackContract(contractId, upd => {
          if (!upd.isSold) return;
          setJournal(j => settleJournal(j, String(contractId), upd, s.payoutPct));
          settleRisk(upd.profit, s);
        }).catch(() => { /* subscription may drop; settlement sync via manual refresh */ });
      })
      .catch(err => {
        toast('error', `Order failed: ${err?.message ?? err}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const markBaseline = useCallback((balance: number) => {
    setDayBaseline(b => {
      const key = currentDayKey();
      const stored = loadJSON<{ key: string; value: number }>('m1nc.dayBaseline.v1', { key: '', value: 0 });
      if (stored.key === key && stored.value > 0) return stored.value;
      const nb = balance;
      saveJSON('m1nc.dayBaseline.v1', { key, value: nb });
      return nb;
    });
  }, []);

  const settleRisk = useCallback((pnl: number, s: Settings) => {
    setRisk(r => applySettlement(resetRiskIfNewDay(r), pnl, s.dailyLossPct, dayBaselineRef.current || balanceFallback(accountRef, paperBalanceRef), s.maxConsecLosses));
  }, []);

  // ── Settle paper trades when their candle closes ──────────────────────────
  const settledIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (m1Candles.length === 0) return;
    const s = settingsRef.current;
    const nowS = Date.now() / 1000;
    const closeMap = new Map(m1Candles.filter(c => nowS >= c.time + 60).map(c => [c.time, c]));
    // Decide in render-safe order, outside the state updater
    const toSettle = journalRef.current.filter(
      j => j.result === undefined && j.mode === 'paper' && closeMap.has(j.epoch) && !settledIdsRef.current.has(j.id),
    );
    if (toSettle.length === 0) return;
    for (const entry of toSettle) {
      settledIdsRef.current.add(entry.id);
      const candle = closeMap.get(entry.epoch)!;
      const tie = candle.close === candle.open;
      const win = entry.direction === 'RISE' ? candle.close > candle.open : candle.close < candle.open;
      const pnl = tie ? -entry.stake : win ? (entry.stake * entry.payoutPct) / 100 : -entry.stake;
      setPaperBalance(b => b + pnl);
      settleRisk(pnl, s);
    }
    setJournal(prev => prev.map(entry => {
      if (!settledIdsRef.current.has(entry.id) || entry.result !== undefined) return entry;
      const candle = closeMap.get(entry.epoch)!;
      const tie = candle.close === candle.open;
      const win = entry.direction === 'RISE' ? candle.close > candle.open : candle.close < candle.open;
      const pnl = tie ? -entry.stake : win ? (entry.stake * entry.payoutPct) / 100 : -entry.stake;
      return {
        ...entry,
        exitPrice: candle.close,
        result: tie ? ('TIE' as const) : win ? ('WIN' as const) : ('LOSS' as const),
        pnl,
        settledAt: Date.now(),
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m1Candles]);

  // Auto-disarm when risk engine halts
  useEffect(() => {
    if (risk.stopped && botArmed) {
      setBotArmed(false);
      toast('warn', risk.stoppedReason ?? 'Bot halted by risk rules');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risk.stopped]);

  // ── Account / auth ─────────────────────────────────────────────────────────
  const authorize = useCallback(async (tokenArg?: string) => {
    const client = clientRef.current;
    const token = (tokenArg ?? settingsRef.current.token).trim();
    if (!client) { toast('error', 'Not connected'); return; }
    if (!token) { toast('error', 'Enter a Deriv API token'); return; }
    setAuthorizing(true);
    try {
      const info = await client.authorize(token);
      setAccount(info);
      toast('success', `Authorized ${info.loginid} · ${info.isVirtual ? 'DEMO' : 'REAL'} · ${info.currency}`);
      // Live balance pushes — replace any previous subscription
      const prev = balanceUnsubRef.current;
      balanceUnsubRef.current = null;
      prev?.().catch(() => {});
      client.subscribeBalance(b => setAccount(a => (a ? { ...a, balance: b.balance, currency: b.currency } : a)))
        .then(unsub => { balanceUnsubRef.current = unsub; })
        .catch(() => {});
    } catch (e: any) {
      toast('error', e instanceof DerivError ? e.message : 'Authorization failed');
    } finally {
      setAuthorizing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const logout = useCallback(() => {
    setAccount(null);
    setBotArmed(false);
    updateSettings({ token: '' });
    const unsub = balanceUnsubRef.current;
    balanceUnsubRef.current = null;
    unsub?.().catch(() => {});
    toast('info', 'Signed out — token cleared from this session');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateSettings, toast]);

  const armBot = useCallback((mode: JournalMode) => {
    if (riskRef.current.stopped) {
      toast('error', `Cannot arm — ${riskRef.current.stoppedReason ?? 'risk halt active'}. Reset risk counters to override.`);
      return;
    }
    updateSettings({ botMode: mode });
    setBotArmed(true);
    toast('success', mode === 'paper' ? 'Paper bot armed' : mode === 'demo' ? 'Demo bot armed — real orders on your DEMO account' : 'LIVE bot armed — real money at risk');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateSettings, toast]);

  const disarmBot = useCallback(() => {
    setBotArmed(false);
    toast('info', 'Bot disarmed — no new trades will open');
  }, [toast]);

  const clearJournal = useCallback(() => setJournal([]), []);
  const clearPredictions = useCallback(() => setPredictions([]), []);
  const resetPaperBalance = useCallback(() => { setPaperBalance(10000); toast('info', 'Paper balance reset to 10,000'); }, [toast]);
  const resetRisk = useCallback(() => { setRisk({ ...DEFAULT_RISK, dayKey: currentDayKey() }); toast('info', 'Risk counters reset'); }, [toast]);

  const selectedSymbol = useMemo(() => symbols.find(s => s.symbol === settings.symbol) ?? null, [symbols, settings.symbol]);

  const value: AppContextValue = {
    settings, updateSettings, params,
    status, symbols, symbolsLoading, selectedSymbol, selectSymbol,
    m1Candles, m5Candles, lastTickAt, signal, fetchCandles,
    account, authorizing, authorize, logout,
    botArmed, armBot, disarmBot, journal, clearJournal, risk, resetRisk, paperBalance, resetPaperBalance, dayBaseline,
    predictions, clearPredictions,
    toasts, toast, dismissToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function settleJournal(
  journal: JournalEntry[],
  contractId: string,
  upd: { profit: number; exitSpot?: number },
  payoutPct: number,
): JournalEntry[] {
  return journal.map(e => {
    if (String(e.contractId) !== contractId || e.result !== undefined) return e;
    const pnl = upd.profit;
    return {
      ...e,
      exitPrice: upd.exitSpot,
      result: pnl > 0 ? 'WIN' : pnl < 0 ? (Math.abs(pnl) < 1e-9 ? 'TIE' : 'LOSS') : 'TIE',
      pnl,
      settledAt: Date.now(),
    };
  });
}

function balanceFallback(
  accountRef: React.MutableRefObject<AccountInfo | null>,
  paperBalanceRef: React.MutableRefObject<number>,
): number {
  return accountRef.current?.balance ?? paperBalanceRef.current;
}

function currencySymbolSafe(cur: string): string {
  switch (cur.toUpperCase()) {
    case 'USD': return '$'; case 'EUR': return '€'; case 'GBP': return '£';
    case 'ZMW': return 'K'; case 'ZAR': return 'R'; default: return `${cur} `;
  }
}
