import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { parseTimestamp } from '@/utils/timestamp';
import styles from './GeminiEnterpriseBinding.module.scss';

export function GeminiEnterpriseReauthorizeLink({
  file,
  clientId,
}: {
  file: Pick<AuthFileItem, 'name' | 'authIndex'>;
  clientId?: string;
}) {
  const { t } = useTranslation();
  const authIndex = String(file.authIndex ?? '').trim();
  if (!file.name || !authIndex) return null;
  const query = new URLSearchParams({
    reauthorize_name: file.name,
    reauthorize_auth_index: authIndex,
    reauthorize_client_id: clientId ?? '',
  });
  return <a href={'#/oauth?' + query}>{t('gemini_enterprise.reauthorize')}</a>;
}

export function GeminiEnterpriseBinding({
  binding,
  file,
}: {
  binding: AuthFileItem['geminiEnterprise'];
  file?: Pick<AuthFileItem, 'name' | 'authIndex'>;
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
          {file && (
            <>
              {' '}
              <GeminiEnterpriseReauthorizeLink file={file} clientId={binding.clientId} />
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
