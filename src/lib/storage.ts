// ─── localStorage persistence (JSON, crash-safe) ────────────────────────────

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or privacy mode — ignore */
  }
}

export function removeKey(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const STORAGE_KEYS = {
  settings: 'm1nc.settings.v1',
  journal: 'm1nc.journal.v1',
  predictions: 'm1nc.predictions.v1',
  paperBalance: 'm1nc.paperBalance.v1',
  risk: 'm1nc.risk.v1',
} as const;
