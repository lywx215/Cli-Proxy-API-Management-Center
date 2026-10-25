import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { isRecord } from '@/utils/helpers';
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
} from '@/types/geminiEnterpriseQuota';

export function normalizeGeminiEnterpriseQuota(value: unknown): GeminiEnterpriseQuotaData {
  const source = isRecord(value) ? value : {};
  const status = (raw: unknown): GeminiEnterpriseQuotaStatus =>
    raw === 'ok' || raw === 'no_permission' || raw === 'no_data' ? raw : 'unavailable';
  const time = (raw: unknown): string | null =>
    typeof raw === 'string' && Number.isFinite(Date.parse(raw)) && !raw.startsWith('0001-')
      ? raw
      : null;
  const amount = (raw: unknown): number | null =>
    typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  return {
    status: status(source.status),
    observedAt: time(source.observed_at),
    periodStart: time(source.period_start),
    resetAt: time(source.reset_at),
    pools: (Array.isArray(source.pools) ? source.pools : []).filter(isRecord).map((pool) => ({
      tier: typeof pool.tier === 'string' ? pool.tier : '',
      status: status(pool.status),
      limit: amount(pool.limit),
      used: amount(pool.used),
      remaining: amount(pool.remaining),
      usageUpdatedAt: time(pool.usage_updated_at),
    })),
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

export const geminiEnterpriseApi = {
  async updateResources(
    file: Pick<AuthFileItem, 'name' | 'authIndex'>,
    resources: EnterpriseResources,
    expected: EnterpriseResources,
    signal?: AbortSignal
  ): Promise<void> {
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

  async quota(authIndex: string): Promise<GeminiEnterpriseQuotaData> {
    const assertConnection = guardConfigConnection();
    let result: unknown;
    try {
      result = await apiClient.get('/quota/gemini-enterprise', {
        params: { auth_index: authIndex },
      });
    } catch {
      // Optional quota reads must not surface raw Google or transport failures.
      result = { status: 'unavailable' };
    }
    assertConnection();
    return normalizeGeminiEnterpriseQuota(result);
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
