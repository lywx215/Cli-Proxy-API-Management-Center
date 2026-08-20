import { useTranslation } from 'react-i18next';
import type { GeminiCliQuotaState } from '@/types';
import { formatQuotaResetTime } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';

export function GeminiCliQuotaBody({ quota, classes }: QuotaBodyProps<GeminiCliQuotaState>) {
  const { t } = useTranslation();
  const buckets = quota.buckets ?? [];
  const isPremiumTier = /(?:pro|ultra)/i.test(quota.tierId ?? '');

  return (
    <>
      {quota.tierLabel ? (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('gemini_cli_quota.tier_label')}</span>
          <span className={isPremiumTier ? classes.premiumPlanValue : classes.codexPlanValue}>
            {quota.tierLabel}
          </span>
        </div>
      ) : null}
      {quota.creditBalance != null ? (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('gemini_cli_quota.credit_label')}</span>
          <span className={classes.codexPlanValue}>
            {t('gemini_cli_quota.credit_amount', { count: quota.creditBalance })}
          </span>
        </div>
      ) : null}
      {buckets.length === 0 ? (
        <div className={classes.quotaMessage}>{t('gemini_cli_quota.empty_buckets')}</div>
      ) : (
        buckets.map((bucket, index) => {
          const fraction = bucket.remainingFraction;
          const percent =
            fraction === null ? null : Math.round(Math.max(0, Math.min(1, fraction)) * 100);
          const modelTitle = bucket.modelIds?.length ? bucket.modelIds.join(', ') : bucket.label;
          return (
            <div key={bucket.id} className={classes.quotaRow}>
              <div className={classes.quotaRowHeader}>
                <span className={classes.quotaModel} title={modelTitle}>
                  {bucket.label}
                </span>
                <div className={classes.quotaMeta}>
                  <span className={classes.quotaPercent}>
                    {percent === null ? '--' : `${percent}%`}
                  </span>
                  {bucket.remainingAmount != null ? (
                    <span className={classes.quotaAmount}>
                      {t('gemini_cli_quota.remaining_amount', {
                        count: bucket.remainingAmount,
                      })}
                    </span>
                  ) : null}
                  <span className={classes.quotaReset}>
                    {formatQuotaResetTime(bucket.resetTime)}
                  </span>
                </div>
              </div>
              <QuotaMeter percent={percent} classes={classes} index={index} />
            </div>
          );
        })
      )}
    </>
  );
}
