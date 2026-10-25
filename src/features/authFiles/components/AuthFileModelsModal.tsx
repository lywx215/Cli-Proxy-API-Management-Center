import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { isModelExcluded } from '@/features/authFiles/constants';
import { isEnterpriseTextModel, type ModelTestState } from '../modelTesting';
import styles from './AuthFileModelsModal.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  fileType: string;
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
  const { open, fileName, fileType, loading, error, models, excluded, onClose, onCopyText } = props;
  const {
    testsEnabled = false,
    testResults = {},
    testBusy = false,
    testUnsupported = false,
    testProgress = { completed: 0, total: 0 },
    onTestModels,
    onCancelTests,
  } = props;
  const showTests = fileType === 'gemini-enterprise';
  const testableModels = models.filter(
    (model) => isEnterpriseTextModel(model) && !isModelExcluded(model.id, fileType, excluded)
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      onRequestClose={onCancelTests}
      title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${fileName}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {showTests && !loading && !error && models.length > 0 && (
        <div className={styles.testToolbar}>
          <p className="hint">{t('auth_files.model_test_hint')}</p>
          <div className={styles.testActions}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!testsEnabled || testUnsupported || testBusy || testableModels.length === 0}
              onClick={() => onTestModels?.(testableModels.map((model) => model.id))}
            >
              {t('auth_files.model_test_all')}
            </Button>
            {testBusy && (
              <Button size="sm" variant="secondary" onClick={onCancelTests}>
                {t('auth_files.model_test_cancel')}
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
        <div className="hint">
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      ) : error === 'unsupported' ? (
        <EmptyState
          title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          description={t('auth_files.models_unsupported_desc', {
            defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
          })}
        />
      ) : models.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
          description={t('auth_files.models_empty_desc', {
            defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
          })}
        />
      ) : (
        <div className={styles.list}>
          {models.map((model) => {
            const excludedModel = isModelExcluded(model.id, fileType, excluded);
            const textModel = isEnterpriseTextModel(model);
            const test = testResults[model.id];
            const result = test?.result;
            return (
              <div
                key={model.id}
                className={`${styles.item} ${excludedModel ? styles.itemExcluded : ''}`}
              >
                <button
                  type="button"
                  className={styles.copyModel}
                  onClick={() => onCopyText(model.id)}
                  aria-label={t('auth_files.model_test_copy', { model: model.id })}
                  title={
                    excludedModel
                      ? t('auth_files.models_excluded_hint', {
                          defaultValue: '此 OAuth 模型已被禁用',
                        })
                      : t('common.copy', { defaultValue: '点击复制' })
                  }
                >
                  <span className={styles.modelId}>{model.id}</span>
                  {model.display_name && model.display_name !== model.id && (
                    <span className={styles.modelDisplayName}>{model.display_name}</span>
                  )}
                  {model.type && <span className={styles.modelType}>{model.type}</span>}
                </button>
                {excludedModel && (
                  <span className={styles.excludedBadge}>
                    {t('auth_files.models_excluded_badge', { defaultValue: '已禁用' })}
                  </span>
                )}
                {showTests && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      !testsEnabled || testUnsupported || testBusy || excludedModel || !textModel
                    }
                    aria-label={t('auth_files.model_test_one_label', { model: model.id })}
                    title={!textModel ? t('auth_files.model_test_text_only') : undefined}
                    onClick={() => onTestModels?.([model.id])}
                  >
                    {t('auth_files.model_test_one')}
                  </Button>
                )}
                {showTests && test && (
                  <div className={styles.testResult} role="status">
                    <span
                      className={
                        test.state === 'ok'
                          ? styles.testSuccess
                          : test.state === 'failed' || test.state === 'unavailable'
                            ? styles.testFailure
                            : ''
                      }
                    >
                      {t(`auth_files.model_test_state_${test.state}`)}
                    </span>
                    {result && (
                      <>
                        <span>
                          {t('auth_files.model_test_duration', {
                            seconds: (result.elapsedMs / 1000).toFixed(2),
                          })}
                        </span>
                        <time dateTime={result.checkedAt}>
                          {new Date(result.checkedAt).toLocaleTimeString()}
                        </time>
                        {result.httpStatus > 0 && <span>HTTP {result.httpStatus}</span>}
                        {result.retryAfterSeconds !== undefined && (
                          <span>
                            {t('auth_files.model_test_retry', {
                              seconds: Math.ceil(result.retryAfterSeconds),
                            })}
                          </span>
                        )}
                        {(result.code || result.message) && (
                          <span className={styles.testMessage}>
                            {[result.code, result.message].filter(Boolean).join(': ')}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
