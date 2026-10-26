import { EnterpriseModelPolicyStatus } from './EnterpriseModelPolicyFields';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconCopy } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { isModelExcluded } from '@/features/authFiles/constants';
import { createSharedClock } from '@/utils/time/sharedClock';
import { enterpriseCollectionName } from '../enterpriseAccounts';
import {
  enterpriseModelCooldown,
  isEnterpriseModelExcluded,
  isEnterpriseTextModel,
  sanitizeModelTestMessage,
  type ModelTestState,
} from '../modelTesting';
import styles from './AuthFileModelsModal.module.scss';

const cooldownClock = createSharedClock({ intervalMs: 1000 });
const noSubscribe = () => () => {};

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  fileType: string;
  file?: AuthFileItem | null;
  loading: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  onClose: () => void;
  onCopyText: (text: string) => void;
  testsEnabled?: boolean;
  testResults?: Record<string, ModelTestState>;
  testBusy?: boolean;
  testUnsupported?: boolean;
  testProgress?: { completed: number; total: number };
  onTestModels?: (models: string[]) => void;
  onCancelTests?: () => void;
};

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const {
    open,
    fileName,
    fileType,
    file,
    loading,
    error,
    models,
    excluded,
    onClose,
    onCopyText,
    testsEnabled = false,
    testResults = {},
    testBusy = false,
    testUnsupported = false,
    testProgress = { completed: 0, total: 0 },
    onTestModels,
    onCancelTests,
  } = props;
  const now = useSyncExternalStore(
    open ? cooldownClock.subscribe : noSubscribe,
    cooldownClock.getSnapshot,
    cooldownClock.getSnapshot
  );
  const showTests = fileType === 'gemini-enterprise';
  const isExcluded = (model: AuthFileModelItem) => {
    const upstreamModel = model.upstream_model || model.id;
    return (
      model.policy_allowed === false ||
      isModelExcluded(upstreamModel, fileType, excluded) ||
      Boolean(file && isEnterpriseModelExcluded(file, upstreamModel))
    );
  };
  const cooling = (id: string) =>
    file
      ? enterpriseModelCooldown(file, id, testResults[id], now)
      : Math.max(0, Math.ceil(((testResults[id]?.cooldownUntilMs ?? 0) - now) / 1000));
  const testableModels = models.filter(
    (model) => isEnterpriseTextModel(model) && !isExcluded(model) && !cooling(model.id)
  );
  const binding = file?.geminiEnterprise;

  return (
    <Modal
      open={open}
      onClose={onClose}
      onRequestClose={onCancelTests}
      width={showTests ? 780 : 520}
      title={t('auth_files.models_title') + (showTests ? ' · ' + models.length : ' - ' + fileName)}
      footer={
        <>
          <p className={styles.footerHint}>{showTests ? t('auth_files.model_test_hint') : null}</p>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      {showTests && file && (
        <section className={styles.context} aria-label={t('gemini_enterprise.models.context')}>
          <p>{file.email || fileName}</p>
          <EnterpriseModelPolicyStatus snapshot={binding?.modelPolicyState} />
          <div>
            <strong>{enterpriseCollectionName(file)}</strong>
            <span className={styles.region}>{binding?.location}</span>
            <small>{t('gemini_enterprise.models.pinned')}</small>
          </div>
          <p>
            <span>{t('gemini_enterprise.fields.engineId')}</span> <code>{binding?.engineId}</code>
          </p>
        </section>
      )}
      {showTests && !loading && !error && models.length > 0 && (
        <div className={styles.testToolbar}>
          <span>
            {t('gemini_enterprise.models.text_count', {
              count: models.filter(isEnterpriseTextModel).length,
            })}
          </span>
          <div className={styles.testActions}>
            {testBusy ? (
              <Button size="sm" variant="secondary" onClick={onCancelTests}>
                {t('auth_files.model_test_cancel')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={!testsEnabled || testUnsupported || !testableModels.length}
                onClick={() => onTestModels?.(testableModels.map((model) => model.id))}
              >
                {t('auth_files.model_test_all')}
              </Button>
            )}
            {testProgress.total > 0 && (
              <span className="hint" aria-live="polite">
                {t('auth_files.model_test_progress', testProgress)}
              </span>
            )}
          </div>
          {(!testsEnabled || testUnsupported) && (
            <p className="hint">
              {t(
                testUnsupported
                  ? 'auth_files.model_test_unsupported'
                  : 'auth_files.model_test_disabled'
              )}
            </p>
          )}
        </div>
      )}
      {loading ? (
        <div className="hint" role="status">
          {t('auth_files.models_loading')}
        </div>
      ) : error === 'unsupported' ? (
        <EmptyState
          title={t('auth_files.models_unsupported')}
          description={t('auth_files.models_unsupported_desc')}
        />
      ) : models.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty')}
          description={t('auth_files.models_empty_desc')}
        />
      ) : (
        <>
          {showTests && (
            <div className={styles.columns} aria-hidden="true">
              {['model', 'state', 'duration', 'action'].map((column) => (
                <span key={column}>{t('gemini_enterprise.models.' + column)}</span>
              ))}
            </div>
          )}
          <div className={styles.list}>
            {models.map((model) => {
              const excludedModel = isExcluded(model);
              const textModel = isEnterpriseTextModel(model);
              const test = testResults[model.id];
              const result = test?.result;
              const cooldown = cooling(model.id);
              const state =
                test?.state === 'running' ? 'running' : cooldown ? 'cooling' : test?.state;
              return (
                <div
                  key={model.id}
                  className={
                    styles.item +
                    (showTests ? ' ' + styles.testItem : '') +
                    (excludedModel ? ' ' + styles.itemExcluded : '')
                  }
                >
                  <button
                    type="button"
                    className={styles.copyModel}
                    onClick={() => onCopyText(model.id)}
                    aria-label={t('auth_files.model_test_copy', { model: model.id })}
                    title={t('common.copy')}
                  >
                    <span className={styles.modelName}>{model.display_name || model.id}</span>
                    <span className={styles.modelId}>
                      {model.id}
                      {model.upstream_model && model.upstream_model !== model.id && (
                        <small className={styles.policyBadge}>{model.upstream_model}</small>
                      )}
                      {showTests && (
                        <small className={styles.policyBadge}>
                          {t(
                            excludedModel
                              ? 'gemini_enterprise.policy.listed_blocked'
                              : 'gemini_enterprise.policy.listed_allowed'
                          )}
                        </small>
                      )}
                      <IconCopy size={12} />
                    </span>
                  </button>
                  {showTests && (
                    <>
                      <span
                        className={
                          state === 'ok'
                            ? styles.testSuccess
                            : state === 'failed' || state === 'unavailable'
                              ? styles.testFailure
                              : styles.state
                        }
                        role="status"
                      >
                        {excludedModel
                          ? t('auth_files.models_excluded_badge')
                          : !textModel
                            ? t('auth_files.model_test_text_only')
                            : state
                              ? t('auth_files.model_test_state_' + state)
                              : t('gemini_enterprise.models.untested')}
                        {cooldown > 0 && (
                          <small>{t('auth_files.model_test_retry', { seconds: cooldown })}</small>
                        )}
                      </span>
                      <span
                        className={styles.elapsed}
                        title={
                          result
                            ? 'HTTP ' +
                              result.httpStatus +
                              ' · ' +
                              new Date(result.checkedAt).toLocaleString()
                            : undefined
                        }
                      >
                        {state === 'running' || !result
                          ? '—'
                          : t('auth_files.model_test_duration', {
                              seconds: (result.elapsedMs / 1000).toFixed(2),
                            })}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          !testsEnabled ||
                          testUnsupported ||
                          testBusy ||
                          excludedModel ||
                          !textModel ||
                          cooldown > 0
                        }
                        aria-label={t('auth_files.model_test_one_label', { model: model.id })}
                        onClick={() => onTestModels?.([model.id])}
                      >
                        {result
                          ? t('gemini_enterprise.models.retest')
                          : t('auth_files.model_test_one')}
                      </Button>
                      {result && (result.code || result.message) && (
                        <details className={styles.testMessage}>
                          <summary>
                            {t('gemini_enterprise.models.error_details')}
                            {result.httpStatus > 0 ? ' · HTTP ' + result.httpStatus : ''}
                          </summary>
                          <p>
                            {sanitizeModelTestMessage(
                              [result.code, result.message].filter(Boolean).join(': ')
                            )}
                          </p>
                          <time dateTime={result.checkedAt}>
                            {new Date(result.checkedAt).toLocaleString()}
                          </time>
                        </details>
                      )}
                    </>
                  )}
                  {!showTests && excludedModel && (
                    <span className={styles.excludedBadge}>
                      {t('auth_files.models_excluded_badge')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
