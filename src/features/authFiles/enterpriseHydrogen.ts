import type { AuthFileItem, EnterpriseHydrogenAdmission } from '@/types';
import type { AuthFileModelItem } from './constants';
import { enterpriseResources, validEnterpriseResources } from './enterpriseResources';
import { enterpriseCollectionIdentity } from './enterpriseAccounts';

export const ENTERPRISE_HYDROGEN_MODEL = 'gemini-4-hydrogen';

export function isEnterpriseHydrogenModel(
  model: Pick<AuthFileModelItem, 'id' | 'upstream_model'>
): boolean {
  return (model.upstream_model || model.id) === ENTERPRISE_HYDROGEN_MODEL;
}

export function enterpriseHydrogenAdmission(
  file: AuthFileItem | null | undefined
): EnterpriseHydrogenAdmission | undefined {
  return (
    file?.geminiEnterprise?.hydrogenAdmission ??
    file?.geminiEnterprise?.modelPolicyState?.hydrogenAdmission
  );
}

export function enterpriseHydrogenSupported(file: AuthFileItem | null | undefined): boolean {
  return (
    file?.geminiEnterprise?.hydrogenAdmissionSupported === true ||
    file?.geminiEnterprise?.modelPolicyState?.hydrogenAdmissionSupported === true
  );
}

function hasEnterpriseHydrogenTarget(file: AuthFileItem | null | undefined): boolean {
  return Boolean(
    file &&
    (file.type || file.provider) === 'gemini-enterprise' &&
    enterpriseHydrogenSupported(file) &&
    !file.disabled &&
    !file.geminiEnterprise?.effectiveDisabled &&
    !file.geminiEnterprise?.collections &&
    file.geminiEnterprise?.bindingId &&
    file.geminiEnterprise.revision !== undefined &&
    String(file.authIndex ?? '').trim() &&
    validEnterpriseResources(enterpriseResources(file.geminiEnterprise))
  );
}

export function canTestEnterpriseHydrogen(file: AuthFileItem | null | undefined): boolean {
  return hasEnterpriseHydrogenTarget(file) && enterpriseHydrogenAdmission(file)?.canTest === true;
}

export function canEnableEnterpriseHydrogen(file: AuthFileItem | null | undefined): boolean {
  const admission = enterpriseHydrogenAdmission(file);
  return Boolean(
    hasEnterpriseHydrogenTarget(file) &&
    admission?.canEnable &&
    (admission.verificationRequired === false ||
      (admission.test?.status === 'verified' &&
        admission.test.testId &&
        admission.test.upstreamModel === ENTERPRISE_HYDROGEN_MODEL &&
        admission.test.httpStatus === 200 &&
        Number.isFinite(Date.parse(admission.test.checkedAt))))
  );
}

export function enterpriseHydrogenEvidenceStatus(admission?: EnterpriseHydrogenAdmission): string {
  const status = admission?.test?.status ?? 'not_tested';
  const reason = enterpriseHydrogenReasonKey(admission?.reason);
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

export function enterpriseHydrogenSummary(files: AuthFileItem[]): {
  enabled: number;
  available: number;
  supported: boolean;
} {
  return files.reduce<{ enabled: number; available: number; supported: boolean }>(
    (summary, file) => ({
      enabled: summary.enabled + Number(enterpriseHydrogenAdmission(file)?.enabled === true),
      available: summary.available + Number(enterpriseHydrogenAdmission(file)?.available === true),
      supported: summary.supported || enterpriseHydrogenSupported(file),
    }),
    { enabled: 0, available: 0, supported: false }
  );
}

export function enterpriseHydrogenReasonKey(reason?: string): string {
  const groups: Record<string, string[]> = {
    disabled: ['disabled', 'hydrogen_disabled', 'manual_disabled', 'not_enabled'],
    test_required: [
      'test_required',
      'hydrogen_test_required',
      'hydrogen_verification_required',
      'hydrogen_evidence_missing',
      'evidence_missing',
    ],
    stale: [
      'stale',
      'hydrogen_test_stale',
      'hydrogen_evidence_stale',
      'hydrogen_evidence_invalid',
      'evidence_invalid',
      'evidence_stale',
    ],
    binding_changed: [
      'binding_changed',
      'hydrogen_binding_changed',
      'authorization_changed',
      'hydrogen_authorization_changed',
      'credential_changed',
      'invalid_application_binding',
    ],
    configuration_changed: ['configuration_changed', 'hydrogen_configuration_changed'],
    subscription_unverified: [
      'subscription_unverified',
      'subscription_unavailable',
      'subscription_cache_expired',
    ],
    authorization_unverified: ['authorization_unverified', 'credential_unavailable'],
    invalid_settings: [
      'invalid_settings',
      'invalid_hydrogen_settings',
      'invalid_model_policy',
      'invalid_request',
    ],
    test_failed: ['test_failed', 'generation_failed', 'upstream_unavailable'],
    paid_required: ['paid_subscription_required', 'hydrogen_paid_subscription_required'],
    policy_denied: ['model_not_allowed', 'model_excluded', 'hydrogen_policy_denied'],
    credential_disabled: ['credential_disabled', 'collection_disabled'],
    needs_review: [
      'needs_review',
      'hydrogen_needs_review',
      'hydrogen_evidence_pending_review',
      'model_not_enabled',
      'permission_denied',
    ],
    incomplete: [
      'incomplete',
      'test_incomplete',
      'hydrogen_test_incomplete',
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
    'gemini_enterprise.hydrogen.reason_' +
    (Object.entries(groups).find(([, values]) => values.includes(reason ?? ''))?.[0] ?? 'other')
  );
}

export function enterpriseHydrogenTargetIdentity(file: AuthFileItem): string {
  return JSON.stringify([
    enterpriseCollectionIdentity(file),
    file.geminiEnterprise?.hydrogenAuthorizationRevision,
    file.geminiEnterprise?.hydrogenRegistrationEpoch,
    Boolean(file.disabled),
    Boolean(file.geminiEnterprise?.effectiveDisabled),
  ]);
}

export function sameEnterpriseNonHydrogenState(a: AuthFileItem, b: AuthFileItem): boolean {
  const state = (file: AuthFileItem) => {
    const policy = file.geminiEnterprise?.modelPolicyState;
    return JSON.stringify([
      enterpriseHydrogenTargetIdentity(file),
      policy && {
        ...policy,
        hydrogenAdmission: undefined,
        hydrogenAdmissionSupported: undefined,
        catalogModels: policy.catalogModels.filter((model) => model.id !== ENTERPRISE_HYDROGEN_MODEL),
        effectiveModels: policy.effectiveModels.filter((id) => id !== ENTERPRISE_HYDROGEN_MODEL),
      },
    ]);
  };
  return state(a) === state(b);
}
