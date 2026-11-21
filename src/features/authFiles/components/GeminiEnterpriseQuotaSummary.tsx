import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { apiClient } from '@/services/api/client';
import { useQuotaStore } from '@/stores/useQuotaStore';
import {
  refreshEnterprisePaidQuota,
  summarizeEnterprisePaidQuota,
  type EnterprisePaidQuotaScope,
} from '../enterpriseQuotaSummary';
import styles from './GeminiEnterpriseQuotaSummary.module.scss';

export function GeminiEnterpriseQuotaSummary({
  scope,
  disabled,
  overall = false,
  onRefreshComplete,
}: {
  scope: EnterprisePaidQuotaScope;
  disabled: boolean;
  overall?: boolean;
  onRefreshComplete?: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const cache = useQuotaStore((store) => store.geminiEnterpriseQuota);
  const now = useNow(scope.pools.size > 0);
  const summary = summarizeEnterprisePaidQuota(scope, cache, now);
  const [refreshing, setRefreshing] = useState(false);
  const hasPools = scope.pools.size > 0;

  const refresh = async () => {
    const revision = apiClient.getConnectionRevision();
    setRefreshing(true);
    try {
      await refreshEnterprisePaidQuota(scope.pools);
      if (revision === apiClient.getConnectionRevision()) await onRefreshComplete?.();
    } finally {
      setRefreshing(false);
    }
  };
  const label = t(`gemini_enterprise.quota_summary.${overall ? 'overall' : 'credential'}`);
  const busy = refreshing || summary.loading;
  const coverage =
    summary.total > 0
      ? t('gemini_enterprise.quota_summary.coverage', {
          known: summary.known,
          total: summary.total,
        })
      : t('gemini_enterprise.quota_summary.empty');
  return (
    <section
      className={overall ? styles.overall : styles.credential}
      aria-label={label}
      aria-busy={busy}
      data-quota-summary={overall ? 'all' : 'credential'}
    >
      <div className={styles.info}>
        <div className={styles.balance} title={t('gemini_enterprise.quota_summary.calculation')}>
          <span>{label}</span>
          <strong>
            {summary.remaining?.toLocaleString(i18n.resolvedLanguage) ??
              t(
                busy
                  ? 'gemini_enterprise.quota.loading'
                  : hasPools
                    ? 'gemini_enterprise.quota.pending_manual'
                    : 'gemini_enterprise.quota.not_provided'
              )}
          </strong>
        </div>
        <div className={styles.coverage}>
          <span>{coverage}</span>
          {summary.stale > 0 && (
            <span>{t('gemini_enterprise.quota_summary.stale', { count: summary.stale })}</span>
          )}
          {summary.failed > 0 && (
            <span>{t('gemini_enterprise.quota_summary.failed', { count: summary.failed })}</span>
          )}
          {scope.unidentified > 0 && (
            <span>
              {t('gemini_enterprise.quota_summary.unidentified', { count: scope.unidentified })}
            </span>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={disabled || !hasPools || busy}
        onClick={() => void refresh()}
        aria-label={t(`gemini_enterprise.quota_summary.${overall ? 'refresh_all' : 'refresh_one'}`)}
      >
        <IconRefreshCw size={13} aria-hidden />
        {t('gemini_enterprise.quota_summary.refresh')}
      </Button>
    </section>
  );
}
