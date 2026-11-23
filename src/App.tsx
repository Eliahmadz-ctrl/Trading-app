// ─── App shell: sidebar nav + topbar + page routing ─────────────────────────
import { useEffect, useState } from 'react';
import {
  Activity, FlaskConical, Bot, BookOpenText, ShieldAlert, Radio, DollarSign,
} from 'lucide-react';
import { AppProvider, useApp } from './state/AppContext';
import SymbolPicker from './components/SymbolPicker';
import Toasts from './components/Toasts';
import Dashboard from './pages/Dashboard';
import Backtest from './pages/Backtest';
import BotPage from './pages/Bot';
import Guide from './pages/Guide';
import { useNow } from './lib/useNow';
import { currencySymbol } from './lib/format';
import './styles/global.css';

type Page = 'signal' | 'backtest' | 'bot' | 'guide';

const NAV: { id: Page; label: string; icon: React.ReactNode; tag?: string }[] = [
  { id: 'signal', label: 'Live Signal', icon: <Radio size={17} />, tag: 'M1' },
  { id: 'backtest', label: 'Backtest Lab', icon: <FlaskConical size={17} />, tag: '60/20/20' },
  { id: 'bot', label: 'Auto-Bot', icon: <Bot size={17} />, tag: 'API' },
  { id: 'guide', label: 'Strategy Guide', icon: <BookOpenText size={17} />, tag: 'RULES' },
];

function LogoMark() {
  return (
    <svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">
      <rect x="6" y="20" width="5" height="10" rx="1.2" fill="#22d3ee" opacity="0.9" />
      <path d="M8.5 16v4M8.5 30v4" stroke="#22d3ee" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
      <rect x="14.5" y="12" width="5" height="9" rx="1.2" fill="#34d399" />
      <path d="M17 8v4M17 21v4" stroke="#34d399" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="23" y="16" width="5" height="7" rx="1.2" fill="#fb7185" opacity="0.95" />
      <path d="M25.5 13v3M25.5 23v4" stroke="#fb7185" strokeWidth="1.6" strokeLinecap="round" opacity="0.95" />
      <path d="M6 12.5 L15 8 L24 12 L35 3.5" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <path d="M30.5 3.2 L35.4 3.5 L35 8.2" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

function ConnectionChip() {
  const { status, feed } = useApp();
  const map: Record<string, { cls: string; label: string }> = {
    idle: { cls: 'chip', label: 'IDLE' },
    connecting: { cls: 'chip chip-connecting', label: 'CONNECTING' },
    connected: { cls: 'chip chip-live', label: 'LIVE FEED' },
    authorized: { cls: 'chip chip-live', label: 'LIVE + AUTH' },
    disconnected: { cls: 'chip chip-connecting', label: 'RECONNECTING' },
    error: { cls: 'chip chip-closed', label: 'ERROR' },
  };
  const m = map[status] ?? map.idle;
  return (
    <span className={m.cls} title={feed}><span className="dot" />{m.label}</span>
  );
}

function AccountChip() {
  const { account, settings, paperBalance } = useApp();
  if (account) {
    const sym = currencySymbol(account.currency);
    return (
      <span className={`chip ${account.isVirtual ? 'chip-demo' : 'chip-real'}`} title={account.loginid}>
        <DollarSign size={11} />
        {account.isVirtual ? 'DEMO' : 'REAL'} · {sym}{account.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
      </span>
    );
  }
  return (
    <span className="chip chip-paper" title="Simulated paper account (no real orders)">
      <DollarSign size={11} />
      PAPER · {currencySymbol(settings.paperCurrency)}{paperBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
    </span>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>('signal');
  const now = useNow(1000);
  const { settings, feed } = useApp();
  const utc = new Date(now).toUTCString().slice(17, 25);

  // Keyboard shortcuts: 1–4 switch pages
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '1') setPage('signal');
      else if (e.key === '2') setPage('backtest');
      else if (e.key === '3') setPage('bot');
      else if (e.key === '4') setPage('guide');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo-row">
          <div className="logo-mark"><LogoMark /></div>
          <div className="logo-text">
            <div className="t1">M1 <b>NEXT-CANDLE</b></div>
            <div className="t2">Deriv · Liquidity + EMA + RSI</div>
          </div>
        </div>

        <div className="nav-group-label">Terminal</div>
        {NAV.slice(0, 3).map(item => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
            aria-current={page === item.id ? 'page' : undefined}
          >
            {item.icon}
            {item.label}
            {item.tag && <small>{item.tag}</small>}
          </button>
        ))}

        <div className="nav-group-label">Reference</div>
        {NAV.slice(3).map(item => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}

        <div className="sidebar-foot">
          <div className="risk-note">
            <ShieldAlert size={12} style={{ verticalAlign: '-2px', marginRight: 5, color: '#c8b281' }} />
            <b>Binary options are high risk.</b> You can lose the entire stake on every contract. This tool measures probabilities — it cannot create certainty. Test on demo first.
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <SymbolPicker />
          <div className="topbar-right">
            <ConnectionChip />
            <AccountChip />
            <div className="utc-clock"><span>UTC</span> {utc}</div>
          </div>
        </header>

        <main className="content">
          {page === 'signal' && <Dashboard />}
          {page === 'backtest' && <Backtest />}
          {page === 'bot' && <BotPage />}
          {page === 'guide' && <Guide />}
          <div className="status-foot" style={{ marginTop: 16 }}>
            <span>FEED <b>{feed}</b>{settings.appId ? <> · app_id <b>{settings.appId}</b></> : null}</span>
            <span>PREDICTIONS ARE PROBABILITIES, NOT PROMISES</span>
            <span>NOT FINANCIAL ADVICE</span>
          </div>
        </main>

        <div className="disclaimer-strip">
          <b>Risk warning.</b> Trading binary options on Deriv involves substantial risk of loss and is not suitable for everyone. Past performance — including any backtest in this terminal — does not guarantee future results. Never stake money you cannot afford to lose. Synthetic indices are algorithmically generated and may not follow conventional technical analysis. This software is provided for education and research; it is not financial advice.
        </div>
      </div>

      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
