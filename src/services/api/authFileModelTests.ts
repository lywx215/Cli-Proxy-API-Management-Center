import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { requireManagementObject, InvalidManagementResponseError } from './managementResponse';
import type { AuthFileItem } from '@/types';
import type { ModelTestResult, ModelTestStatus } from '@/features/authFiles/modelTesting';
import { sanitizeModelTestMessage } from '@/features/authFiles/modelTesting';
import {
  enterpriseResources,
  sameEnterpriseResources,
  serializeEnterpriseResources,
  validEnterpriseResources,
} from '@/features/authFiles/enterpriseResources';
import { isRecord } from '@/utils/helpers';
import { enterpriseRevision } from './enterpriseAccounts';

const STATUSES: readonly string[] = ['ok', 'failed', 'cooling', 'unavailable'];

export function normalizeModelTestResult(value: unknown): ModelTestResult {
  requireManagementObject(value);
  const text = (key: string) => (typeof value[key] === 'string' ? value[key].trim() : '');
  if (!STATUSES.includes(text('status')) || !isRecord(value.resources)) {
    throw new InvalidManagementResponseError();
  }
  const binding = value.resources;
  const resource = (key: string) => (typeof binding[key] === 'string' ? binding[key].trim() : '');
  const resources = {
    projectId: resource('project_id'),
    location: resource('location'),
    collectionId: resource('collection_id'),
    engineId: resource('engine_id'),
    assistantId: resource('assistant_id'),
  };
  const elapsed = value.elapsed_ms;
  const httpStatus = value.http_status;
  const checkedAt = text('checked_at');
  if (
    !validEnterpriseResources(resources) ||
    !text('model') ||
    !text('auth_index') ||
    !Number.isFinite(Date.parse(checkedAt)) ||
    typeof elapsed !== 'number' ||
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    typeof httpStatus !== 'number' ||
    !Number.isInteger(httpStatus) ||
    httpStatus < 0 ||
    httpStatus > 599 ||
    (text('status') === 'ok' && (httpStatus < 200 || httpStatus >= 300))
  ) {
    throw new InvalidManagementResponseError();
  }
  const retry = value.retry_after_seconds;
  return {
    status: text('status') as ModelTestStatus,
    model: text('model'),
    authIndex: text('auth_index'),
    resources,
    checkedAt,
    elapsedMs: elapsed,
    httpStatus,
    code: text('code'),
    message: sanitizeModelTestMessage(text('message')),
    bindingId: text('binding_id') || undefined,
    revision: enterpriseRevision(value.revision),
    retryAfterSeconds:
      typeof retry === 'number' && Number.isFinite(retry) && retry >= 0 ? retry : undefined,
  };
}

export const authFileModelTestsApi = {
  async test(file: AuthFileItem, model: string, signal: AbortSignal): Promise<ModelTestResult> {
    const assertConnection = guardConfigConnection();
    const expected = enterpriseResources(file.geminiEnterprise);
    const result = normalizeModelTestResult(
      await apiClient.post(
        '/credentials/models/test',
        {
          name: file.name,
          auth_index: String(file.authIndex ?? ''),
          model,
          expected: serializeEnterpriseResources(expected),
          ...(file.geminiEnterprise?.bindingId
            ? {
                binding_id: file.geminiEnterprise.bindingId,
                expected_revision: file.geminiEnterprise.revision,
              }
            : {}),
        },
        { signal, timeout: 0 }
      )
    );
    assertConnection();
    signal.throwIfAborted();
    if (
      result.authIndex !== String(file.authIndex ?? '') ||
      result.model !== model ||
      (file.geminiEnterprise?.bindingId &&
        (result.bindingId !== file.geminiEnterprise.bindingId ||
          result.revision !== file.geminiEnterprise.revision)) ||
      !sameEnterpriseResources(result.resources, expected)
    ) {
      throw new InvalidManagementResponseError();
    }
    return result;
  },
};
