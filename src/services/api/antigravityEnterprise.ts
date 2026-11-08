import type { AuthFileItem } from '@/types';
import type {
  AntigravityEnterpriseAccount,
  AntigravityEnterpriseBinding,
  AntigravityEnterpriseLicense,
  AntigravityEnterpriseQuota,
} from '@/types/antigravityEnterprise';
import { isRecord } from '@/utils/helpers';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
} from '@/utils/recentRequests';
import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { normalizeAuthFileCooldowns } from './authFileCooldowns';
import { enterpriseRevision, enterpriseSettings } from './enterpriseAccounts';
import { InvalidManagementResponseError, requireManagementObject } from './managementResponse';

export const ANTIGRAVITY_ENTERPRISE_PROVIDER = 'antigravity-enterprise';
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const timestamp = (value: unknown): string | undefined => {
  const result = text(value);
  return result && Number.isFinite(Date.parse(result)) ? result : undefined;
};

function normalizeLicense(value: unknown): AntigravityEnterpriseLicense | undefined {
  if (!isRecord(value)) return undefined;
  const projectId = text(value.projectId);
  const location = text(value.location);
  const userTier = text(value.userTier);
  if (!projectId || !location || !userTier) return undefined;
  return {
    projectId,
    location,
    userTier,
    tierDisplayName: text(value.tierDisplayName) || userTier,
    processingLocation: text(value.processingLocation) || undefined,
  };
}

export function normalizeAntigravityEnterpriseAccount(
  value: unknown,
  observedAt?: string,
  receivedAtMs = Date.now()
): AntigravityEnterpriseAccount | undefined {
  if (!isRecord(value) || !text(value.account_id)) return undefined;
  const bindings: AntigravityEnterpriseBinding[] = [];
  for (const entry of Array.isArray(value.bindings) ? value.bindings : []) {
    if (!isRecord(entry)) continue;
    const license = normalizeLicense(entry.license);
    if (!text(entry.binding_id) || !license) continue;
    bindings.push({
      bindingId: text(entry.binding_id),
      revision: enterpriseRevision(entry.revision),
      authIndex: normalizeRecentRequestAuthIndex(entry.auth_index) ?? undefined,
      license,
      disabled: entry.disabled === true,
      effectiveDisabled: entry.effective_disabled === true || entry.disabled === true,
      missing: entry.missing === true,
      status: text(entry.status) || undefined,
      statusMessage: text(entry.status_message) || undefined,
      successCount: normalizeUsageTotal(entry.success),
      failureCount: normalizeUsageTotal(entry.failed),
      recentRequests: normalizeRecentRequestBuckets(entry.recent_requests),
      cooldownSnapshot: normalizeAuthFileCooldowns(entry.cooldowns, observedAt, receivedAtMs),
      settings: enterpriseSettings(entry.settings),
    });
  }
  const discovery = isRecord(value.discovery) ? value.discovery : undefined;
  return {
    accountId: text(value.account_id),
    revision: enterpriseRevision(value.revision),
    accountManagementSupported: value.account_management_supported === true,
    hasRefreshToken:
      typeof value.has_refresh_token === 'boolean' ? value.has_refresh_token : undefined,
    bindings,
    ...(discovery
      ? {
          discovery: {
            status: text(discovery.status) || undefined,
            checkedAt: timestamp(discovery.checked_at),
            unreachable: Array.isArray(discovery.unreachable)
              ? discovery.unreachable.filter((item): item is string => typeof item === 'string')
              : [],
          },
        }
      : {}),
  };
}

export function antigravityEnterpriseBindingFiles(parent: AuthFileItem): AuthFileItem[] {
  const account = parent.antigravityEnterprise;
  if (!account?.bindings) return account?.bindingId ? [parent] : [];
  return account.bindings.map((binding) => ({
    ...binding.settings,
    name: parent.name,
    type: ANTIGRAVITY_ENTERPRISE_PROVIDER,
    provider: ANTIGRAVITY_ENTERPRISE_PROVIDER,
    email: parent.email,
    projectId: binding.license.projectId,
    authIndex: binding.authIndex,
    disabled: binding.disabled,
    unavailable: binding.missing,
    status: binding.status,
    statusMessage: binding.statusMessage,
    successCount: binding.successCount,
    failureCount: binding.failureCount,
    recentRequests: binding.recentRequests,
    cooldownSnapshot: binding.cooldownSnapshot,
    antigravityEnterprise: {
      ...account,
      ...binding,
      bindings: undefined,
      accountAuthIndex: String(parent.authIndex ?? ''),
      accountRevision: account.revision,
      effectiveDisabled: parent.disabled === true || binding.effectiveDisabled,
    },
  }));
}

export function antigravityEnterpriseIdentity(file: AuthFileItem): string {
  const account = file.antigravityEnterprise;
  return JSON.stringify([
    file.name,
    account?.accountId,
    String(file.authIndex ?? ''),
    account?.bindingId,
    account?.revision,
    account?.license,
    account?.effectiveDisabled,
    account?.settings,
    file.disabled,
  ]);
}

export function normalizeAntigravityEnterpriseQuota(value: unknown): AntigravityEnterpriseQuota {
  requireManagementObject(value);
  if (!text(value.account_id) || !text(value.binding_id))
    throw new InvalidManagementResponseError();
  const quota = isRecord(value.quota) ? value.quota : {};
  const groups = Array.isArray(quota.groups) ? quota.groups : [];
  const buckets = groups
    .filter(isRecord)
    .flatMap((group) => (Array.isArray(group.buckets) ? group.buckets.filter(isRecord) : []));
  const matching = buckets.filter((bucket) => bucket.bucketId === 'gemini-enterprise-weekly');
  const bucket = matching.length === 1 ? matching[0] : undefined;
  const fraction = bucket?.remainingFraction;
  const amount = bucket?.remainingAmount;
  const hasFraction = fraction !== undefined && fraction !== null;
  const hasAmount = amount !== undefined && amount !== null;
  const validFraction =
    typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1;
  const validAmount =
    (typeof amount === 'string' && /^\d+$/.test(amount)) ||
    (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0);
  const overage = isRecord(quota.overageInfo) ? quota.overageInfo : undefined;
  return {
    accountId: text(value.account_id),
    bindingId: text(value.binding_id),
    revision: enterpriseRevision(value.revision),
    poolId: text(value.pool_id),
    status: text(value.status) || 'unknown',
    stale: value.stale === true,
    observedAt: timestamp(quota.observed_at),
    // A present proto3 message has false as the default scalar value.
    overageEnabled: overage
      ? typeof overage.enabled === 'boolean'
        ? overage.enabled
        : 'enabled' in overage
          ? null
          : false
      : null,
    ...(bucket && bucket.window === 'weekly'
      ? {
          weekly: {
            remainingFraction: hasFraction && !hasAmount && validFraction ? fraction : null,
            remainingAmount: hasAmount && !hasFraction && validAmount ? String(amount) : null,
            resetAt: timestamp(bucket.resetTime) ?? null,
            disabled: bucket.disabled === true,
          },
        }
      : {}),
  };
}

function bindingTarget(file: AuthFileItem) {
  const account = file.antigravityEnterprise;
  if (!account?.bindingId || !account.license || !account.revision || !file.authIndex)
    throw new InvalidManagementResponseError();
  return {
    name: file.name,
    auth_index: String(file.authIndex),
    binding_id: account.bindingId,
    revision: account.revision,
  };
}

export const antigravityEnterpriseApi = {
  async discover(file: AuthFileItem, signal?: AbortSignal) {
    const assertConnection = guardConfigConnection();
    const response = await apiClient.post(
      '/credentials/antigravity-enterprise/discover',
      {
        name: file.name,
        auth_index: String(file.authIndex ?? ''),
        revision: file.antigravityEnterprise?.revision,
      },
      { signal, timeout: 0 }
    );
    assertConnection();
    requireManagementObject(response);
    return response;
  },
  async updateBinding(file: AuthFileItem, fields: Record<string, unknown>, signal?: AbortSignal) {
    const assertConnection = guardConfigConnection();
    await apiClient.patch(
      '/credentials/antigravity-enterprise/bindings',
      { ...bindingTarget(file), fields },
      { signal }
    );
    assertConnection();
  },
  async quota(file: AuthFileItem, refresh = false, signal?: AbortSignal) {
    const assertConnection = guardConfigConnection();
    const target = bindingTarget(file);
    const result = normalizeAntigravityEnterpriseQuota(
      await apiClient.get('/quota/antigravity-enterprise', {
        params: { ...target, refresh },
        signal,
      })
    );
    assertConnection();
    signal?.throwIfAborted();
    if (
      result.accountId !== file.antigravityEnterprise?.accountId ||
      result.bindingId !== target.binding_id ||
      result.revision !== target.revision
    )
      throw new InvalidManagementResponseError();
    return result;
  },
};
