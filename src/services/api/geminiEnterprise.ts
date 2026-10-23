import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { isRecord } from '@/utils/helpers';
import type { GeminiEnterpriseConfig } from '@/types/config';

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
