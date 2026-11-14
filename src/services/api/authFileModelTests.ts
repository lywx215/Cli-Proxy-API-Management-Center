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
import { EnterpriseWebClientError, isClassifiedWebPolicy } from './geminiEnterpriseWeb';
import { ENTERPRISE_HYDROGEN_MODEL } from '@/features/authFiles/enterpriseModelPolicy';

const STATUSES: readonly string[] = ['ok', 'failed', 'cooling', 'unavailable'];

export function normalizeAntigravityEnterpriseModelTest(
  value: unknown,
  file: AuthFileItem,
  model: string
): ModelTestResult {
  requireManagementObject(value);
  const binding = file.antigravityEnterprise;
  const license = binding?.license;
  const resources = isRecord(value.resources) ? value.resources : {};
  const status = typeof value.status === 'string' ? value.status : '';
  const checkedAt = typeof value.checked_at === 'string' ? value.checked_at : '';
  const httpStatus = value.http_status;
  const elapsed = value.elapsed_ms;
  if (
    !binding?.bindingId ||
    !license ||
    !STATUSES.includes(status) ||
    value.model !== model ||
    value.auth_index !== String(file.authIndex ?? '') ||
    value.binding_id !== binding.bindingId ||
    value.revision !== binding.revision ||
    resources.project_id !== license.projectId ||
    resources.location !== license.location ||
    !Number.isFinite(Date.parse(checkedAt)) ||
    typeof elapsed !== 'number' ||
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    typeof httpStatus !== 'number' ||
    !Number.isInteger(httpStatus) ||
    httpStatus < 0 ||
    httpStatus > 599 ||
    (status === 'ok' && (httpStatus < 200 || httpStatus >= 300))
  )
    throw new InvalidManagementResponseError();
  const retry = value.retry_after_seconds;
  return {
    status: status as ModelTestStatus,
    model,
    authIndex: String(file.authIndex),
    bindingId: binding.bindingId,
    revision: binding.revision,
    checkedAt,
    elapsedMs: elapsed,
    httpStatus,
    code: typeof value.code === 'string' ? value.code : '',
    message: sanitizeModelTestMessage(typeof value.message === 'string' ? value.message : ''),
    upstreamModel: typeof value.upstream_model === 'string' ? value.upstream_model : undefined,
    retryAfterSeconds:
      typeof retry === 'number' && Number.isFinite(retry) && retry >= 0 ? retry : undefined,
  };
}

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
    upstreamModel: text('upstream_model') || undefined,
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
  async test(
    file: AuthFileItem,
    model: string,
    signal: AbortSignal,
    expectedUpstreamModel = model
  ): Promise<ModelTestResult> {
    const assertConnection = guardConfigConnection();
    if (file.antigravityEnterprise) {
      const binding = file.antigravityEnterprise;
      if (!binding.bindingId || !binding.revision || !binding.license || binding.bindings)
        throw new InvalidManagementResponseError();
      const result = normalizeAntigravityEnterpriseModelTest(
        await apiClient.post(
          '/credentials/models/test',
          {
            name: file.name,
            auth_index: String(file.authIndex ?? ''),
            binding_id: binding.bindingId,
            expected_revision: binding.revision,
            model,
          },
          { signal, timeout: 0 }
        ),
        file,
        model
      );
      assertConnection();
      signal.throwIfAborted();
      if (result.upstreamModel && result.upstreamModel !== expectedUpstreamModel)
        throw new InvalidManagementResponseError();
      return result;
    }
    if ((file.type || file.provider) === 'gemini-enterprise-web') {
      const summary = file.geminiEnterpriseWeb;
      if (!summary?.modelPolicySupported || !isClassifiedWebPolicy(summary.modelPolicy))
        throw new EnterpriseWebClientError('missing_policy');
      if ((expectedUpstreamModel === 'gemini-4-argon') !== (summary.modelPolicy === 'argon_only'))
        throw new InvalidManagementResponseError();
      const result = normalizeWebModelTestResult(
        await apiClient.post(
          '/credentials/gemini-enterprise-web/models/test',
          {
            name: file.name,
            auth_index: String(file.authIndex ?? ''),
            model,
            expected_upstream_model: expectedUpstreamModel,
            expected_revision: file.geminiEnterpriseWeb?.revision,
          },
          { signal, timeout: 0 }
        )
      );
      assertConnection();
      signal.throwIfAborted();
      if (
        result.model !== model ||
        result.upstreamModel !== expectedUpstreamModel ||
        result.authIndex !== String(file.authIndex ?? '') ||
        result.revision !== file.geminiEnterpriseWeb?.revision
      )
        throw new InvalidManagementResponseError();
      return result;
    }
    const hydrogenDirect = expectedUpstreamModel === ENTERPRISE_HYDROGEN_MODEL;
    const expected = enterpriseResources(file.geminiEnterprise);
    const result = normalizeModelTestResult(
      await apiClient.post(
        '/credentials/models/test',
        {
          name: file.name,
          auth_index: String(file.authIndex ?? ''),
          model,
          expected: serializeEnterpriseResources(expected),
          ...(expectedUpstreamModel === 'gemini-4-carbon' ? { carbon_direct: true } : {}),
          ...(hydrogenDirect ? { hydrogen_direct: true } : {}),
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
      (hydrogenDirect && result.upstreamModel !== expectedUpstreamModel) ||
      (file.geminiEnterprise?.bindingId &&
        (result.bindingId !== file.geminiEnterprise.bindingId ||
          result.revision !== file.geminiEnterprise.revision)) ||
      !result.resources ||
      !sameEnterpriseResources(result.resources, expected)
    ) {
      throw new InvalidManagementResponseError();
    }
    return result;
  },
};

export function normalizeWebModelTestResult(value: unknown): ModelTestResult {
  requireManagementObject(value);
  const text = (key: string) => (typeof value[key] === 'string' ? value[key].trim() : '');
  const elapsed = value.elapsed_ms,
    status = value.http_status,
    revision = value.revision;
  if (
    value.provider !== 'gemini-enterprise-web' ||
    value.test_kind !== 'inline_media' ||
    !STATUSES.includes(text('status')) ||
    !text('model') ||
    !text('upstream_model') ||
    !text('auth_index') ||
    !Number.isFinite(Date.parse(text('checked_at'))) ||
    typeof elapsed !== 'number' ||
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 0 ||
    status > 599 ||
    (text('status') === 'ok' && status !== 200) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision <= 0
  )
    throw new InvalidManagementResponseError();
  return {
    status: text('status') as ModelTestStatus,
    model: text('model'),
    upstreamModel: text('upstream_model'),
    authIndex: text('auth_index'),
    revision,
    checkedAt: text('checked_at'),
    elapsedMs: elapsed,
    httpStatus: status,
    code: text('code'),
    message: sanitizeModelTestMessage(text('message')),
    testKind: 'inline_media',
    retryAfterSeconds:
      typeof value.retry_after_seconds === 'number' &&
      Number.isFinite(value.retry_after_seconds) &&
      value.retry_after_seconds >= 0
        ? value.retry_after_seconds
        : undefined,
  };
}
