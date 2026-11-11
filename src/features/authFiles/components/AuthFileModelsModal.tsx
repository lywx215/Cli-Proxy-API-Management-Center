import { EnterpriseCatalogStatus } from './EnterpriseCatalogFields';
import { EnterpriseModelPolicyStatus } from './EnterpriseModelPolicyFields';
import { EnterpriseCarbonAdmission } from './EnterpriseCarbonAdmission';
import {
  enterpriseCarbonAdmission,
  ENTERPRISE_CARBON_MODEL,
  isEnterpriseCarbonModel,
} from '../enterpriseCarbon';
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
import { enterpriseForcesArgon } from '../enterpriseModelPolicy';
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
  testCandidates?: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  onClose: () => void;
  onCopyText: (text: string) => void;
  testsEnabled?: boolean;
  testResults?: Record<string, ModelTestState>;
  testBusy?: boolean;
  testUnsupported?: boolean;
  testProgress?: { completed: number; total: number };
  onTestModels?: (models: string[]) => void;
  onVerifyCarbon?: () => void;
  carbonVerificationTest?: ModelTestState;
  onCancelTests?: () => void;
  controlsDisabled?: boolean;
  carbonSaving?: boolean;
  carbonError?: string | null;
  onCarbonChange?: (enabled: boolean) => void;
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
    testCandidates = [],
    excluded,
    onClose,
    onCopyText,
    testsEnabled = false,
    testResults = {},
    testBusy = false,
    testUnsupported = false,
    testProgress = { completed: 0, total: 0 },
    onTestModels,
    onVerifyCarbon,
    carbonVerificationTest,
    onCancelTests,
    controlsDisabled = false,
    carbonSaving = false,
    carbonError,
    onCarbonChange,
  } = props;
  const now = useSyncExternalStore(
    open ? cooldownClock.subscribe : noSubscribe,
    cooldownClock.getSnapshot,
    cooldownClock.getSnapshot
  );
  const isWeb = fileType === 'gemini-enterprise-web';
  const isOAuth = fileType === 'gemini-enterprise';
  const isAntigravityEnterprise = fileType === 'antigravity-enterprise';
  const showTests = fileType === 'gemini-enterprise' || isAntigravityEnterprise || isWeb;
  const isExcluded = (model: AuthFileModelItem) => {
    const upstreamModel = model.upstream_model || model.id;
    const forced =
      isOAuth && enterpriseForcesArgon(file?.geminiEnterprise?.modelPolicyState, upstreamModel);
    return (
      model.policy_allowed === false ||
      (!forced && isModelExcluded(upstreamModel, fileType, excluded)) ||
      Boolean(file && isEnterpriseModelExcluded(file, upstreamModel))
    );
  };
  const cooling = (id: string, test = testResults[id]) =>
    file
      ? enterpriseModelCooldown(file, id, test, now)
      : Math.max(0, Math.ceil(((test?.cooldownUntilMs ?? 0) - now) / 1000));
  const carbonCooldown = Math.max(
    cooling(ENTERPRISE_CARBON_MODEL),
    cooling(ENTERPRISE_CARBON_MODEL, carbonVerificationTest)
  );
  const modelCooldown = (model: AuthFileModelItem) =>
    Math.max(cooling(model.id), isOAuth && isEnterpriseCarbonModel(model) ? carbonCooldown : 0);
  const carbonAvailable = enterpriseCarbonAdmission(file)?.available === true;
  const displayedModels = models.filter(
    (model) => !isOAuth || !isEnterpriseCarbonModel(model) || carbonAvailable
  );
  const testableModels = displayedModels.filter(
    (model) => isEnterpriseTextModel(model) && !isExcluded(model) && !modelCooldown(model)
  );
  const testableIds = testableModels.map((model) => model.id);
  const carbonCandidateAvailable = testCandidates.some(
    (model) => model.id === ENTERPRISE_CARBON_MODEL && model.test_candidate === true
  );
  const binding = file?.geminiEnterprise;

  return (
    <Modal
      open={open}
      onClose={onClose}
      onRequestClose={onCancelTests}
      width={showTests ? 780 : 520}
      title={
        t('auth_files.models_title') +
        (showTests ? ' · ' + displayedModels.length : ' - ' + fileName)
      }
      footer={
        <>
          <p className={styles.footerHint}>
            {showTests
              ? t(isWeb ? 'enterprise_web.model_test_hint' : 'auth_files.model_test_hint')
              : null}
          </p>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      {isAntigravityEnterprise && file?.antigravityEnterprise && (
        <section className={styles.context} aria-label={t('antigravity_enterprise.models')}>
          <p>{file.email || fileName}</p>
          <p>
            <strong>{file.antigravityEnterprise.license?.projectId}</strong> ·{' '}
            {file.antigravityEnterprise.license?.location}
          </p>
          <p>{t('antigravity_enterprise.catalog_hint')}</p>
          <small>{t('antigravity_enterprise.pinned_test')}</small>
        </section>
      )}
      {isWeb && (
        <section className={styles.context} aria-label={t('enterprise_web.available_models')}>
          <p>{typeof file?.label === 'string' ? file.label : fileName}</p>
          <p>{t('enterprise_web.catalog_hint')}</p>
          <p>
            {t(
              'enterprise_web.policy_' + (file?.geminiEnterpriseWeb?.modelPolicy ?? 'unclassified')
            )}
          </p>
          {file?.geminiEnterpriseWeb?.modelPolicy === 'unclassified' && (
            <p role="status">{t('enterprise_web.policy_pending_hint')}</p>
          )}
          <a href="#/auth-files/oauth-model-alias?provider=gemini-enterprise-web" onClick={onClose}>
            {t('enterprise_web.manage_aliases')}
          </a>
        </section>
      )}
      {showTests && !isWeb && file && (
        <section className={styles.context} aria-label={t('gemini_enterprise.models.context')}>
          <p>{file.email || fileName}</p>
          <EnterpriseModelPolicyStatus snapshot={binding?.modelPolicyState} />
          <EnterpriseCatalogStatus
            snapshot={binding?.modelPolicyState}
            source={models.find((entry) => entry.catalog_source)?.catalog_source}
          />
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
      {isOAuth && file && !loading && !error && (
        <EnterpriseCarbonAdmission
          file={file}
          disabled={controlsDisabled}
          saving={carbonSaving}
          testBusy={testBusy}
          test={carbonVerificationTest}
          error={carbonError}
          testCandidateAvailable={carbonCandidateAvailable}
          cooldownSeconds={carbonCooldown}
          onTest={onVerifyCarbon}
          onChange={onCarbonChange}
          onCopy={() => onCopyText(ENTERPRISE_CARBON_MODEL)}
        />
      )}
      {showTests && !loading && !error && (displayedModels.length > 0 || testBusy) && (
        <div className={styles.testToolbar}>
          <span>
            {t(isWeb ? 'enterprise_web.available_count' : 'gemini_enterprise.models.text_count', {
              count: displayedModels.filter(isEnterpriseTextModel).length,
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
                disabled={!testsEnabled || testUnsupported || !testableIds.length || carbonSaving}
                onClick={() => onTestModels?.(testableIds)}
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
          {displayedModels.length > 0 && (!testsEnabled || testUnsupported) && (
            <p className="hint">
              {t(
                testUnsupported
                  ? 'auth_files.model_test_unsupported'
                  : isWeb
                    ? 'enterprise_web.model_test_disabled'
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
      ) : displayedModels.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty')}
          description={t(
            isWeb &&
              (!file?.geminiEnterpriseWeb?.modelPolicy ||
                file.geminiEnterpriseWeb.modelPolicy === 'unclassified')
              ? 'enterprise_web.policy_pending_hint'
              : 'auth_files.models_empty_desc'
          )}
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
            {displayedModels.map((model) => {
              const excludedModel = isExcluded(model);
              const textModel = isEnterpriseTextModel(model);
              const test = testResults[model.id];
              const result = test?.result;
              const cooldown = modelCooldown(model);
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
                      {showTests && !isWeb && (
                        <small className={styles.policyBadge}>
                          {t(
                            excludedModel
                              ? model.upstream_listed === false
                                ? 'gemini_enterprise.catalog.blocked'
                                : 'gemini_enterprise.policy.listed_blocked'
                              : 'gemini_enterprise.policy.listed_allowed'
                          )}
                        </small>
                      )}
                      {model.catalog_source && (
                        <small className={styles.policyBadge}>
                          {t('gemini_enterprise.catalog.source_' + model.catalog_source, {
                            defaultValue: model.catalog_source,
                          })}
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
                          carbonSaving ||
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
                      {result?.status === 'ok' && state === 'ok' ? (
                        <div className={styles.testMessage}>
                          <p className={styles.testSuccess} role="status">
                            {t('auth_files.model_test_state_ok')}
                          </p>
                        </div>
                      ) : result && (result.code || result.message) ? (
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
                      ) : null}
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
