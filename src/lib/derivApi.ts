// ─── Deriv WebSocket API client (browser-side) ──────────────────────────────
// Public endpoint: wss://ws.derivws.com/websockets/v3?app_id=<id>
// Docs: https://developers.deriv.com/  (API v3)

import type { AccountInfo, ActiveSymbol, Candle, DerivWsStatus } from './types';

const DEFAULT_APP_ID = '1089'; // public playground app_id — register your own at developers.deriv.com

export function normalizeCandle(raw: any): Candle {
  return {
    time: Number(raw.epoch ?? raw.time),
    open: Number(raw.open),
    high: Number(raw.high),
    low: Number(raw.low),
    close: Number(raw.close),
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

export class DerivClient {
  private appId: string;
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }>();
  private statusListeners = new Set<StatusListener>();
  private ohlcListeners = new Set<(raw: any) => void>();
  private balanceListeners = new Set<(b: any) => void>();
  private contractListeners = new Set<(c: any) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private intentionalClose = false;
  private attempts = 0;
  status: DerivWsStatus = 'idle';

  constructor(appId: string = DEFAULT_APP_ID) {
    this.appId = appId || DEFAULT_APP_ID;
  }

  get url() {
    return `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(this.appId)}`;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  connect() {
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.intentionalClose = false;
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch (e: any) {
      this.setStatus('error');
      return;
    }
    this.ws.onopen = () => {
      this.attempts = 0;
      this.reconnectDelay = 1000;
      this.setStatus('connected');
      this.startPing();
    };
    this.ws.onmessage = ev => this.handleMessage(ev.data as string);
    this.ws.onclose = () => {
      this.stopPing();
      this.flushPending(new DerivError('Connection closed'));
      this.setStatus('disconnected');
      if (!this.intentionalClose) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.setStatus('error');
    };
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.flushPending(new DerivError('Disconnected'));
    this.ws?.close();
    this.ws = null;
    this.setStatus('idle');
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 15000);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
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
  onStatus(l: StatusListener) {
    this.statusListeners.add(l);
    l(this.status);
    return () => this.statusListeners.delete(l);
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
    const msg = await this.request({ active_symbols: 'brief', product_type: 'basic' });
    const list = (msg.active_symbols ?? []) as any[];
    return list.map(s => ({
      symbol: String(s.symbol),
      display_name: String(s.display_name ?? s.symbol),
      market: String(s.market ?? ''),
      submarket: String(s.submarket ?? ''),
      exchange_is_open: s.exchange_is_open ?? 1,
      is_trading_suspended: s.is_trading_suspended ?? 0,
      pip: s.pip != null ? Number(s.pip) : undefined,
    }));
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
      if (raw.granularity != null && Number(raw.granularity) !== granularity) return;
      if (raw.symbol && String(raw.symbol) !== symbol) return;
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

  // ── account / trading ─────────────────────────────────────────────────────
  async authorize(token: string): Promise<AccountInfo> {
    const msg = await this.request({ authorize: token });
    const a = msg.authorize ?? {};
    const info: AccountInfo = {
      loginid: String(a.loginid ?? ''),
      balance: Number(a.balance ?? 0),
      currency: String(a.currency ?? 'USD'),
      isVirtual: Number(a.is_virtual) === 1,
      email: a.email ? String(a.email) : undefined,
    };
    this.setStatus('authorized');
    return info;
  }

  async subscribeBalance(onBalance: (b: { balance: number; currency: string; loginid?: string }) => void): Promise<() => Promise<void>> {
    const listener = (b: any) =>
      onBalance({ balance: Number(b.balance ?? 0), currency: String(b.currency ?? 'USD'), loginid: b.loginid });
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
    const proposalMsg = await this.request({
      proposal: 1,
      amount: args.stake,
      basis: 'stake',
      contract_type: contractType,
      currency: args.currency,
      duration: 1,
      duration_unit: 'm',
      symbol: args.symbol,
    });
    const proposal = proposalMsg.proposal;
    if (!proposal?.id) throw new DerivError('No proposal returned (market may be closed or stake invalid)');
    const askPrice = Number(proposal.ask_price ?? proposal.price);
    const buyMsg = await this.request({ buy: proposal.id, price: askPrice });
    const buy = buyMsg.buy ?? {};
    return {
      contractId: buy.contract_id,
      buyPrice: Number(buy.buy_price ?? askPrice),
      payout: Number(buy.payout ?? proposal.payout ?? 0),
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
        const isSold = Number(c?.is_sold) === 1 || Number(c?.is_expired) === 1;
        onUpdate({
          isSold,
          profit: Number(c?.profit ?? 0),
          status: String(c?.status ?? 'open'),
          exitSpot: c?.exit_spot != null ? Number(c.exit_spot) : undefined,
          entrySpot: c?.entry_spot != null ? Number(c.entry_spot) : undefined,
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

export const deriv = new DerivClient(DEFAULT_APP_ID);
