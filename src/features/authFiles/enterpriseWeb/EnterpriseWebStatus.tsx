import { useTranslation } from 'react-i18next';
import type { EnterpriseWebStatus as Status } from '@/services/api/geminiEnterpriseWeb';

export function EnterpriseWebStatus({
  status,
  unsupported = false,
  error = false,
}: {
  status: Status | null;
  unsupported?: boolean;
  error?: boolean;
}) {
  const { t } = useTranslation();
  const limits = status?.inputLimits;
  const contents = limits?.['max-contents'];
  const segments = limits?.['max-segments'];
  return (
    <div role="status" aria-live="polite">
      <p>
        {t('enterprise_web.actual_state')}:{' '}
        {t(
          `enterprise_web.${
            unsupported
              ? 'unsupported'
              : !status || error
                ? 'unknown'
                : status.enabled
                  ? 'on'
                  : 'off'
          }`
        )}
      </p>
      {status && !error && (
        <p>
          {t('enterprise_web.runtime', {
            active: status.activeRequests,
            used: (status.inflightBytes / 1048576).toFixed(1),
            limit: (status.maxInflightBytes / 1048576).toFixed(0),
            rejected: status.rejectedConcurrency + status.rejectedMemory,
          })}
          {status.draining ? ` · ${t('enterprise_web.draining')}` : ''}
        </p>
      )}
      {status && !error && status.historyMode && (
        <p>
          {t('enterprise_web.history_actual')}:{' '}
          {t(
            status.historyMode === 'serialized-context'
              ? 'enterprise_web.history_serialized'
              : 'enterprise_web.history_single'
          )}
        </p>
      )}
      {status?.mediaFallbackRequests && !error && (
        <p>{t('enterprise_web.media_fallback_counts', status.mediaFallbackRequests)}</p>
      )}
      {status && !error && status.cookieCCPollingEnabled !== undefined && (
        <p>
          {t('enterprise_web.cc_polling_actual', {
            status: t(
              !status.cookieCCPollingEnabled
                ? 'enterprise_web.off'
                : status.enabled
                  ? 'enterprise_web.on'
                  : 'enterprise_web.cc_polling_channel_off'
            ),
          })}
        </p>
      )}
      {status && !error && status.supportedHistoryModes?.includes('serialized-context') && (
        <>
          <p>
            {status.historyCountPolicy === 'unlimited'
              ? t('enterprise_web.history_count_unlimited')
              : contents !== undefined && segments !== undefined
                ? t('enterprise_web.history_count_legacy', { contents, segments })
                : t('enterprise_web.history_count_unknown')}
          </p>
          <p>
            {t(
              status.supportsModelHistoryInlineData === true
                ? 'enterprise_web.model_history_attachments'
                : 'enterprise_web.model_history_attachments_unknown'
            )}
          </p>
        </>
      )}
      {status &&
        !error &&
        Object.entries(status.preflightRejections ?? {}).some(([, count]) => count > 0) && (
          <p>
            {t('enterprise_web.preflight_rejections')}:{' '}
            {Object.entries(status.preflightRejections ?? {})
              .filter(([, count]) => count > 0)
              .map(
                ([reason, count]) => `${t(`enterprise_web.preflight_reasons.${reason}`)} ${count}`
              )
              .join(' · ')}
          </p>
        )}
    </div>
  );
}
