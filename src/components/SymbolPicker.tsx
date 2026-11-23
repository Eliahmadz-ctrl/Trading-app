// ─── Searchable instrument picker grouped by market ─────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check, Loader2 } from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { ActiveSymbol } from '../lib/types';

const MARKET_LABEL: Record<string, string> = {
  synthetic_index: 'Synthetic Indices',
  forex: 'Forex',
  stock_indices: 'Stock Indices',
  cryptocurrency: 'Cryptocurrency',
  commodities: 'Commodities',
};

export default function SymbolPicker() {
  const { symbols, symbolsLoading, settings, selectSymbol } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const selected = symbols.find(s => s.symbol === settings.symbol);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = symbols.filter(
      s => !q || s.display_name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q),
    );
    const map = new Map<string, ActiveSymbol[]>();
    for (const s of filtered) {
      const key = MARKET_LABEL[s.market] ?? (s.market || 'Other').replace(/_/g, ' ');
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [symbols, query]);

  return (
    <div className="symbol-picker" ref={rootRef}>
      <button className="symbol-trigger" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span
          className="sp-open"
          style={{ width: 10, height: 10 }}
          data-state={Number(selected?.exchange_is_open ?? 1) === 1 ? 'open' : 'closed'}
          title={Number(selected?.exchange_is_open ?? 1) === 1 ? 'Market open' : 'Market closed'}
        />
        <span style={{ minWidth: 0 }}>
          <span className="st-name">{selected?.display_name ?? settings.symbol}</span>
          <span className="st-code" style={{ display: 'block' }}>{settings.symbol} · M1</span>
        </span>
        <ChevronDown size={16} style={{ marginLeft: 'auto', color: 'var(--muted)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
      </button>

      {open && (
        <div className="sp-panel" role="listbox">
          <div className="sp-search">
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--muted)' }} />
              <input
                ref={inputRef}
                className="input"
                style={{ paddingLeft: 33, fontFamily: 'var(--sans)', fontWeight: 500 }}
                placeholder="Search instruments — e.g. Volatility 100, EUR/USD, Step…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {symbolsLoading && <Loader2 size={14} className="icon-spin" style={{ position: 'absolute', right: 12, top: 12, color: 'var(--cyan)' }} />}
            </div>
          </div>
          <div className="sp-list">
            {groups.length === 0 && <div style={{ padding: '18px 12px', color: 'var(--muted)', fontSize: 12 }}>No instruments match “{query}”.</div>}
            {groups.map(([group, items]) => (
              <div key={group}>
                <div className="sp-group">{group} · {items.length}</div>
                {items.map(s => {
                  const openNow = Number(s.exchange_is_open) === 1 && Number(s.is_trading_suspended) === 0;
                  return (
                    <button
                      key={s.symbol}
                      className={`sp-item ${s.symbol === settings.symbol ? 'selected' : ''}`}
                      onClick={() => { selectSymbol(s.symbol); setOpen(false); }}
                      role="option"
                      aria-selected={s.symbol === settings.symbol}
                    >
                      <span className={`sp-open ${openNow ? 'open' : 'closed'}`} />
                      <span style={{ minWidth: 0 }}>
                        <span className="sp-name">{s.display_name}</span>
                        <span className="sp-sym" style={{ display: 'block' }}>{s.symbol}</span>
                      </span>
                      {s.symbol === settings.symbol && <Check size={15} style={{ marginLeft: 'auto', color: 'var(--cyan)' }} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
