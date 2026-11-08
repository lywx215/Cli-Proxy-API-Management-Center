import type { AuthFileItem, EnterpriseCarbonAdmission } from '@/types';
import type { AuthFileModelItem } from './constants';
import { enterpriseResources, validEnterpriseResources } from './enterpriseResources';
import { enterpriseCollectionIdentity } from './enterpriseAccounts';

export const ENTERPRISE_CARBON_MODEL = 'gemini-4-carbon';

export function isEnterpriseCarbonModel(
  model: Pick<AuthFileModelItem, 'id' | 'upstream_model'>
): boolean {
  return (model.upstream_model || model.id) === ENTERPRISE_CARBON_MODEL;
}

export function enterpriseCarbonAdmission(
  file: AuthFileItem | null | undefined
): EnterpriseCarbonAdmission | undefined {
  return (
    file?.geminiEnterprise?.carbonAdmission ??
    file?.geminiEnterprise?.modelPolicyState?.carbonAdmission
  );
}

export function enterpriseCarbonSupported(file: AuthFileItem | null | undefined): boolean {
  return (
    file?.geminiEnterprise?.carbonAdmissionSupported === true ||
    file?.geminiEnterprise?.modelPolicyState?.carbonAdmissionSupported === true
  );
}

function hasEnterpriseCarbonTarget(file: AuthFileItem | null | undefined): boolean {
  return Boolean(
    file &&
    (file.type || file.provider) === 'gemini-enterprise' &&
    enterpriseCarbonSupported(file) &&
    !file.disabled &&
    !file.geminiEnterprise?.effectiveDisabled &&
    !file.geminiEnterprise?.collections &&
    file.geminiEnterprise?.bindingId &&
    file.geminiEnterprise.revision !== undefined &&
    String(file.authIndex ?? '').trim() &&
    validEnterpriseResources(enterpriseResources(file.geminiEnterprise))
  );
}

export function canTestEnterpriseCarbon(file: AuthFileItem | null | undefined): boolean {
  return hasEnterpriseCarbonTarget(file) && enterpriseCarbonAdmission(file)?.canTest === true;
}

export function canEnableEnterpriseCarbon(file: AuthFileItem | null | undefined): boolean {
  const admission = enterpriseCarbonAdmission(file);
  return Boolean(
    hasEnterpriseCarbonTarget(file) &&
    admission?.canEnable &&
    (admission.verificationRequired === false ||
      (admission.test?.status === 'verified' &&
        admission.test.testId &&
        admission.test.upstreamModel === ENTERPRISE_CARBON_MODEL &&
        admission.test.httpStatus === 200 &&
        Number.isFinite(Date.parse(admission.test.checkedAt))))
  );
}

export function enterpriseCarbonEvidenceStatus(admission?: EnterpriseCarbonAdmission): string {
  const status = admission?.test?.status ?? 'not_tested';
  const reason = enterpriseCarbonReasonKey(admission?.reason);
  if (
    admission?.verificationRequired !== false &&
    status === 'verified' &&
    !admission?.canEnable &&
    (admission?.canTest ||
      ['stale', 'binding_changed', 'configuration_changed'].some((key) =>
        reason.endsWith('reason_' + key)
      ))
  )
    return 'stale';
  return ['verified', 'not_tested', 'failed', 'incomplete', 'needs_review', 'stale'].includes(
    status
  )
    ? status
    : 'incomplete';
}

export function enterpriseCarbonSummary(files: AuthFileItem[]): {
  enabled: number;
  available: number;
  supported: boolean;
} {
  return files.reduce<{ enabled: number; available: number; supported: boolean }>(
    (summary, file) => ({
      enabled: summary.enabled + Number(enterpriseCarbonAdmission(file)?.enabled === true),
      available: summary.available + Number(enterpriseCarbonAdmission(file)?.available === true),
      supported: summary.supported || enterpriseCarbonSupported(file),
    }),
    { enabled: 0, available: 0, supported: false }
  );
}

export function enterpriseCarbonReasonKey(reason?: string): string {
  const groups: Record<string, string[]> = {
    disabled: ['disabled', 'carbon_disabled', 'manual_disabled', 'not_enabled'],
    test_required: [
      'test_required',
      'carbon_test_required',
      'carbon_verification_required',
      'carbon_evidence_missing',
      'evidence_missing',
    ],
    stale: [
      'stale',
      'carbon_test_stale',
      'carbon_evidence_stale',
      'carbon_evidence_invalid',
      'evidence_invalid',
      'evidence_stale',
    ],
    binding_changed: [
      'binding_changed',
      'carbon_binding_changed',
      'authorization_changed',
      'carbon_authorization_changed',
      'credential_changed',
      'invalid_application_binding',
    ],
    configuration_changed: ['configuration_changed', 'carbon_configuration_changed'],
    subscription_unverified: [
      'subscription_unverified',
      'subscription_unavailable',
      'subscription_cache_expired',
    ],
    authorization_unverified: ['authorization_unverified', 'credential_unavailable'],
    invalid_settings: [
      'invalid_settings',
      'invalid_carbon_settings',
      'invalid_model_policy',
      'invalid_request',
    ],
    test_failed: ['test_failed', 'generation_failed', 'upstream_unavailable'],
    paid_required: ['paid_subscription_required', 'carbon_paid_subscription_required'],
    policy_denied: ['model_not_allowed', 'model_excluded', 'carbon_policy_denied'],
    credential_disabled: ['credential_disabled', 'collection_disabled'],
    needs_review: [
      'needs_review',
      'carbon_needs_review',
      'carbon_evidence_pending_review',
      'model_not_enabled',
      'permission_denied',
    ],
    incomplete: [
      'incomplete',
      'test_incomplete',
      'carbon_test_incomplete',
      'verification_incomplete',
      'model_verification_incomplete',
      'model_verification_mismatch',
      'model_verification_unavailable',
      'model_changed',
      'upstream_skipped',
    ],
    cooling: [
      'model_cooling',
      'model_cooldown',
      'cooling',
      'rate_limited',
      'model_not_enabled_cooldown',
    ],
  };
  return (
    'gemini_enterprise.carbon.reason_' +
    (Object.entries(groups).find(([, values]) => values.includes(reason ?? ''))?.[0] ?? 'other')
  );
}

export function enterpriseCarbonTargetIdentity(file: AuthFileItem): string {
  return JSON.stringify([
    enterpriseCollectionIdentity(file),
    file.geminiEnterprise?.carbonAuthorizationRevision,
    file.geminiEnterprise?.carbonRegistrationEpoch,
    Boolean(file.disabled),
    Boolean(file.geminiEnterprise?.effectiveDisabled),
  ]);
}

export function sameEnterpriseNonCarbonState(a: AuthFileItem, b: AuthFileItem): boolean {
  const state = (file: AuthFileItem) => {
    const policy = file.geminiEnterprise?.modelPolicyState;
    return JSON.stringify([
      enterpriseCarbonTargetIdentity(file),
      policy && {
        ...policy,
        carbonAdmission: undefined,
        carbonAdmissionSupported: undefined,
        catalogModels: policy.catalogModels.filter((model) => model.id !== ENTERPRISE_CARBON_MODEL),
        effectiveModels: policy.effectiveModels.filter((id) => id !== ENTERPRISE_CARBON_MODEL),
      },
    ]);
  };
  return state(a) === state(b);
}
