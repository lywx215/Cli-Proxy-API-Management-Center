import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { parseTimestamp } from '@/utils/timestamp';
import styles from './GeminiEnterpriseBinding.module.scss';

export function GeminiEnterpriseBinding({
  binding,
}: {
  binding: AuthFileItem['geminiEnterprise'];
}) {
  const { t, i18n } = useTranslation();
  if (!binding) return null;
  const expiry = parseTimestamp(binding.expiry);
  const fields = [
    'projectId',
    'location',
    'collectionId',
    'engineId',
    'assistantId',
    'clientId',
  ] as const;
  return (
    <div className={styles.binding}>
      <p className={styles.resource}>
        {[binding.projectId, binding.location, binding.engineId].filter(Boolean).join(' / ')}
      </p>
      {binding.hasRefreshToken !== undefined && (
        <p className={styles.renewal}>
          {t(
            binding.hasRefreshToken
              ? 'gemini_enterprise.renewal_ready'
              : 'gemini_enterprise.renewal_missing'
          )}
          {!binding.hasRefreshToken && (
            <>
              {' '}
              <a href="#/oauth">{t('gemini_enterprise.reauthorize')}</a>
            </>
          )}
        </p>
      )}
      <details>
        <summary>{t('gemini_enterprise.binding_details')}</summary>
        <dl>
          {fields.map((field) =>
            binding[field] ? (
              <div key={field}>
                <dt>{t(`gemini_enterprise.fields.${field}`)}</dt>
                <dd>{binding[field]}</dd>
              </div>
            ) : null
          )}
          {expiry && expiry.getTime() > 0 && (
            <div>
              <dt>{t('gemini_enterprise.access_expiry')}</dt>
              <dd>
                <time dateTime={expiry.toISOString()}>
                  {expiry.toLocaleString(i18n.resolvedLanguage)}
                </time>
              </dd>
            </div>
          )}
        </dl>
      </details>
      <p className={styles.hint}>{t('gemini_enterprise.models_hint')}</p>
    </div>
  );
}
