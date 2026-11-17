import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { useQuotaStore } from '@/stores/useQuotaStore';
import {
  refreshEnterprisePaidQuota,
  summarizeEnterprisePaidQuota,
  type EnterprisePaidQuotaScope,
} from '../enterpriseQuotaSummary';
import { enterpriseQuotaDay } from '../geminiEnterpriseQuota';
import styles from './GeminiEnterpriseQuotaSummary.module.scss';

export function GeminiEnterpriseQuotaSummary({
  scope,
  disabled,
  overall = false,
}: {
  scope: EnterprisePaidQuotaScope;
  disabled: boolean;
  overall?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const cache = useQuotaStore((store) => store.geminiEnterpriseQuota);
  const cacheGeneration = useQuotaStore((store) => store.cacheGeneration);
  const now = useNow(scope.pools.size > 0);
  const day = enterpriseQuotaDay(now);
  const summary = summarizeEnterprisePaidQuota(scope, cache, now);
  const [refreshing, setRefreshing] = useState(false);
  const hasPools = scope.pools.size > 0;

  useEffect(() => {
    if (overall && !disabled && hasPools) {
      void refreshEnterprisePaidQuota(scope.pools, false);
    }
  }, [scope, overall, disabled, hasPools, day, cacheGeneration]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshEnterprisePaidQuota(scope.pools, true);
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
              t('gemini_enterprise.quota.not_provided')}
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
