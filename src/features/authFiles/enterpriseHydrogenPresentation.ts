import type { AuthFileItem } from '@/types';
import type { ModelTestState } from './modelTesting';
import { sanitizeModelTestMessage } from './modelTesting';
import {
  canEnableEnterpriseHydrogen,
  enterpriseHydrogenAdmission,
  enterpriseHydrogenReasonKey,
} from './enterpriseHydrogen';

export type HydrogenFeedbackTone = 'success' | 'failure' | 'neutral';
export type HydrogenFeedback = {
  tone: HydrogenFeedbackTone;
  labelKey: string;
  reasonKey?: string;
  detail?: string;
};

const manualDisabledReasons = new Set([
  'hydrogen_disabled',
  'manual_disabled',
  'not_enabled',
  'disabled',
]);

export function enterpriseHydrogenAvailabilityPresentation(file: AuthFileItem): HydrogenFeedback {
  const admission = enterpriseHydrogenAdmission(file);
  const eligible = canEnableEnterpriseHydrogen(file);
  const verificationRequired = admission?.verificationRequired !== false;
  const currentProof = eligible && admission?.test?.status === 'verified' && !admission.test.reason;
  const manualDisabled = manualDisabledReasons.has(admission?.reason ?? '');
  const blockingReason = Boolean(admission?.reason && !manualDisabled);
  if (
    eligible &&
    (!verificationRequired || currentProof) &&
    admission?.enabled &&
    admission.available &&
    !blockingReason
  )
    return { tone: 'success', labelKey: 'gemini_enterprise.hydrogen.available' };
  if (currentProof && admission?.enabled === false && !admission.available && manualDisabled)
    return {
      tone: 'success',
      labelKey: 'gemini_enterprise.hydrogen.pending_enable',
      reasonKey: 'gemini_enterprise.hydrogen.pending_enable_hint',
    };
  if (!verificationRequired && eligible && admission?.enabled === false && manualDisabled)
    return { tone: 'neutral', labelKey: 'gemini_enterprise.hydrogen.disabled' };
  return {
    tone: 'neutral',
    labelKey: 'gemini_enterprise.hydrogen.unavailable',
    reasonKey: admission?.reason ? enterpriseHydrogenReasonKey(admission.reason) : undefined,
  };
}

// Presentation never changes admission, test ownership, or switch eligibility.
// A saved historical success is not proof that the current application is ready.
export function enterpriseHydrogenTestPresentation(
  file: AuthFileItem,
  test?: ModelTestState
): HydrogenFeedback | undefined {
  if (!test) return undefined;
  if (test.state === 'running' || test.state === 'cancelled')
    return { tone: 'neutral', labelKey: 'auth_files.model_test_state_' + test.state };
  const result = test.result;
  if (!result)
    return {
      tone: test.state === 'failed' || test.state === 'unavailable' ? 'failure' : 'neutral',
      labelKey: 'auth_files.model_test_state_' + test.state,
    };
  if (
    result.authIndex !== String(file.authIndex ?? '') ||
    (result.bindingId && result.bindingId !== file.geminiEnterprise?.bindingId)
  )
    return undefined;
  const admission = enterpriseHydrogenAdmission(file);
  if (
    result.status !== 'ok' &&
    canEnableEnterpriseHydrogen(file) &&
    Date.parse(admission?.test?.checkedAt ?? '') > Date.parse(result.checkedAt)
  )
    return undefined;
  if (result.status === 'ok') {
    const currentProof =
      canEnableEnterpriseHydrogen(file) &&
      admission?.test?.status === 'verified' &&
      !admission.test.reason;
    const currentReason = admission?.reason;
    const availability = enterpriseHydrogenAvailabilityPresentation(file);
    return currentProof && (!currentReason || manualDisabledReasons.has(currentReason))
      ? {
          tone: 'success',
          labelKey:
            availability.labelKey === 'gemini_enterprise.hydrogen.pending_enable'
              ? 'gemini_enterprise.hydrogen.test_success_pending'
              : 'gemini_enterprise.hydrogen.test_success',
        }
      : availability;
  }
  if (result.status === 'cooling')
    return {
      tone: 'neutral',
      labelKey: 'auth_files.model_test_state_cooling',
      reasonKey: 'gemini_enterprise.hydrogen.reason_cooling',
    };
  if (manualDisabledReasons.has(result.code))
    return {
      tone: 'neutral',
      labelKey: 'gemini_enterprise.hydrogen.disabled',
      reasonKey: 'gemini_enterprise.hydrogen.reason_disabled',
    };
  if (result.code === 'cancelled' || result.code === 'outcome_unknown')
    return { tone: 'neutral', labelKey: 'auth_files.model_test_state_cancelled' };
  const reasonKey = enterpriseHydrogenReasonKey(result.code);
  const knownReason = reasonKey !== 'gemini_enterprise.hydrogen.reason_other';
  return {
    tone: 'failure',
    labelKey: 'auth_files.model_test_state_' + result.status,
    reasonKey: knownReason ? reasonKey : undefined,
    detail: knownReason
      ? undefined
      : sanitizeModelTestMessage([result.code, result.message].filter(Boolean).join(': ')),
  };
}
