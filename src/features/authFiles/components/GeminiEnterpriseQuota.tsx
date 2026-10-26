import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import type { GeminiEnterpriseQuotaState } from '@/types/geminiEnterpriseQuota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { useNow } from '@/hooks/useNow';
import {
  enterpriseQuotaKey,
  loadGeminiEnterpriseQuota,
  shouldLoadGeminiEnterpriseQuota,
  isEnterpriseQuotaCurrent,
} from '../geminiEnterpriseQuota';
import styles from './GeminiEnterpriseQuota.module.scss';

export function GeminiEnterpriseQuotaBody({ state }: { state?: GeminiEnterpriseQuotaState }) {
  const { t, i18n } = useTranslation();
  const data = state?.data;
  const pool = data?.selectedPool;
  const now = useNow(Boolean(data));
  const currentDay = isEnterpriseQuotaCurrent(data, Math.max(now, state?.fetchedAtMs ?? 0));
  const messageStatus =
    pool && !currentDay
      ? 'no_data'
      : pool?.status === 'stale' || data?.status === 'stale'
        ? 'stale'
        : data?.status === 'partial'
          ? 'partial'
          : pool && pool.status !== 'ok'
            ? pool.status
            : data?.status === 'ok'
              ? 'no_data'
              : (data?.status ?? 'unavailable');
  const observation = pool?.usageUpdatedAt || data?.observedAt;
  const amount = (value: number | null | undefined) =>
    value === null || value === undefined
      ? t('gemini_enterprise.quota.not_provided')
      : value.toLocaleString(i18n.resolvedLanguage);
  if (!state || (state.loading && !data)) {
    return (
      <p className={styles.message} role="status">
        {t('gemini_enterprise.quota.loading')}
      </p>
    );
  }
  const remaining = currentDay ? pool?.remaining : null;
  return (
    <>
      <div className={styles.remaining}>
        <span>{t('gemini_enterprise.collections.remaining')}</span>
        <strong
          className={remaining === null || remaining === undefined ? styles.unknown : undefined}
        >
          {amount(remaining)}
        </strong>
      </div>
      <dl className={styles.amounts}>
        <dt>{t('gemini_enterprise.collections.reported_usage')}</dt>
        <dd>{amount(currentDay ? pool?.used : null)}</dd>
        <dt>{t('gemini_enterprise.collections.daily_limit')}</dt>
        <dd>{amount(currentDay ? pool?.limit : null)}</dd>
      </dl>
      {(!pool ||
        pool.status !== 'ok' ||
        !currentDay ||
        data?.status === 'partial' ||
        data?.status === 'stale') && (
        <p className={styles.message}>{t('gemini_enterprise.quota.' + messageStatus)}</p>
      )}
      {observation && (
        <time className={styles.observation} dateTime={observation}>
          {t(
            pool?.usageUpdatedAt
              ? 'gemini_enterprise.quota.reported_at'
              : 'gemini_enterprise.quota.checked_at',
            {
              value: new Date(observation).toLocaleString(i18n.resolvedLanguage),
            }
          )}
        </time>
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
  useEffect(() => {
    if (!disableControls && shouldLoadGeminiEnterpriseQuota(state, Date.now())) {
      void loadGeminiEnterpriseQuota(file);
    }
  }, [disableControls, file, state]);

  useEffect(() => {
    if (disableControls || state?.loading || !state?.data?.resetAt) return;
    const delay = Date.parse(state.data.resetAt) - Date.now();
    if (delay <= 0 || delay > 2_147_000_000) return;
    const timer = window.setTimeout(() => void loadGeminiEnterpriseQuota(file, true), delay + 1000);
    return () => window.clearTimeout(timer);
  }, [disableControls, file, state]);

  return (
    <section
      className={styles.quota}
      aria-label={t('gemini_enterprise.quota.title')}
      aria-busy={state?.loading}
    >
      <div className={styles.header}>
        <span>{t('gemini_enterprise.quota.title')}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={disableControls || state?.loading}
          onClick={() => void loadGeminiEnterpriseQuota(file, true)}
          title={t('gemini_enterprise.quota.refresh')}
          aria-label={t('gemini_enterprise.quota.refresh')}
        >
          <IconRefreshCw size={13} />
        </Button>
      </div>
      <GeminiEnterpriseQuotaBody
        state={state ?? (disableControls ? { loading: false, fetchedAtMs: 0 } : undefined)}
      />
    </section>
  );
}
