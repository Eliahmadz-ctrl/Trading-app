// ─── Deriv API client (browser-side) ─────────────────────────────────────────
// Deriv retired the legacy public feed for many networks (HTTP 520 behind its
// CDN) and moved everything to the Options API on api.derivws.com:
//   • Market data (unauthenticated): wss://api.derivws.com/trading/v1/options/ws/public
//   • Authenticated trading:   POST https://api.derivws.com/trading/v1/options/accounts/{id}/otp
//     → returns wss://api.derivws.com/trading/v1/options/ws/{demo|real}?otp=…
// The Options API uses `underlying_symbol` in proposals (not `symbol`) and
// returns monetary amounts as JSON strings — both handled here. Legacy v3
// sockets are kept purely as market-data fallback.
// Docs: https://developers.deriv.com/docs/workflows/

import type { AccountInfo, ActiveSymbol, Candle, DerivWsStatus } from './types';

const DEFAULT_APP_ID = '1089'; // Deriv's public playground id — used ONLY for legacy market-data fallback
const OPTIONS_PUBLIC_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const OPTIONS_REST = 'https://api.derivws.com/trading/v1/options';

/** Deriv returns monetary fields as JSON strings ("10005.83") — accept both. */
function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeCandle(raw: any): Candle {
  // Deriv candle rows (ticks_history snapshot) put the bucket-start in `epoch`.
  // Live `ohlc` pushes put the *tick* time in `epoch` and the bucket start in
  // `open_time` — using `epoch` there appended a fake candle per tick (the
  // "chart is ticks, not 1-minute candles" bug). Prefer `open_time` when present.
  return {
    time: toNum(raw.open_time ?? raw.epoch ?? raw.time),
    open: toNum(raw.open),
    high: toNum(raw.high),
    low: toNum(raw.low),
    close: toNum(raw.close),
  };
}

export class DerivError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DerivError';
    this.code = code;
  }
}

export interface CandleSubscriptionHandlers {
  onSnapshot: (candles: Candle[]) => void;
  onUpdate: (candle: Candle, raw: any) => void;
  onError?: (message: string) => void;
}

type StatusListener = (s: DerivWsStatus) => void;
type EndpointListener = (label: string) => void;

export class DerivClient {
  private appId: string;
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }>();
  private statusListeners = new Set<StatusListener>();
  private endpointListeners = new Set<EndpointListener>();
  private ohlcListeners = new Set<(raw: any) => void>();
  private balanceListeners = new Set<(b: any) => void>();
  private contractListeners = new Set<(c: any) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private intentionalClose = false;
  private attempts = 0;
  private failStreak = 0;
  private endpointIndex = 0;
  /** Set once the socket is an authenticated Options API socket (OTP URL). */
  private optionsApi = false;
  /** Authenticated OTP sockets are single-use — keep the token in memory to mint fresh URLs on reconnect. */
  private patToken: string | null = null;
  private preferAccount: 'demo' | 'real' = 'demo';
  /** Non-null once we've switched to an authenticated OTP URL. */
  private customUrl: string | null = null;
  private endpointLabel = 'Deriv Options API (public)';
  status: DerivWsStatus = 'idle';

  constructor(appId: string = '') {
    this.appId = appId && appId.trim() ? appId.trim() : DEFAULT_APP_ID;
  }

  private endpointCandidates(): Array<{ url: string; label: string }> {
    const appId = encodeURIComponent(this.appId || DEFAULT_APP_ID);
    return [
      { url: OPTIONS_PUBLIC_URL, label: 'Deriv Options API (public)' },
      { url: `wss://ws.derivws.com/websockets/v3?app_id=${appId}`, label: 'Deriv legacy feed (ws.derivws.com)' },
      { url: `wss://ws.binaryws.com/websockets/v3?app_id=${appId}`, label: 'Deriv legacy feed (ws.binaryws.com)' },
      { url: `wss://wss.derivws.com/websockets/v3?app_id=${appId}`, label: 'Deriv legacy feed (wss.derivws.com)' },
    ];
  }

  private currentTarget(): { url: string; label: string } {
    if (this.customUrl) return { url: this.customUrl, label: this.endpointLabel };
    return this.endpointCandidates()[Math.min(this.endpointIndex, this.endpointCandidates().length - 1)];
  }

  get feedLabel() {
    return this.currentTarget().label;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  connect() {
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.intentionalClose = false;
    this.openSocket().catch(() => { /* onclose schedules reconnect; errors surface via status/listeners */ });
  }

  /** Open a socket; resolves on open, rejects on close/error before open. */
  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.setStatus('connecting');
      const target = this.currentTarget();
      let ws: WebSocket;
      try {
        ws = new WebSocket(target.url);
      } catch (e: any) {
        this.setStatus('error');
        reject(e ?? new DerivError('Failed to construct WebSocket'));
        return;
      }
      this.ws = ws;
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new DerivError('Deriv WebSocket timed out'));
      }, 15000);

      ws.onopen = () => {
        if (ws !== this.ws) return;
        settled = true;
        window.clearTimeout(timer);
        this.attempts = 0;
        this.failStreak = 0;
        this.reconnectDelay = 1000;
        this.endpointLabel = target.label;
        this.setStatus('connected');
        this.notifyEndpoint();
        this.startPing();
        resolve();
      };
      ws.onmessage = ev => this.handleMessage(ev.data as string);
      ws.onerror = () => {
        if (ws !== this.ws) return;
        this.setStatus('error');
      };
      ws.onclose = () => {
        if (ws !== this.ws) return; // stale socket replaced by switchSocket
        this.stopPing();
        this.flushPending(new DerivError('Connection closed'));
        this.setStatus('disconnected');
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new DerivError('Deriv WebSocket closed before it opened'));
        }
        if (this.intentionalClose) return;
        this.failStreak += 1;
        // After 2 consecutive failures on an unauthenticated feed, move to the next candidate.
        if (!this.customUrl && this.failStreak >= 2) {
          const max = this.endpointCandidates().length - 1;
          if (this.endpointIndex < max) {
            this.endpointIndex += 1;
            this.failStreak = 0;
          }
        }
        this.scheduleReconnect();
      };
    });
  }

  /** Swap the current socket for an authenticated OTP URL (single shared socket for feed + trading). */
  private async switchSocket(url: string, label: string): Promise<void> {
    if (this.reconnectTimer) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopPing();
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch { /* ignore */ }
    }
    this.flushPending(new DerivError('Re-connecting to authenticated Options socket…'));
    this.customUrl = url;
    this.optionsApi = true;
    this.endpointLabel = label;
    this.intentionalClose = false;
    this.failStreak = 0;
    this.reconnectDelay = 1000;
    await this.openSocket();
  }

  disconnect() {
    this.intentionalClose = true;
    this.patToken = null;
    this.customUrl = null;
    this.optionsApi = false;
    this.endpointIndex = 0;
    this.failStreak = 0;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.flushPending(new DerivError('Disconnected'));
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch { /* ignore */ }
    }
    this.setStatus('idle');
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.attempts += 1;
    if (this.attempts > 8) {
      this.setStatus('error');
      this.errorListeners.forEach(l => l('Deriv: gave up reconnecting — check your network connection and credentials, then reload.'));
      return;
    }
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 15000);
    this.reconnectTimer = window.setTimeout(() => {
      if (this.patToken && this.customUrl) {
        // OTP URLs are single-use — mint a fresh one before reconnecting.
        this.fetchOtpUrl(this.patToken, this.preferAccount)
          .then(({ url }) => {
            this.customUrl = url;
            return this.openSocket();
          })
          .catch(() => {
            this.failStreak += 1;
            this.scheduleReconnect();
          });
      } else {
        this.openSocket().catch(() => { /* onclose re-schedules */ });
      }
    }, delay);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.request({ ping: 1 }, 8000).catch(() => {});
    }, 30000);
  }
  private stopPing() {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(s: DerivWsStatus) {
    this.status = s;
    this.statusListeners.forEach(l => l(s));
  }
  private notifyEndpoint() {
    const label = this.feedLabel;
    this.endpointListeners.forEach(l => l(label));
  }
  onStatus(l: StatusListener) {
    this.statusListeners.add(l);
    l(this.status);
    return () => this.statusListeners.delete(l);
  }
  onEndpoint(l: EndpointListener) {
    this.endpointListeners.add(l);
    l(this.feedLabel);
    return () => this.endpointListeners.delete(l);
  }
  onError(l: (m: string) => void) {
    this.errorListeners.add(l);
    return () => {
      this.errorListeners.delete(l);
    };
  }

  private flushPending(err: Error) {
    this.pending.forEach(p => {
      window.clearTimeout(p.timer);
      p.reject(err);
    });
    this.pending.clear();
  }

  // ── messaging ──────────────────────────────────────────────────────────────
  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // Correlated request/response
    if (msg.req_id != null && this.pending.has(msg.req_id)) {
      const p = this.pending.get(msg.req_id)!;
      window.clearTimeout(p.timer);
      this.pending.delete(msg.req_id);
      if (msg.error) p.reject(new DerivError(msg.error.message ?? 'Deriv API error', msg.error.code));
      else p.resolve(msg);
      return;
    }
    // Subscriptions / pushes
    switch (msg.msg_type) {
      case 'ohlc':
        this.ohlcListeners.forEach(l => l(msg.ohlc));
        break;
      case 'balance':
        this.balanceListeners.forEach(l => l(msg.balance));
        break;
      case 'proposal_open_contract':
        this.contractListeners.forEach(l => l(msg.proposal_open_contract));
        break;
      case 'error':
        this.errorListeners.forEach(l => l(msg.error?.message ?? 'Deriv API error'));
        break;
      case 'candles':
      case 'active_symbols':
      case 'authorize':
      case 'proposal':
      case 'buy':
        // handled via pending promise (they always carry req_id)
        break;
      default:
        break;
    }
  }

  request(payload: Record<string, unknown>, timeoutMs = 20000): Promise<any> {
    const id = ++this.reqId;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new DerivError('Not connected to Deriv'));
        return;
      }
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new DerivError('Request timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }

  // ── market data ────────────────────────────────────────────────────────────
  async getActiveSymbols(): Promise<ActiveSymbol[]> {
    const msg = await this.request({ active_symbols: 'brief' });
    const list = (msg.active_symbols ?? []) as any[];
    return list.map(s => {
      const symbol = String(s.underlying_symbol ?? s.symbol ?? '');
      return {
        symbol,
        display_name: String(s.underlying_symbol_name ?? s.display_name ?? symbol),
        market: String(s.market ?? ''),
        submarket: String(s.submarket ?? ''),
        exchange_is_open: toNum(s.exchange_is_open, 1),
        is_trading_suspended: toNum(s.is_trading_suspended, 0),
        pip: s.pip != null ? toNum(s.pip) : toNum(s.pip_size, NaN) || undefined,
      };
    }).filter(s => s.symbol);
  }

  async getCandles(symbol: string, granularity: 60 | 300, count: number): Promise<Candle[]> {
    const msg = await this.request({
      ticks_history: symbol,
      end: 'latest',
      count,
      granularity,
      style: 'candles',
    });
    const raw = (msg.candles ?? []) as any[];
    return raw.map(normalizeCandle).sort((a, b) => a.time - b.time);
  }

  /** Subscribe to candle updates. Resolves to an unsubscribe function. */
  async subscribeCandles(
    symbol: string,
    granularity: 60 | 300,
    count: number,
    handlers: CandleSubscriptionHandlers,
  ): Promise<() => Promise<void>> {
    const msg = await this.request({
      ticks_history: symbol,
      end: 'latest',
      count,
      granularity,
      style: 'candles',
      subscribe: 1,
    });
    const subId: string | undefined = msg.subscription?.id;
    if (msg.candles) handlers.onSnapshot((msg.candles as any[]).map(normalizeCandle).sort((a, b) => a.time - b.time));

    const listener = (raw: any) => {
      if (!raw) return;
      if (raw.granularity != null && toNum(raw.granularity) !== granularity) return;
      if (raw.symbol && String(raw.symbol) !== symbol && String(raw.underlying_symbol ?? '') !== symbol) return;
      handlers.onUpdate(normalizeCandle(raw), raw);
    };
    this.ohlcListeners.add(listener);

    return async () => {
      this.ohlcListeners.delete(listener);
      if (subId) {
        await this.request({ forget: subId }).catch(() => {});
      }
    };
  }

  // ── account / trading (Options API) ────────────────────────────────────────
  /**
   * Authorize against Deriv's current Options API.
   * Requires a PAT token (pat_…) from developers.deriv.com and a NEW PAT-type
   * App ID — legacy tokens and the legacy `authorize` WS call are rejected.
   */
  async authorize(token: string, prefer: 'demo' | 'real' = 'demo'): Promise<AccountInfo> {
    const t = token.trim();
    if (!t.toLowerCase().startsWith('pat_')) {
      throw new DerivError(
        'Deriv\u2019s current API requires a PAT token (pat_…) from developers.deriv.com — legacy a1-… tokens no longer work. Create a PAT-type app, generate a token with read + trade scopes, and enter your new App ID.',
        'TOKEN_TYPE',
      );
    }
    if (!this.appId || this.appId === DEFAULT_APP_ID) {
      throw new DerivError(
        'Enter your own Deriv App ID (PAT-type app from developers.deriv.com). The public playground ID 1089 is rejected by the new API.',
        'APP_ID',
      );
    }
    const { url, account } = await this.fetchOtpUrl(t, prefer);
    this.patToken = t;
    this.preferAccount = prefer;
    await this.switchSocket(url, 'Deriv Options API (authenticated)');
    const accountType = String(account?.account_type ?? (prefer === 'demo' ? 'demo' : 'real')).toLowerCase();
    const info: AccountInfo = {
      loginid: String(account.account_id ?? ''),
      balance: toNum(account?.balance),
      currency: String(account?.currency ?? 'USD'),
      isVirtual: accountType === 'demo',
      email: undefined,
    };
    this.setStatus('authorized');
    return info;
  }

  /** REST: list accounts → pick demo/real → mint a single-use authenticated WS URL. */
  private async fetchOtpUrl(token: string, prefer: 'demo' | 'real'): Promise<{ url: string; account: any }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Deriv-App-ID': this.appId,
    };
    let accRes: Response;
    try {
      accRes = await fetch(`${OPTIONS_REST}/accounts`, { headers });
    } catch (e: any) {
      throw new DerivError(`Could not reach Deriv REST API (${e?.message ?? 'network error'}). Check your connection/CORS and try again.`, 'REST_NETWORK');
    }
    if (accRes.status === 401 || accRes.status === 403) {
      throw new DerivError(
        `Deriv rejected the token (HTTP ${accRes.status}). Check: the token is a PAT from developers.deriv.com, it has read + trade scopes, and your App ID is a PAT-type app — legacy App IDs are not accepted.`,
        'AUTH',
      );
    }
    if (!accRes.ok) {
      throw new DerivError(`Deriv accounts lookup failed (HTTP ${accRes.status})`, 'REST');
    }
    const json = await accRes.json().catch(() => null);
    const data = json?.data ?? json;
    const list: any[] = Array.isArray(data) ? data : data ? [data] : [];
    if (!list.length) throw new DerivError('No Options accounts found for this token. Create/enable an Options account on deriv.com first.', 'NO_ACCOUNT');
    const isActive = (a: any) => String(a?.status ?? 'active').toLowerCase() === 'active';
    const active = list.filter(isActive);
    const pool = active.length ? active : list;
    const typeMatch = (a: any) => String(a?.account_type ?? '').toLowerCase() === prefer;
    const account = pool.find(typeMatch) ?? pool[0];
    const accountId = account?.account_id;
    if (!accountId) throw new DerivError('Deriv accounts response did not include an account_id.', 'NO_ACCOUNT');

    let otpRes: Response;
    try {
      otpRes = await fetch(`${OPTIONS_REST}/accounts/${encodeURIComponent(String(accountId))}/otp`, {
        method: 'POST',
        headers,
      });
    } catch (e: any) {
      throw new DerivError(`Could not reach Deriv OTP endpoint (${e?.message ?? 'network error'}).`, 'REST_NETWORK');
    }
    if (!otpRes.ok) {
      throw new DerivError(`Deriv OTP request failed (HTTP ${otpRes.status}). The token may lack the trade scope.`, 'OTP');
    }
    const otpJson = await otpRes.json().catch(() => null);
    const url = otpJson?.data?.url;
    if (!url || typeof url !== 'string') {
      throw new DerivError('Deriv OTP response did not include data.url — cannot open an authenticated socket.', 'OTP');
    }
    return { url, account };
  }

  async subscribeBalance(onBalance: (b: { balance: number; currency: string; loginid?: string }) => void): Promise<() => Promise<void>> {
    const listener = (b: any) =>
      onBalance({ balance: toNum(b?.balance), currency: String(b?.currency ?? 'USD'), loginid: b?.loginid });
    this.balanceListeners.add(listener);
    const msg = await this.request({ balance: 1, subscribe: 1 });
    const subId: string | undefined = msg.subscription?.id;
    return async () => {
      this.balanceListeners.delete(listener);
      if (subId) await this.request({ forget: subId }).catch(() => {});
    };
  }

  /** Place a 1-minute RISE (CALL) or FALL (PUT) contract. Returns contract id + prices. */
  async placeRiseFall(args: {
    symbol: string;
    direction: 'RISE' | 'FALL';
    stake: number;
    currency: string;
  }): Promise<{ contractId: string | number; buyPrice: number; payout: number }> {
    const contractType = args.direction === 'RISE' ? 'CALL' : 'PUT';
    // Options API uses `underlying_symbol`; legacy v3 used `symbol`.
    const symbolField = this.optionsApi ? { underlying_symbol: args.symbol } : { symbol: args.symbol };
    const proposalMsg = await this.request({
      proposal: 1,
      amount: args.stake,
      basis: 'stake',
      contract_type: contractType,
      currency: args.currency,
      duration: 1,
      duration_unit: 'm',
      ...symbolField,
    });
    const proposal = proposalMsg.proposal;
    if (!proposal?.id) throw new DerivError('No proposal returned (market may be closed or stake invalid)');
    const askPrice = toNum(proposal.ask_price ?? proposal.price);
    const buyMsg = await this.request({ buy: proposal.id, price: askPrice });
    const buy = buyMsg.buy ?? {};
    return {
      contractId: buy.contract_id,
      buyPrice: toNum(buy.buy_price ?? askPrice),
      payout: toNum(buy.payout ?? proposal.payout),
    };
  }

  /** Subscribe to a contract until it is sold/expired. Resolves when settled and forgets the subscription. */
  async trackContract(
    contractId: string | number,
    onUpdate: (c: { isSold: boolean; profit: number; status: string; exitSpot?: number; entrySpot?: number }) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let subId: string | undefined;
      const listener = (c: any) => {
        if (String(c?.contract_id) !== String(contractId)) return;
        const isSold = Number(c?.is_sold) === 1 || Number(c?.is_expired) === 1 || String(c?.is_sold) === '1';
        onUpdate({
          isSold,
          profit: toNum(c?.profit),
          status: String(c?.status ?? 'open'),
          exitSpot: c?.exit_spot != null ? toNum(c.exit_spot) : undefined,
          entrySpot: c?.entry_spot != null ? toNum(c.entry_spot) : undefined,
        });
        if (isSold) {
          this.contractListeners.delete(listener);
          if (subId) this.request({ forget: subId }).catch(() => {});
          resolve();
        }
      };
      this.contractListeners.add(listener);
      this.request({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })
        .then(msg => {
          subId = msg.subscription?.id;
        })
        .catch(err => {
          this.contractListeners.delete(listener);
          reject(err);
        });
    });
  }
}

export const deriv = new DerivClient();
