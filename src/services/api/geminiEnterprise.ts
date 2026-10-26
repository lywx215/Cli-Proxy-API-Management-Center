import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { isRecord } from '@/utils/helpers';
import { enterpriseRevision, normalizeEnterpriseAccount } from './enterpriseAccounts';
import type { AuthFileFieldsPatch } from './authFiles';
import type { AuthFileItem } from '@/types';
import { requireManagementObject, InvalidManagementResponseError } from './managementResponse';
import {
  serializeEnterpriseResources,
  type EnterpriseResources,
} from '@/features/authFiles/enterpriseResources';
import type { GeminiEnterpriseConfig } from '@/types/config';
import type {
  GeminiEnterpriseQuotaData,
  GeminiEnterpriseQuotaStatus,
  GeminiEnterpriseQuotaPool,
} from '@/types/geminiEnterpriseQuota';

export function normalizeGeminiEnterpriseQuota(value: unknown): GeminiEnterpriseQuotaData {
  const source = isRecord(value) ? value : {};
  const status = (raw: unknown): GeminiEnterpriseQuotaStatus =>
    raw === 'ok' ||
    raw === 'partial' ||
    raw === 'stale' ||
    raw === 'no_permission' ||
    raw === 'no_data'
      ? raw
      : 'unavailable';
  const time = (raw: unknown): string | null =>
    typeof raw === 'string' && Number.isFinite(Date.parse(raw)) && !raw.startsWith('0001-')
      ? raw
      : null;
  const amount = (raw: unknown): number | null =>
    typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  const normalizePool = (pool: Record<string, unknown>): GeminiEnterpriseQuotaPool => {
    const used = amount(pool.used);
    const limit = amount(pool.limit);
    return {
      tier: typeof pool.tier === 'string' ? pool.tier : '',
      status: status(pool.status),
      limit,
      used,
      remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null,
      usageUpdatedAt: time(pool.usage_updated_at),
    };
  };
  const pools = (Array.isArray(source.pools) ? source.pools : [])
    .filter(isRecord)
    .map(normalizePool);
  // Legacy responses omit selection. Preserve explicit unknowns and avoid guessing an edition.
  const hasSelection = Object.prototype.hasOwnProperty.call(source, 'selected_pool');
  const selectedPool = hasSelection
    ? isRecord(source.selected_pool)
      ? normalizePool(source.selected_pool)
      : null
    : pools.length === 1
      ? pools[0]
      : null;
  return {
    status: status(source.status),
    observedAt: time(source.observed_at),
    periodStart: time(source.period_start),
    resetAt: time(source.reset_at),
    pools,
    selectedPool,
    accountId: typeof source.account_id === 'string' ? source.account_id : undefined,
    bindingId: typeof source.binding_id === 'string' ? source.binding_id : undefined,
    revision: enterpriseRevision(source.revision),
  };
}

export const GEMINI_ENTERPRISE_CALLBACK_URL = 'http://localhost:8788/oauth-callback';
export const GEMINI_ENTERPRISE_FIELDS = [
  'clientId',
  'clientSecretEnv',
  'projectId',
  'location',
  'collectionId',
  'engineId',
  'assistantId',
] as const satisfies readonly (keyof GeminiEnterpriseConfig)[];
const KEYS = [
  'client-id',
  'client-secret-env',
  'project-id',
  'location',
  'collection-id',
  'engine-id',
  'assistant-id',
];

export function normalizeGeminiEnterpriseConfig(value: unknown): GeminiEnterpriseConfig {
  const source = isRecord(value) ? value : {};
  const text = (key: string, fallback = '') =>
    typeof source[key] === 'string' ? source[key].trim() || fallback : fallback;
  return {
    clientId: text('client-id'),
    clientSecretEnv: text('client-secret-env'),
    projectId: text('project-id'),
    location: text('location', 'global'),
    collectionId: text('collection-id', 'default_collection'),
    engineId: text('engine-id'),
    assistantId: text('assistant-id', 'default_assistant'),
  };
}

export function readGeminiEnterpriseConfig(raw: unknown): GeminiEnterpriseConfig {
  const oauth = isRecord(raw) && isRecord(raw.oauth) ? raw.oauth : {};
  const providers = isRecord(oauth.providers) ? oauth.providers : {};
  return normalizeGeminiEnterpriseConfig(providers['gemini-enterprise']);
}

export function serializeGeminiEnterpriseConfig(value: GeminiEnterpriseConfig) {
  return Object.fromEntries(
    GEMINI_ENTERPRISE_FIELDS.map((field, index) => [KEYS[index], value[field].trim()])
  );
}

export function sameGeminiEnterpriseConfig(a: GeminiEnterpriseConfig, b: GeminiEnterpriseConfig) {
  return GEMINI_ENTERPRISE_FIELDS.every((field) => a[field] === b[field]);
}

export class GeminiEnterpriseConfigConflict extends Error {}

export type EnterpriseCollectionPatch = {
  disabled?: boolean;
  resources?: EnterpriseResources;
  fields?: AuthFileFieldsPatch;
};

function accountResponse(value: unknown, file: Pick<AuthFileItem, 'geminiEnterprise'>) {
  requireManagementObject(value);
  const account = normalizeEnterpriseAccount(value.gemini_enterprise);
  if (
    !account ||
    (file.geminiEnterprise?.accountId && account.accountId !== file.geminiEnterprise.accountId)
  ) {
    throw new InvalidManagementResponseError();
  }
  return account;
}

export const geminiEnterpriseApi = {
  async discover(file: AuthFileItem, signal?: AbortSignal) {
    const assertConnection = guardConfigConnection();
    const result = await apiClient.post(
      '/credentials/gemini-enterprise/discover',
      {
        name: file.name,
        auth_index: String(file.geminiEnterprise?.accountAuthIndex ?? file.authIndex ?? ''),
        ...(file.geminiEnterprise?.accountId
          ? { account_id: file.geminiEnterprise.accountId }
          : {}),
        ...(file.geminiEnterprise?.revision !== undefined
          ? { expected_revision: file.geminiEnterprise.revision }
          : {}),
      },
      { signal, timeout: 0 }
    );
    assertConnection();
    signal?.throwIfAborted();
    requireManagementObject(result);
    if (result.status !== 'ok' && result.status !== 'partial')
      throw new InvalidManagementResponseError();
    const addedProjectCount = enterpriseRevision(result.added_project_count);
    const addedCollectionCount = enterpriseRevision(result.added_collection_count);
    if (addedProjectCount === undefined || addedCollectionCount === undefined)
      throw new InvalidManagementResponseError();
    return {
      account: accountResponse(result, file),
      status: result.status,
      addedBindingIds: (Array.isArray(result.added_binding_ids)
        ? result.added_binding_ids
        : []
      ).filter((id): id is string => typeof id === 'string'),
      addedProjectCount,
      addedCollectionCount,
    };
  },

  async updateCollection(
    file: Pick<AuthFileItem, 'name' | 'authIndex' | 'geminiEnterprise'>,
    patch: EnterpriseCollectionPatch,
    signal?: AbortSignal
  ) {
    const assertConnection = guardConfigConnection();
    const binding = file.geminiEnterprise;
    if (!binding?.bindingId || binding.revision === undefined || !String(file.authIndex ?? '')) {
      throw new InvalidManagementResponseError();
    }
    const result = await apiClient.patch(
      '/credentials/gemini-enterprise/collections',
      {
        name: file.name,
        auth_index: String(file.authIndex),
        binding_id: binding.bindingId,
        expected_revision: binding.revision,
        ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
        ...(patch.resources ? { resources: serializeEnterpriseResources(patch.resources) } : {}),
        ...(patch.fields ? { fields: patch.fields } : {}),
      },
      { signal, timeout: 0 }
    );
    assertConnection();
    signal?.throwIfAborted();
    requireManagementObject(result);
    if (result.status !== 'ok') throw new InvalidManagementResponseError();
    return accountResponse(result, file);
  },

  async updateResources(
    file: Pick<AuthFileItem, 'name' | 'authIndex' | 'geminiEnterprise'>,
    resources: EnterpriseResources,
    expected: EnterpriseResources,
    signal?: AbortSignal
  ): Promise<void> {
    if (file.geminiEnterprise?.bindingId) {
      await geminiEnterpriseApi.updateCollection(file, { resources }, signal);
      return;
    }
    const assertConnection = guardConfigConnection();
    const result = await apiClient.patch(
      '/credentials/gemini-enterprise/resources',
      {
        name: file.name,
        auth_index: String(file.authIndex ?? ''),
        expected: serializeEnterpriseResources(expected),
        resources: serializeEnterpriseResources(resources),
      },
      { signal }
    );
    assertConnection();
    signal?.throwIfAborted();
    requireManagementObject(result);
    if (result.status !== 'ok' || !isRecord(result.gemini_enterprise)) {
      throw new InvalidManagementResponseError();
    }
  },

  async quota(
    authIndex: string,
    target?: {
      bindingId?: string;
      accountId?: string;
      revision?: number;
      refresh?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<GeminiEnterpriseQuotaData> {
    const assertConnection = guardConfigConnection();
    let result: unknown;
    try {
      result = await apiClient.get('/quota/gemini-enterprise', {
        params: {
          auth_index: authIndex,
          ...(target?.bindingId ? { binding_id: target.bindingId } : {}),
          ...(target?.refresh ? { refresh: true } : {}),
        },
        ...(target?.signal ? { signal: target.signal } : {}),
      });
    } catch {
      // Optional quota reads must not surface raw Google or transport failures.
      result = { status: 'unavailable' };
    }
    assertConnection();
    target?.signal?.throwIfAborted();
    const data = normalizeGeminiEnterpriseQuota(result);
    if (
      target?.bindingId &&
      (data.bindingId !== target.bindingId ||
        data.accountId !== target.accountId ||
        data.revision !== target.revision)
    ) {
      throw new InvalidManagementResponseError();
    }
    return data;
  },

  async save(
    value: GeminiEnterpriseConfig,
    expected: GeminiEnterpriseConfig,
    signal?: AbortSignal
  ) {
    const assertConnection = guardConfigConnection();
    const latest = await apiClient.getRaw('/config', { signal });
    assertConnection();
    signal?.throwIfAborted();
    if (!sameGeminiEnterpriseConfig(readGeminiEnterpriseConfig(latest.data), expected)) {
      throw new GeminiEnterpriseConfigConflict('Gemini Enterprise configuration changed');
    }
    const etag = latest.headers?.etag;
    if (typeof etag !== 'string' || !etag)
      throw new GeminiEnterpriseConfigConflict('Missing configuration revision');
    if (sameGeminiEnterpriseConfig(value, expected)) return;
    await apiClient.patch(
      '/config/oauth/providers/gemini-enterprise',
      serializeGeminiEnterpriseConfig(value),
      {
        signal,
        headers: { 'If-Match': etag },
      }
    );
    assertConnection();
  },
};
