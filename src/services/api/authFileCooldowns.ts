import type { AuthFileCooldown, AuthFileCooldownSnapshot } from '@/types/authFile';
import { parseTimestampMs } from '@/utils/timestamp';

export function normalizeCooldownTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = parseTimestampMs(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function normalizeRecord(value: unknown): AuthFileCooldown | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const scope = entry.scope;
  if (scope !== 'model' && scope !== 'credential') return null;
  const modelKey = typeof entry.model_key === 'string' ? entry.model_key.trim() : '';
  if (scope === 'model' && !modelKey) return null;
  const retryAt = normalizeCooldownTimestamp(entry.retry_at);
  const remainingSeconds = entry.remaining_seconds;
  const shared = entry.origin === 'shared_pool';
  const phase = entry.phase;
  const validPhase = phase === 'cooling' || phase === 'probe_pending' || phase === 'probing';
  const waiting = shared && (phase === 'probe_pending' || phase === 'probing');
  if (
    !retryAt ||
    typeof remainingSeconds !== 'number' ||
    !Number.isSafeInteger(remainingSeconds) ||
    (waiting ? remainingSeconds !== 0 : remainingSeconds <= 0) ||
    remainingSeconds > Number.MAX_SAFE_INTEGER / 1000
  ) {
    return null;
  }
  const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
  const backoffLevel = entry.backoff_level;
  const httpStatus = entry.http_status;
  const poolId =
    typeof entry.pool_id === 'string' && /^[a-f0-9]{64}$/.test(entry.pool_id)
      ? entry.pool_id
      : undefined;
  const poolVersion =
    typeof entry.pool_version === 'number' &&
    Number.isSafeInteger(entry.pool_version) &&
    entry.pool_version > 0
      ? entry.pool_version
      : undefined;
  if (
    shared &&
    (scope !== 'credential' ||
      !validPhase ||
      !poolId ||
      !poolVersion ||
      (entry.feature !== 'assistant_search' && entry.feature !== 'technical_requests') ||
      (entry.restriction_kind !== undefined &&
        entry.restriction_kind !== 'daily' &&
        entry.restriction_kind !== 'minute') ||
      (entry.restriction_scope !== undefined &&
        !['edition', 'project', 'user', 'credential'].includes(String(entry.restriction_scope))))
  ) {
    return null;
  }
  return {
    ...(shared
      ? {
          origin: 'shared_pool' as const,
          phase: phase as AuthFileCooldown['phase'],
          poolId,
          poolVersion,
          feature: typeof entry.feature === 'string' ? entry.feature : undefined,
          relatedAuthCount:
            typeof entry.related_auth_count === 'number' &&
            Number.isSafeInteger(entry.related_auth_count) &&
            entry.related_auth_count > 0
              ? entry.related_auth_count
              : undefined,
          restrictionKind:
            typeof entry.restriction_kind === 'string' ? entry.restriction_kind : undefined,
          restrictionScope:
            typeof entry.restriction_scope === 'string' ? entry.restriction_scope : undefined,
          timeSource: typeof entry.time_source === 'string' ? entry.time_source : undefined,
          sharedResetSupported: entry.shared_reset_supported === true,
        }
      : {}),
    scope,
    ...(scope === 'model' ? { modelKey } : {}),
    reason: reason || 'unknown',
    retryAt,
    remainingSeconds,
    ...(typeof backoffLevel === 'number' && Number.isSafeInteger(backoffLevel) && backoffLevel >= 0
      ? { backoffLevel }
      : {}),
    ...(typeof httpStatus === 'number' &&
    Number.isInteger(httpStatus) &&
    httpStatus >= 400 &&
    httpStatus <= 599
      ? { httpStatus }
      : {}),
  };
}

export function normalizeAuthFileCooldowns(
  value: unknown,
  observedAt: string | undefined,
  receivedAtMs: number
): AuthFileCooldownSnapshot | undefined {
  if (value === undefined) return undefined;
  const snapshot = { observedAt, receivedAtMs };
  if (!Array.isArray(value)) return { ...snapshot, records: null };
  const records = value.map(normalizeRecord);
  // A malformed/future scope must not silently turn a restriction into "no timers".
  if (records.some((record) => record === null)) return { ...snapshot, records: null };
  return { ...snapshot, records: records as AuthFileCooldown[] };
}
