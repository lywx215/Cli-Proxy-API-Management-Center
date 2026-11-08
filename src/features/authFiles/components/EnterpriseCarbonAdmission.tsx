import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconCheckCircle2 } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import type { ModelTestState } from '../modelTesting';
import { sanitizeModelTestMessage } from '../modelTesting';
import {
  canEnableEnterpriseCarbon,
  canTestEnterpriseCarbon,
  enterpriseCarbonAdmission,
  enterpriseCarbonSupported,
  enterpriseCarbonReasonKey,
  enterpriseCarbonEvidenceStatus,
  ENTERPRISE_CARBON_MODEL,
} from '../enterpriseCarbon';
import {
  enterpriseCarbonAvailabilityPresentation,
  enterpriseCarbonTestPresentation,
} from '../enterpriseCarbonPresentation';
import styles from './AuthFileModelsModal.module.scss';

export function EnterpriseCarbonAdmission({
  file,
  disabled = false,
  saving = false,
  testBusy = false,
  test,
  error,
  onTest,
  onChange,
  onCopy,
  testCandidateAvailable = false,
  cooldownSeconds = 0,
}: {
  file: AuthFileItem;
  disabled?: boolean;
  saving?: boolean;
  testBusy?: boolean;
  testCandidateAvailable?: boolean;
  cooldownSeconds?: number;
  test?: ModelTestState;
  error?: string | null;
  onTest?: () => void;
  onChange?: (enabled: boolean) => void;
  onCopy?: () => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const supported = enterpriseCarbonSupported(file);
  const admission = enterpriseCarbonAdmission(file);
  const evidence = admission?.test;
  const enabled = admission?.enabled === true;
  const running = test?.state === 'running';
  const canTest = testCandidateAvailable && canTestEnterpriseCarbon(file);
  const evidenceKey = enterpriseCarbonEvidenceStatus(admission);
  const availability = enterpriseCarbonAvailabilityPresentation(file);
  const feedback = enterpriseCarbonTestPresentation(file, test);
  const pendingEnable = availability.labelKey === 'gemini_enterprise.carbon.pending_enable';
  return (
    <section
      className={styles.carbon}
      aria-label={t('gemini_enterprise.carbon.label')}
      aria-busy={saving || running}
    >
      <div className={styles.carbonHeading}>
        <strong>{ENTERPRISE_CARBON_MODEL}</strong>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('auth_files.model_test_copy', { model: ENTERPRISE_CARBON_MODEL })}
          onClick={onCopy}
        >
          {t('common.copy')}
        </Button>
        <span className="hint">
          {t('gemini_enterprise.carbon.' + (admission?.available ? 'business_model' : 'candidate'))}
        </span>
      </div>
      <p id={hintId} className="hint">
        {t(
          'gemini_enterprise.carbon.' +
            (admission?.verificationRequired === false ? 'manual_hint' : 'hint')
        )}
      </p>
      {!supported ? (
        <p role="status">{t('gemini_enterprise.carbon.unsupported')}</p>
      ) : (
        <>
          <div className={styles.carbonControls}>
            <ToggleSwitch
              checked={enabled}
              disabled={
                disabled ||
                saving ||
                !onChange ||
                (!enabled && (testBusy || !canEnableEnterpriseCarbon(file)))
              }
              onChange={(value) => onChange?.(value)}
              ariaLabel={t('gemini_enterprise.carbon.toggle')}
              ariaDescribedBy={hintId}
              label={t('gemini_enterprise.carbon.' + (enabled ? 'enabled' : 'disabled'))}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={
                disabled || saving || testBusy || cooldownSeconds > 0 || !canTest || !onTest
              }
              loading={running}
              onClick={onTest}
              aria-label={t('gemini_enterprise.carbon.test_label')}
            >
              {t('gemini_enterprise.carbon.' + (evidence ? 'retest' : 'test'))}
            </Button>
          </div>
          <p
            role="status"
            aria-live="polite"
            className={!saving && availability.tone === 'success' ? styles.testSuccess : undefined}
          >
            {!saving && availability.tone === 'success' && (
              <>
                <IconCheckCircle2 size={14} aria-hidden="true" />{' '}
              </>
            )}
            {saving ? t('gemini_enterprise.carbon.saving') : t(availability.labelKey)}
            {(!pendingEnable || running) && (
              <>
                {' · '}
                {running
                  ? t('auth_files.model_test_state_running')
                  : t('gemini_enterprise.carbon.status_' + evidenceKey)}
              </>
            )}
          </p>
          {cooldownSeconds > 0 && (
            <p className="hint" role="status">
              {t('auth_files.model_test_retry', { seconds: cooldownSeconds })}
            </p>
          )}
          {evidence && (
            <p className="hint">
              {t('gemini_enterprise.carbon.checked_at')}{' '}
              <time dateTime={evidence.checkedAt}>
                {new Date(evidence.checkedAt).toLocaleString()}
              </time>
              {evidence.upstreamModel && (
                <>
                  {' '}
                  · {t('gemini_enterprise.carbon.actual_model')}{' '}
                  <code>{evidence.upstreamModel}</code>
                </>
              )}
            </p>
          )}
          {availability.reasonKey && <p className="hint">{t(availability.reasonKey)}</p>}
          {evidence?.reason && evidence.reason !== admission?.reason && (
            <p className="hint">
              {admission?.verificationRequired === false
                ? t('gemini_enterprise.carbon.diagnostic_detail', {
                    reason: t(enterpriseCarbonReasonKey(evidence.reason)),
                  })
                : t(enterpriseCarbonReasonKey(evidence.reason))}
            </p>
          )}
          {!enabled &&
            admission?.verificationRequired !== false &&
            !canEnableEnterpriseCarbon(file) && (
              <p className="hint">{t('gemini_enterprise.carbon.enable_requires_test')}</p>
            )}
          {error && (
            <p className={styles.testFailure} role="alert">
              {sanitizeModelTestMessage(error)}
            </p>
          )}
          {feedback && (
            <p
              className={
                feedback.tone === 'success'
                  ? styles.testSuccess
                  : feedback.tone === 'failure'
                    ? styles.testFailure
                    : 'hint'
              }
              role="status"
              aria-live="polite"
            >
              {feedback.tone === 'success' && (
                <>
                  <IconCheckCircle2 size={14} aria-hidden="true" />{' '}
                </>
              )}
              {t(feedback.labelKey)}
              {feedback.reasonKey && <> · {t(feedback.reasonKey)}</>}
              {feedback.detail && <> · {feedback.detail}</>}
            </p>
          )}
        </>
      )}
    </section>
  );
}
