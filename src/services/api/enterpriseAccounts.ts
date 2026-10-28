import type {
  GeminiEnterpriseAccount,
  GeminiEnterpriseCollection,
  EnterpriseModelPolicyState,
} from '@/types/authFile';
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
  'catalog_fallback',
  'model_policy',
  'allowed_models',
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

export function normalizeEnterpriseModelPolicy(
  value: unknown
): EnterpriseModelPolicyState | undefined {
  if (!isRecord(value)) return undefined;
  const list = (items: unknown): string[] =>
    Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string') : [];
  const mode = ['auto', 'catalog', 'argon_only', 'exclude_argon', 'custom'].includes(
    String(value.mode)
  )
    ? (value.mode as EnterpriseModelPolicyState['mode'])
    : 'auto';
  const sub = isRecord(value.subscription) ? value.subscription : {};
  return {
    mode,
    effectiveMode: text(value.effective_mode) ?? 'auto',
    status: text(value.status) ?? 'blocked',
    reason: text(value.reason),
    enforcedAllowedModels:
      value.enforced_allowed_models === undefined
        ? undefined
        : value.enforced_allowed_models === null
          ? null
          : list(value.enforced_allowed_models),
    enforcedReason: text(value.enforced_reason),
    ...(isRecord(value.catalog_state)
      ? {
          catalogState: {
            source: text(value.catalog_state.source) ?? 'none',
            status: text(value.catalog_state.status) ?? 'pending',
            checkedAt: text(value.catalog_state.checked_at),
            lastSuccessAt: text(value.catalog_state.last_success_at),
            ...(isRecord(value.catalog_state.last_error)
              ? {
                  lastError: {
                    code: text(value.catalog_state.last_error.code) ?? 'catalog_unavailable',
                    httpStatus: enterpriseRevision(value.catalog_state.last_error.http_status),
                    reason: text(value.catalog_state.last_error.reason),
                    service: text(value.catalog_state.last_error.service),
                    consumerProject: text(value.catalog_state.last_error.consumer_project),
                  },
                }
              : {}),
          },
        }
      : {}),
    imageGenerationDisabled: bool(value.image_generation_disabled),
    catalogKnown: value.catalog_known === true,
    allowedModels: Array.isArray(value.allowed_models) ? list(value.allowed_models) : null,
    excludedModels: list(value.excluded_models),
    globalExcludedModels: list(value.global_excluded_models),
    effectiveModels: list(value.effective_models),
    catalogModels: (Array.isArray(value.catalog_models) ? value.catalog_models : [])
      .filter(isRecord)
      .filter((entry) => text(entry.id))
      .map((entry) => ({
        id: text(entry.id)!,
        displayName: text(entry.display_name),
        mediaKind: text(entry.media_kind),
        allowed: entry.allowed === true,
        reason: text(entry.reason),
      })),
    subscription: {
      status: text(sub.status) ?? 'unknown',
      edition: text(sub.edition),
      freeTrial: typeof sub.free_trial === 'boolean' ? sub.free_trial : null,
      state: text(sub.state),
      checkedAt: text(sub.checked_at),
      lastSuccessAt: text(sub.last_success_at),
      reason: text(sub.reason),
    },
  };
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
          modelPolicyState: normalizeEnterpriseModelPolicy(entry.model_policy_state),
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
    modelPolicySupported: bool(value.model_policy_supported),
    catalogFallbackSupported: bool(value.catalog_fallback_supported),
    modelPolicyState: normalizeEnterpriseModelPolicy(value.model_policy_state),
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
            projects: (Array.isArray(discovery.projects) ? discovery.projects : [])
              .filter(isRecord)
              .filter((project) => text(project.project_id))
              .map((project) => ({
                id: text(project.project_id)!,
                name: text(project.project_name),
              })),
            coverage: (Array.isArray(discovery.coverage) ? discovery.coverage : [])
              .filter(isRecord)
              .map((entry) => ({
                project: text(entry.project_id),
                location: text(entry.location),
                status: text(entry.status),
                code: text(entry.code),
              })),
            warnings: (Array.isArray(discovery.warnings) ? discovery.warnings : [])
              .filter(isRecord)
              .map((warning) => ({
                project: text(warning.project_id) ?? text(warning.project),
                location: text(warning.location),
                code: text(warning.code),
                message: text(warning.message),
                httpStatus: enterpriseRevision(warning.http_status),
                reason: text(warning.reason),
                service: text(warning.service),
                consumerProject: text(warning.consumer_project),
              })),
          },
        }
      : {}),
  };
}
