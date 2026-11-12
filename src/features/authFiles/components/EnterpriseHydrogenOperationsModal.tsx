import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconCheckCircle2 } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import type {
  HydrogenOperationMode,
  HydrogenOperationRow,
} from '../hooks/useEnterpriseHydrogenOperations';
import {
  canEnableEnterpriseHydrogen,
  enterpriseHydrogenAdmission,
  enterpriseHydrogenEvidenceStatus,
  enterpriseHydrogenReasonKey,
} from '../enterpriseHydrogen';
import { enterpriseCollectionName } from '../enterpriseAccounts';
import { googleHydrogenReasonKey } from '../enterpriseHydrogenOperations';
import {
  enterpriseHydrogenAvailabilityPresentation,
  enterpriseHydrogenTestPresentation,
} from '../enterpriseHydrogenPresentation';
import styles from './EnterpriseHydrogenOperationsModal.module.scss';
import modelStyles from './AuthFileModelsModal.module.scss';

export function EnterpriseHydrogenOperationsModal({
  mode,
  rows,
  busy,
  error,
  completed,
  total,
  disabled = false,
  onCancel,
  onClose,
  onShowModels,
  onChange,
}: {
  mode: HydrogenOperationMode | null;
  rows: HydrogenOperationRow[];
  busy: boolean;
  error: boolean;
  completed: number;
  total: number;
  disabled?: boolean;
  onCancel: () => void;
  onClose: () => void;
  onShowModels: (file: AuthFileItem) => void;
  onChange: (file: AuthFileItem, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const saving = rows.some((row) => row.saving);
  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      width={780}
      title={t('gemini_enterprise.hydrogen_batch.' + (mode === 'configure' ? 'configure' : 'test'))}
      footer={
        <>
          {busy && (
            <Button variant="secondary" onClick={onCancel}>
              {t('auth_files.model_test_cancel')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <p id={hintId} className="hint">
        {t(
          'gemini_enterprise.hydrogen_batch.' +
            (mode === 'configure' ? 'configure_hint' : 'test_hint')
        )}
      </p>
      <p className="hint">{t('gemini_enterprise.hydrogen_batch.cancel_hint')}</p>
      <div role="status" aria-live="polite" className={styles.progress}>
        <progress
          max={Math.max(1, total)}
          value={completed}
          aria-label={t('gemini_enterprise.hydrogen_batch.progress', { completed, total })}
        />
        <span>{t('gemini_enterprise.hydrogen_batch.progress', { completed, total })}</span>
      </div>
      {error && (
        <p role="alert" className={styles.failure}>
          {t('gemini_enterprise.hydrogen_batch.request_failed')}
        </p>
      )}
      <div className={styles.results} aria-busy={busy}>
        {rows.map((row) => {
          const target = row.file;
          const admission = enterpriseHydrogenAdmission(target);
          const evidence = admission?.test;
          const availability = enterpriseHydrogenAvailabilityPresentation(target);
          const testFeedback =
            mode === 'test'
              ? enterpriseHydrogenTestPresentation(
                  target,
                  row.state === 'running' || row.state === 'cancelled'
                    ? { state: row.state, result: row.test }
                    : row.state === 'done' && row.test
                      ? { state: row.test.status, result: row.test }
                      : undefined
                )
              : undefined;
          const staleTest = mode === 'test' && row.state === 'done' && row.test && !testFeedback;
          const feedback = staleTest ? availability : testFeedback;
          const changed =
            row.reason === 'application_changed' || row.configure?.status === 'changed';
          const attempt =
            row.state !== 'done'
              ? row.state
              : mode === 'configure'
                ? (row.configure?.status ?? 'failed')
                : row.test?.status === 'ok'
                  ? 'test_ok'
                  : 'test_failed';
          return (
            <section
              key={target.geminiEnterprise?.bindingId}
              className={styles.row}
              aria-label={enterpriseCollectionName(target)}
            >
              <div className={styles.heading}>
                <strong>{enterpriseCollectionName(target)}</strong>
                <span>{target.geminiEnterprise?.location}</span>
                <code>{target.geminiEnterprise?.engineId}</code>
              </div>
              <p
                role="status"
                aria-live="polite"
                className={
                  feedback?.tone === 'success'
                    ? modelStyles.testSuccess
                    : feedback?.tone === 'failure'
                      ? styles.failure
                      : undefined
                }
              >
                {feedback?.tone === 'success' && (
                  <>
                    <IconCheckCircle2 size={14} aria-hidden="true" />{' '}
                  </>
                )}
                {t(feedback?.labelKey ?? 'gemini_enterprise.hydrogen_batch.status_' + attempt)}
              </p>
              {feedback?.reasonKey ? (
                <p className="hint">{t(feedback.reasonKey)}</p>
              ) : !staleTest &&
                row.reason &&
                row.reason !== 'ok' &&
                (row.state === 'done' || changed || row.reason === 'outcome_unknown') ? (
                <p className="hint">
                  {t(
                    mode === 'configure' || changed || row.reason === 'outcome_unknown'
                      ? googleHydrogenReasonKey(row.reason)
                      : enterpriseHydrogenReasonKey(row.reason)
                  )}
                </p>
              ) : null}
              {feedback?.detail && <p className={styles.failure}>{feedback.detail}</p>}
              {!staleTest && (row.configure?.httpStatus || row.test?.httpStatus) ? (
                <small>HTTP {row.configure?.httpStatus || row.test?.httpStatus}</small>
              ) : null}
              {mode === 'test' && (
                <>
                  <p
                    className={availability.tone === 'success' ? modelStyles.testSuccess : 'hint'}
                    role="status"
                  >
                    {availability.tone === 'success' && (
                      <>
                        <IconCheckCircle2 size={14} aria-hidden="true" />{' '}
                      </>
                    )}
                    {t(availability.labelKey)}
                    {availability.labelKey !== 'gemini_enterprise.hydrogen.pending_enable' && (
                      <>
                        {' · '}
                        {t(
                          'gemini_enterprise.hydrogen.status_' +
                            enterpriseHydrogenEvidenceStatus(admission)
                        )}
                      </>
                    )}
                  </p>
                  {availability.reasonKey && <p className="hint">{t(availability.reasonKey)}</p>}
                  {evidence && (
                    <p className="hint">
                      {t('gemini_enterprise.hydrogen.checked_at')}{' '}
                      <time dateTime={evidence.checkedAt}>
                        {new Date(evidence.checkedAt).toLocaleString()}
                      </time>
                      {evidence.upstreamModel && (
                        <>
                          {' '}
                          · <code>{evidence.upstreamModel}</code>
                        </>
                      )}
                    </p>
                  )}
                  <ToggleSwitch
                    checked={admission?.enabled === true}
                    disabled={
                      disabled ||
                      busy ||
                      saving ||
                      changed ||
                      (!admission?.enabled && !canEnableEnterpriseHydrogen(target))
                    }
                    onChange={(enabled) => onChange(target, enabled)}
                    ariaLabel={
                      t('gemini_enterprise.hydrogen.toggle') + ': ' + enterpriseCollectionName(target)
                    }
                    ariaDescribedBy={hintId}
                    label={t(
                      'gemini_enterprise.hydrogen.' + (admission?.enabled ? 'enabled' : 'disabled')
                    )}
                  />
                  {row.saving && <p role="status">{t('gemini_enterprise.hydrogen.saving')}</p>}
                  {row.saveFailed && (
                    <p role="alert" className={styles.failure}>
                      {t('gemini_enterprise.hydrogen.save_failed')}
                    </p>
                  )}
                </>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || busy || saving || changed}
                onClick={() => onShowModels(target)}
              >
                {t('gemini_enterprise.hydrogen_batch.open_models')}
              </Button>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
