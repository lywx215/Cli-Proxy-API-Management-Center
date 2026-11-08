import { useTranslation } from 'react-i18next';
import { formatDateTimeValue } from '@/utils/format';
import {
  isClassifiedWebPolicy,
  type EnterpriseWebSummary,
} from '@/services/api/geminiEnterpriseWeb';

export function EnterpriseWebCredentialStatus({
  summary,
  compact = false,
}: {
  summary?: EnterpriseWebSummary;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const checkStatus = summary?.cookieCheckStatus;
  const reloginRequired = checkStatus === 'relogin_required';
  const checkFailed = checkStatus === 'check_failed';
  const degraded = checkStatus === 'renewal_degraded';
  const times = [
    ['cookie_checked_at', summary?.cookieCheckedAt],
    ['cookie_last_verified_at', summary?.cookieLastVerifiedAt],
    ['cookie_last_renewed_at', summary?.cookieLastRenewedAt],
    ['cookie_next_check_at', summary?.cookieNextCheckAt],
  ] as const;
  return (
    <>
      <p>{t('enterprise_web.policy_' + (summary?.modelPolicy ?? 'unclassified'))}</p>
      {reloginRequired && (
        <p role="alert">
          <strong>{t('enterprise_web.cookie_relogin_required')}</strong>
        </p>
      )}
      {degraded && <p>{t('enterprise_web.cookie_renewal_degraded')}</p>}
      {checkFailed && (
        <p>
          {t(
            summary?.cookieCheckReason === 'access_denied'
              ? 'enterprise_web.cookie_reason_access_denied'
              : summary?.cookieCheckReason === 'rate_limited'
                ? 'enterprise_web.cookie_reason_rate_limited'
                : 'enterprise_web.cookie_check_failed'
          )}
        </p>
      )}
      {!compact && (
        <>
          {degraded && summary?.cookieCheckReason && (
            <p>{t('enterprise_web.cookie_reason_' + summary.cookieCheckReason)}</p>
          )}
          {times.map(([label, time]) =>
            time ? (
              <p key={label}>
                {t('enterprise_web.' + label, { time: formatDateTimeValue(time, i18n.language) })}
              </p>
            ) : null
          )}
          {!reloginRequired && !checkFailed && !degraded && (
            <p>
              {t(
                checkStatus === 'verified' || summary?.authVerified
                  ? 'enterprise_web.auth_verified'
                  : 'enterprise_web.auth_unverified'
              )}
            </p>
          )}
          <p>
            {summary?.availableModels.length
              ? t('enterprise_web.policy_model_counts', {
                  catalog: summary.availableModels.length,
                  count: summary.effectiveModelIds?.length ?? 0,
                })
              : t('enterprise_web.catalog_empty')}
          </p>
          {!isClassifiedWebPolicy(summary?.modelPolicy) && (
            <p>{t('enterprise_web.policy_pending_hint')}</p>
          )}
          <p>{t('enterprise_web.credential_hint')}</p>
        </>
      )}
    </>
  );
}
