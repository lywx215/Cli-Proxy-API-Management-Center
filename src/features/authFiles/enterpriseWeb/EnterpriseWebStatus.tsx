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
