import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { isRecord } from '@/utils/helpers';

export interface GeminiAliasRule extends Record<string, unknown> {
  name: string;
  alias: string;
  fork?: boolean;
  'display-name'?: string;
  'force-mapping'?: boolean;
}
export interface GeminiTarget {
  groupIndex: number;
  keyIndex?: number;
}
export interface GeminiSnapshot {
  revision: string;
  groups: Record<string, unknown>[];
  aliases: GeminiAliasRule[];
  capabilities: { aliases: boolean; batch: boolean; migration: boolean };
}
export type GeminiBatchAction = 'enable' | 'disable' | 'delete' | 'patch';
export interface GeminiMutationResult {
  status: string;
  revision: string;
  affected?: number;
}
export interface GeminiMigrationCandidate {
  id: string;
  rule: GeminiAliasRule;
  targets: GeminiTarget[];
  affectedKeys: number;
  originalNameAdded: boolean;
}
export interface GeminiMigrationPreview {
  revision: string;
  candidates: GeminiMigrationCandidate[];
  skipped: Array<{ reason: string; alias?: string; name?: string }>;
}

const ROOT = '/credentials/api-keys/gemini';
export const normalizeGeminiSnapshot = (value: unknown): GeminiSnapshot => {
  if (
    !isRecord(value) ||
    typeof value.revision !== 'string' ||
    !value.revision ||
    !Array.isArray(value.groups) ||
    !value.groups.every((group) => isRecord(group) && Array.isArray(group.keys)) ||
    !Array.isArray(value.aliases) ||
    !value.aliases.every(
      (rule) => isRecord(rule) && typeof rule.name === 'string' && typeof rule.alias === 'string'
    ) ||
    !isRecord(value.capabilities)
  )
    throw new Error('Invalid Gemini management snapshot.');
  return {
    revision: value.revision,
    groups: value.groups as Record<string, unknown>[],
    aliases: value.aliases as GeminiAliasRule[],
    capabilities: {
      aliases: value.capabilities.aliases === true,
      batch: value.capabilities.batch === true,
      migration: value.capabilities.migration === true,
    },
  };
};
export const isGeminiConfigConflict = (error: unknown): boolean =>
  isRecord(error) && error.status === 409;

async function guarded<T>(request: () => Promise<T>): Promise<T> {
  const assertConnection = guardConfigConnection();
  const result = await request();
  assertConnection();
  return result;
}

const cloneRawValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneRawValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneRawValue(item)])
    );
  }
  return value;
};

const writableGeminiGroups = (groups: Record<string, unknown>[]): Record<string, unknown>[] =>
  groups.map((source) => {
    const group = cloneRawValue(source) as Record<string, unknown>;
    delete group.auth_index;
    delete group['auth-index'];
    if (Array.isArray(group.keys)) {
      group.keys.forEach((key) => {
        if (!isRecord(key)) return;
        delete key.auth_index;
        delete key['auth-index'];
      });
    }
    return group;
  });

export const geminiManagementApi = {
  async snapshot(): Promise<GeminiSnapshot> {
    return normalizeGeminiSnapshot(await guarded(() => apiClient.get<unknown>(`${ROOT}/snapshot`)));
  },
  saveGroups: (revision: string, groups: Record<string, unknown>[]) =>
    guarded(() =>
      apiClient.put<GeminiMutationResult>('/config/api-keys/gemini', writableGeminiGroups(groups), {
        headers: { 'If-Match': `"${revision}"` },
      })
    ),
  batch: (
    revision: string,
    action: GeminiBatchAction,
    targets: GeminiTarget[],
    changes?: Record<string, unknown>
  ) =>
    guarded(() =>
      apiClient.post<GeminiMutationResult>(`${ROOT}/batch`, {
        revision,
        action,
        targets,
        ...(changes ? { changes } : {}),
      })
    ),
  saveAliases: (revision: string, aliases: GeminiAliasRule[]) =>
    guarded(() =>
      apiClient.put<GeminiMutationResult>('/config/routing/api-key-model-alias/gemini', aliases, {
        headers: { 'If-Match': `"${revision}"` },
      })
    ),
  previewMigration: (revision: string) =>
    guarded(() =>
      apiClient.post<GeminiMigrationPreview>(`${ROOT}/alias-migration/preview`, { revision })
    ),
  applyMigration: (revision: string, candidateIds: string[]) =>
    guarded(() =>
      apiClient.post<GeminiMutationResult>(`${ROOT}/alias-migration/apply`, {
        revision,
        candidateIds,
      })
    ),
  modelDefinitions: () =>
    guarded(() =>
      apiClient.get<{ models?: { id: string; display_name?: string }[] }>(
        '/routing/model-definitions/gemini'
      )
    ),
};
