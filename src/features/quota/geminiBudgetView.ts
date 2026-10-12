import type { GeminiBudgetSnapshot } from '@/services/api/geminiBudget';

const KNOWN_STATES = new Set([
  'disabled',
  'ready',
  'uninitialized',
  'disaster',
  'locked',
  'storage_error',
  'available',
  'cooldown',
  'exhausted',
  'quarantined',
  'model_restricted',
  'inflight',
  'unknown',
  'idle',
  'pending',
  'success',
  'failed',
  'frozen',
  'attempted',
  'circuit_open',
  'not_routable',
]);

const STATE_ALIASES: Record<string, string> = {
  daily_exhausted: 'exhausted',
  busy: 'inflight',
  never: 'idle',
};

export const geminiBudgetStateKey = (state: string): string => {
  const normalized = STATE_ALIASES[state] ?? state;
  return `gemini_budget.state_${KNOWN_STATES.has(normalized) ? normalized : 'unknown'}`;
};

export const canInitializeGeminiBudget = (snapshot: GeminiBudgetSnapshot | null): boolean =>
  Boolean(
    snapshot?.canInitialize &&
    !snapshot.enabled &&
    !snapshot.initialized &&
    ['disabled', 'uninitialized'].includes(snapshot.engineState)
  );

/** Use the server's timestamps; never invent a recovery instant from a local clock. */
export const formatGeminiBudgetTime = (value: string | null, language: string): string | null => {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toLocaleString(language, { hour12: false });
};
