import { useTranslation } from 'react-i18next';
import type { GeminiEnterpriseAccount } from '@/types/authFile';
import { enterpriseDiscoveryGroups } from '../enterpriseCatalog';

export function EnterpriseDiscoveryStatus({ account }: { account?: GeminiEnterpriseAccount }) {
  const { t } = useTranslation();
  const discovery = account?.discovery;
  if (
    !discovery ||
    (!discovery.warnings.length && discovery.status !== 'failed' && discovery.status !== 'partial')
  )
    return null;
  const groups = enterpriseDiscoveryGroups(account);
  return (
    <section
      style={{ padding: '10px 12px', fontSize: 12 }}
      aria-label={t('gemini_enterprise.discovery.label')}
    >
      <p role="status">{t('gemini_enterprise.collections.discovery_partial')}</p>
      <details>
        <summary>{t('gemini_enterprise.discovery.details')}</summary>
        {groups.map((group) => (
          <div key={group.project || 'account'} style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
            <strong>
              {group.name ? group.name + ' · ' : ''}
              {group.project || t('gemini_enterprise.discovery.account')}
            </strong>
            {!group.errors.length && <span> · {t('gemini_enterprise.discovery.ok')}</span>}
            {group.errors.map((error) => (
              <div key={[error.code, error.service, error.consumerProject].join('/')}>
                {t('gemini_enterprise.discovery.error_' + error.code, {
                  defaultValue: t('gemini_enterprise.discovery.error_discovery_failed'),
                })}
                {error.regions.length > 0 && <span> · {error.regions.join(', ')}</span>}
                {error.service && <div>{error.service}</div>}
                {error.consumerProject && (
                  <div>
                    {t('gemini_enterprise.discovery.consumer')}: {error.consumerProject}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </details>
    </section>
  );
}
