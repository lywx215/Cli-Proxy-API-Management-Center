import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import type { GeminiEnterpriseQuotaState } from '@/types/geminiEnterpriseQuota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import {
  enterpriseQuotaKey,
  loadGeminiEnterpriseQuota,
  shouldLoadGeminiEnterpriseQuota,
} from '../geminiEnterpriseQuota';
import styles from './GeminiEnterpriseQuota.module.scss';

export function GeminiEnterpriseQuotaBody({ state }: { state?: GeminiEnterpriseQuotaState }) {
  const { t, i18n } = useTranslation();
  const data = state?.data;
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(i18n.resolvedLanguage)
      : t('gemini_enterprise.quota.no_data');
  const amount = (value: number | null) =>
    value === null ? '—' : value.toLocaleString(i18n.resolvedLanguage);
  if (!state || state.loading) {
    return <p className={styles.message}>{t('gemini_enterprise.quota.loading')}</p>;
  }
  if (!data || data.pools.length === 0) {
    return (
      <p className={styles.message}>
        {t(
          `gemini_enterprise.quota.${data?.status === 'ok' ? 'no_data' : (data?.status ?? 'unavailable')}`
        )}
      </p>
    );
  }
  return (
    <>
      {data.pools.map((pool) => {
        const percent =
          pool.limit !== null && pool.limit > 0 && pool.used !== null
            ? Math.min(100, (pool.used / pool.limit) * 100)
            : null;
        const tier =
          pool.tier === 'enterprise_plus'
            ? 'Plus'
            : pool.tier === 'enterprise_standard'
              ? 'Standard'
              : pool.tier.replace(/_/g, ' ');
        return (
          <div className={styles.pool} key={pool.tier}>
            <div className={styles.poolTitle}>
              <span>{t('gemini_enterprise.quota.assistant')}</span>
              <span>{tier}</span>
            </div>
            {pool.status === 'ok' ? (
              <>
                <div className={styles.amounts}>
                  <span>{t('gemini_enterprise.quota.used', { value: amount(pool.used) })}</span>
                  <span>{t('gemini_enterprise.quota.limit', { value: amount(pool.limit) })}</span>
                </div>
                {percent !== null && (
                  <div
                    className={styles.meter}
                    role="progressbar"
                    aria-label={t('gemini_enterprise.quota.assistant')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                )}
                <p className={styles.remaining}>
                  {t('gemini_enterprise.quota.remaining', { value: amount(pool.remaining) })}
                </p>
                {pool.used === null && (
                  <p className={styles.message}>{t('gemini_enterprise.quota.no_data')}</p>
                )}
                {pool.usageUpdatedAt && (
                  <p className={styles.message}>
                    {t('gemini_enterprise.quota.reported_at', { value: date(pool.usageUpdatedAt) })}
                  </p>
                )}
              </>
            ) : (
              <p className={styles.message}>{t(`gemini_enterprise.quota.${pool.status}`)}</p>
            )}
          </div>
        );
      })}
      <p className={styles.message}>{t('gemini_enterprise.quota.shared')}</p>
      {data.resetAt && (
        <p className={styles.message}>
          {t('gemini_enterprise.quota.reset', { value: date(data.resetAt) })}
        </p>
      )}
      {data.observedAt && (
        <p className={styles.message}>
          {t('gemini_enterprise.quota.checked_at', { value: date(data.observedAt) })}
        </p>
      )}
    </>
  );
}

export function GeminiEnterpriseQuota({
  file,
  disableControls,
}: {
  file: AuthFileItem;
  disableControls: boolean;
}) {
  const { t } = useTranslation();
  const key = enterpriseQuotaKey(file);
  const state = useQuotaStore((store) => store.geminiEnterpriseQuota[key]);
  const disabled = disableControls || file.disabled === true;
  useEffect(() => {
    if (!disabled && shouldLoadGeminiEnterpriseQuota(state, Date.now())) {
      void loadGeminiEnterpriseQuota(file);
    }
  }, [disabled, file, state]);

  useEffect(() => {
    if (disabled || state?.loading || !state?.data?.resetAt) return;
    const delay = Date.parse(state.data.resetAt) - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(() => void loadGeminiEnterpriseQuota(file), delay + 1000);
    return () => window.clearTimeout(timer);
  }, [disabled, file, state]);

  return (
    <section className={styles.quota} aria-label={t('gemini_enterprise.quota.title')}>
      <div className={styles.header}>
        <strong>{t('gemini_enterprise.quota.title')}</strong>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || state?.loading}
          onClick={() => void loadGeminiEnterpriseQuota(file)}
          title={t('gemini_enterprise.quota.refresh')}
          aria-label={t('gemini_enterprise.quota.refresh')}
        >
          <IconRefreshCw size={13} />
        </Button>
      </div>
      <GeminiEnterpriseQuotaBody
        state={state ?? (disabled ? { loading: false, fetchedAtMs: 0 } : undefined)}
      />
    </section>
  );
}
