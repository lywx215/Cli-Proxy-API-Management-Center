import type { ApiError, AuthFileItem } from '@/types';
import { enterpriseCollectionFiles, enterpriseCollectionIdentity } from './enterpriseAccounts';
import { enterpriseResources, validEnterpriseResources } from './enterpriseResources';
import type { ModelTestResult } from './modelTesting';

export function shouldStopCarbonApplicationTests(result: ModelTestResult): boolean {
  // Unlike testing several models on one application, this queue owns distinct
  // applications. Only an invalidated request scope stops the remaining work.
  return (
    result.status !== 'ok' &&
    [
      'credential_changed',
      'authorization_changed',
      'carbon_authorization_changed',
      'binding_changed',
      'carbon_binding_changed',
      'configuration_changed',
      'carbon_configuration_changed',
      'model_changed',
    ].includes(result.code)
  );
}

export function carbonApplicationTestFailure(file: AuthFileItem, cause: unknown): ModelTestResult {
  const failure = cause && typeof cause === 'object' ? (cause as Partial<ApiError>) : undefined;
  const status = failure?.status;
  return {
    status: 'unavailable',
    model: 'gemini-4-carbon',
    authIndex: String(file.authIndex ?? ''),
    resources: enterpriseResources(file.geminiEnterprise),
    checkedAt: new Date().toISOString(),
    elapsedMs: 0,
    httpStatus:
      typeof status === 'number' && Number.isInteger(status) && status >= 0 && status <= 599
        ? status
        : 0,
    code:
      typeof failure?.apiCode === 'string' && failure.apiCode ? failure.apiCode : 'request_failed',
    message: '',
  };
}

export function validCarbonConfigurationApplication(file: AuthFileItem): boolean {
  return Boolean(
    file.geminiEnterprise?.bindingId &&
    !file.geminiEnterprise.missing &&
    String(file.authIndex ?? '').trim() &&
    (file.geminiEnterprise.revision ?? 0) > 0 &&
    validEnterpriseResources(enterpriseResources(file.geminiEnterprise))
  );
}

export function enterpriseCarbonAccountIdentity(file: AuthFileItem): string {
  return JSON.stringify([
    file.name,
    file.authIndex,
    Boolean(file.disabled),
    file.geminiEnterprise?.accountId,
    file.geminiEnterprise?.revision,
    enterpriseCollectionFiles(file).map((child) => [
      enterpriseCollectionIdentity(child),
      Boolean(child.disabled),
      Boolean(child.geminiEnterprise?.effectiveDisabled),
    ]),
  ]);
}

export function carbonApplicationBatches(files: AuthFileItem[], size = 5): AuthFileItem[][] {
  const unique = [
    ...new Map(files.map((file) => [file.geminiEnterprise?.bindingId, file])).values(),
  ];
  const limit = Math.min(5, Math.max(1, Math.floor(size) || 5));
  return Array.from({ length: Math.ceil(unique.length / limit) }, (_, index) =>
    unique.slice(index * limit, (index + 1) * limit)
  );
}

// A started application is never replayed, including after an uncertain response.
export async function runCarbonApplicationTests<T>(
  files: AuthFileItem[],
  signal: AbortSignal,
  execute: (file: AuthFileItem) => Promise<T>,
  started: (file: AuthFileItem) => void,
  completed: (file: AuthFileItem, result: T) => void,
  stopAfter: (result: T) => boolean = () => false
): Promise<void> {
  let cursor = 0;
  let stopped = false;
  const targets = carbonApplicationBatches(files).flat();
  const worker = async () => {
    while (!signal.aborted && !stopped && cursor < targets.length) {
      const file = targets[cursor++];
      started(file);
      const result = await execute(file);
      if (signal.aborted) return;
      completed(file, result);
      stopped ||= stopAfter(result);
    }
  };
  await Promise.all([worker(), worker()]);
}

export function googleCarbonReasonKey(reason?: string): string {
  const reasons: Record<string, string[]> = {
    assistant_defaults_preserved: ['assistant_defaults_preserved'],
    allowed_models_review_required: ['allowed_models_review_required'],
    permission_denied: ['permission_denied', 'iam_permission_denied', 'google_permission_denied'],
    application_changed: [
      'credential_changed',
      'application_changed',
      'authorization_changed',
      'snapshot_changed',
      'binding_changed',
      'revision_changed',
      'snapshot_expired',
      'google_configuration_changed',
    ],
    unsupported: ['unsupported', 'configure_google_unsupported'],
    read_failed: [
      'read_failed',
      'engine_read_failed',
      'assistant_read_failed',
      'google_resource_not_found',
      'google_response_invalid',
    ],
    write_failed: [
      'write_failed',
      'engine_write_failed',
      'assistant_write_failed',
      'verification_failed',
      'write_not_confirmed',
      'google_request_rejected',
    ],
    authorization_required: ['google_authorization_required'],
    busy: ['operation_in_progress', 'configure_busy', 'google_rate_limited', 'google_unavailable'],
    unknown: ['request_failed', 'outcome_unknown', 'write_result_unknown', 'cancelled'],
  };
  return (
    'gemini_enterprise.carbon_batch.reason_' +
    (Object.entries(reasons).find(([, values]) => values.includes(reason ?? ''))?.[0] ?? 'other')
  );
}
