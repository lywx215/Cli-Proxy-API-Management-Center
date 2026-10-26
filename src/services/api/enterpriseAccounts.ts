import type { GeminiEnterpriseAccount, GeminiEnterpriseCollection } from '@/types/authFile';
import { isRecord } from '@/utils/helpers';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
} from '@/utils/recentRequests';
import { normalizeAuthFileCooldowns } from './authFileCooldowns';

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;
export const enterpriseRevision = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const resources = (value: Record<string, unknown>) => ({
  projectId: text(value.project_id),
  location: text(value.location),
  collectionId: text(value.collection_id),
  engineId: text(value.engine_id),
  assistantId: text(value.assistant_id),
  endpoint: text(value.endpoint),
});

// Only the backend's editable settings enter child editors; never inherit OAuth material.
const SETTING_KEYS = [
  'prefix',
  'proxy_url',
  'headers',
  'priority',
  'weight',
  'note',
  'request_retry',
  'model_aliases',
  'request_scoped_errors',
  'excluded_models',
  'excluded-models',
  'disable_cooling',
  'disable-cooling',
] as const;
export function enterpriseSettings(value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    SETTING_KEYS.filter((key) => key in source).map((key) => [key, source[key]])
  );
}

export function normalizeEnterpriseAccount(
  value: unknown,
  observedAt?: string,
  receivedAtMs = Date.now()
): GeminiEnterpriseAccount | undefined {
  if (!isRecord(value)) return undefined;
  const collections: GeminiEnterpriseCollection[] | undefined = Array.isArray(value.collections)
    ? value.collections
        .filter(isRecord)
        .filter((entry) => text(entry.binding_id))
        .map((entry) => ({
          ...resources(entry),
          bindingId: text(entry.binding_id)!,
          revision: enterpriseRevision(entry.revision),
          authIndex: normalizeRecentRequestAuthIndex(entry.auth_index) ?? undefined,
          projectName: text(entry.project_name),
          disabled: entry.disabled === true,
          effectiveDisabled: entry.effective_disabled === true || entry.disabled === true,
          missing: bool(entry.missing),
          unavailable: bool(entry.unavailable),
          status: text(entry.status),
          statusMessage: text(entry.status_message),
          successCount: normalizeUsageTotal(entry.success),
          failureCount: normalizeUsageTotal(entry.failed),
          recentRequests: normalizeRecentRequestBuckets(entry.recent_requests),
          cooldownSnapshot: normalizeAuthFileCooldowns(entry.cooldowns, observedAt, receivedAtMs),
          settings: enterpriseSettings(isRecord(entry.settings) ? entry.settings : entry),
        }))
    : undefined;
  const discovery = isRecord(value.discovery) ? value.discovery : undefined;
  return {
    ...resources(value),
    clientId: text(value.client_id),
    expiry: text(value.expiry),
    hasRefreshToken: bool(value.has_refresh_token),
    resourceEditSupported: bool(value.resource_edit_supported),
    accountId: text(value.account_id),
    revision: enterpriseRevision(value.revision),
    accountManagementSupported: bool(value.account_management_supported),
    ...(collections ? { collections } : {}),
    ...(discovery
      ? {
          discovery: {
            status: text(discovery.status),
            checkedAt: text(discovery.checked_at),
            warnings: (Array.isArray(discovery.warnings) ? discovery.warnings : [])
              .filter(isRecord)
              .map((warning) => ({
                project: text(warning.project),
                location: text(warning.location),
                code: text(warning.code),
                message: text(warning.message),
              })),
          },
        }
      : {}),
  };
}
