import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { isRecord } from '@/utils/helpers';

export interface GeminiBudgetModel {
  model: string;
  limit: number;
  used: number;
  remaining: number;
  inflight: number;
  state: string;
  retryAt: string | null;
  estimated: boolean;
}
export interface GeminiBudgetProject {
  projectId: string;
  keyCount: number;
  models: GeminiBudgetModel[];
}
export interface GeminiBudgetSnapshot {
  revision: string;
  enabled: boolean;
  engineState: string;
  initialized: boolean;
  canInitialize: boolean;
  pacificDate: string;
  nextReset: string | null;
  estimated: boolean;
  projects: GeminiBudgetProject[];
  backupEnabled: boolean;
  lastBackup: {
    state: string;
    date: string | null;
    attemptedAt: string | null;
    completedAt: string | null;
  };
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Reject incomplete counters instead of presenting unknown quota as zero. */
export function normalizeGeminiBudget(value: unknown): GeminiBudgetSnapshot {
  const invalid = () => new Error('Invalid Gemini budget snapshot.');
  if (
    !isRecord(value) ||
    !text(value.revision) ||
    typeof value.enabled !== 'boolean' ||
    !text(value.engine_state) ||
    typeof value.initialized !== 'boolean' ||
    typeof value.pacific_date !== 'string' ||
    !Array.isArray(value.projects)
  ) {
    throw invalid();
  }
  const projects = value.projects.map((project): GeminiBudgetProject => {
    if (
      !isRecord(project) ||
      !text(project.project_id) ||
      !count(project.key_count) ||
      !Array.isArray(project.models)
    ) {
      throw invalid();
    }
    return {
      projectId: project.project_id as string,
      keyCount: project.key_count,
      models: project.models.map((model): GeminiBudgetModel => {
        if (
          !isRecord(model) ||
          !text(model.model) ||
          !count(model.limit) ||
          !count(model.used) ||
          !count(model.remaining) ||
          !count(model.inflight) ||
          !text(model.state)
        ) {
          throw invalid();
        }
        return {
          model: model.model as string,
          limit: model.limit,
          used: model.used,
          remaining: model.remaining,
          inflight: model.inflight,
          state: model.state as string,
          retryAt: text(model.retry_at),
          estimated: model.estimated === true,
        };
      }),
    };
  });
  const backup = isRecord(value.last_backup) ? value.last_backup : {};
  return {
    revision: value.revision as string,
    enabled: value.enabled,
    engineState: value.engine_state as string,
    initialized: value.initialized,
    canInitialize: value.can_initialize === true && !value.enabled && !value.initialized,
    pacificDate: value.pacific_date,
    nextReset: text(value.next_reset),
    estimated: value.estimated === true,
    projects,
    backupEnabled: value.backup_enabled === true,
    lastBackup: {
      state: text(backup.state) ?? 'unknown',
      date: text(backup.date),
      attemptedAt: text(backup.attempted_at),
      completedAt: text(backup.completed_at),
    },
  };
}

export const isGeminiBudgetUnsupported = (error: unknown): boolean =>
  isRecord(error) && error.status === 404;
export const isGeminiBudgetConflict = (error: unknown): boolean =>
  isRecord(error) && error.status === 409;

const ROOT = '/quota/gemini-budget';
export const geminiBudgetApi = {
  async snapshot(): Promise<GeminiBudgetSnapshot> {
    const assertConnection = guardConfigConnection();
    try {
      const result = await apiClient.get<unknown>(ROOT);
      assertConnection();
      return normalizeGeminiBudget(result);
    } catch (error) {
      assertConnection();
      throw error;
    }
  },
  async initialize(revision: string): Promise<unknown> {
    if (!revision.trim() || /["\r\n]/.test(revision)) {
      throw new Error('Invalid Gemini budget revision.');
    }
    const assertConnection = guardConfigConnection();
    try {
      const result = await apiClient.post(
        `${ROOT}/init`,
        { revision, acknowledge_unknown_usage: true },
        {
          headers: { 'If-Match': `"${revision}"` },
          transformRequest: [
            (data: unknown) => {
              assertConnection();
              return JSON.stringify(data);
            },
          ],
        }
      );
      assertConnection();
      return result;
    } catch (error) {
      assertConnection();
      throw error;
    }
  },
};
