// ─── Formatting + CSV helpers ───────────────────────────────────────────────

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Dynamic price precision based on magnitude. */
export function fmtPrice(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const digits = a >= 1000 ? 2 : a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 6;
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtMoney(v: number | undefined | null, currency = 'USD'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return `${sign}${currencySymbol(currency)}${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function currencySymbol(currency = 'USD'): string {
  switch (currency.toUpperCase()) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'ZAR': return 'R';
    case 'ZMW': return 'K';
    case 'AUD': return 'A$';
    case 'CAD': return 'C$';
    case 'JPY': return '¥';
    default: return `${currency} `;
  }
}

export function fmtPct(v: number | undefined | null, digits = 2, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v.toFixed(digits);
  return signed && v > 0 ? `+${s}%` : `${s}%`;
}

export function fmtNum(v: number | undefined | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function fmtTimeHM(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toUTCString().slice(17, 22);
}

export function fmtTimeFull(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toUTCString().slice(5, 25);
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Absolute difference → human bar string for the score (8 segments). */
export function scoreSegments(score: number, max = 8): boolean[] {
  return Array.from({ length: max }, (_, i) => i < score);
}
