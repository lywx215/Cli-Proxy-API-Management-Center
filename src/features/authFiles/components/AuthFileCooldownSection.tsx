import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconChevronDown, IconRefreshCw } from '@/components/ui/icons';
import type { AuthFileCooldown, AuthFileCooldownSnapshot } from '@/types/authFile';
import { createSharedClock } from '@/utils/time/sharedClock';
import { formatDateTimeValue } from '@/utils/format';
import {
  canRetrySharedQuota,
  cooldownReasonKey,
  summarizeCooldowns,
} from '@/features/authFiles/cooldowns';
import styles from './AuthFileCooldownSection.module.scss';

// One timer for visible cooldown cards, never one interval/request per credential.
const clock = createSharedClock({ intervalMs: 1000 });

export type AuthFileCooldownSectionProps = {
  snapshot?: AuthFileCooldownSnapshot;
  resetting?: boolean;
  resetDisabled?: boolean;
  onReset?: (shared?: AuthFileCooldown) => void;
};

export function AuthFileCooldownSection({
  snapshot,
  resetting = false,
  resetDisabled = false,
  onReset,
}: AuthFileCooldownSectionProps) {
  const { t } = useTranslation();
  if (!snapshot) return null; // Old backend: no claim about cooldown support or health.
  if (snapshot.records === null) {
    return <p className={styles.unknown}>{t('auth_files.cooldown_unknown')}</p>;
  }
  if (snapshot.records.length === 0) return null;
  return (
    <CooldownDetails
      snapshot={snapshot}
      resetting={resetting}
      resetDisabled={resetDisabled}
      onReset={onReset}
    />
  );
}

function CooldownDetails({
  snapshot,
  resetting,
  resetDisabled,
  onReset,
}: {
  snapshot: AuthFileCooldownSnapshot;
  resetting: boolean;
  resetDisabled: boolean;
  onReset?: (shared?: AuthFileCooldown) => void;
}) {
  const { t, i18n } = useTranslation();
  const now = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  const { rows, modelCount, credentialWide, earliestSeconds } = summarizeCooldowns(snapshot, now);
  const elapsed = earliestSeconds === 0;
  const sharedRows = rows.filter(({ record }) => record.origin === 'shared_pool');
  const sharedTitle = (record: AuthFileCooldown) =>
    record.restrictionScope === 'user'
      ? 'auth_files.shared_quota_user_title'
      : record.feature === 'technical_requests'
        ? 'auth_files.shared_quota_technical_title'
        : 'auth_files.shared_quota_title';
  const sharedPhase = sharedRows.some(({ record }) => record.phase === 'probing')
    ? 'probing'
    : sharedRows.some(
          ({ record, remainingSeconds }) =>
            record.phase === 'probe_pending' || remainingSeconds === 0
        )
      ? 'probe_pending'
      : 'cooling';
  const duration = (seconds: number) => {
    if (seconds < 60) return t('auth_files.cooldown_seconds', { count: seconds });
    if (seconds < 3600) return t('auth_files.cooldown_minutes', { count: Math.ceil(seconds / 60) });
    return t('auth_files.cooldown_hours', { count: Math.ceil(seconds / 3600) });
  };
  const scopeLabel = credentialWide
    ? modelCount > 0
      ? t('auth_files.cooldown_credential_and_models', { count: modelCount })
      : t('auth_files.cooldown_credential')
    : t('auth_files.cooldown_models', { count: modelCount });

  return (
    <details className={`${styles.section} ${elapsed ? styles.elapsed : ''}`}>
      <summary className={styles.summary}>
        <span className={styles.summaryContent}>
          <span className={styles.scope}>
            {sharedRows.length
              ? t(sharedTitle(sharedRows[0].record))
              : elapsed
                ? t('auth_files.cooldown_elapsed')
                : scopeLabel}
          </span>
          <span className={styles.next}>
            {sharedRows.length && sharedPhase !== 'cooling'
              ? t(`auth_files.shared_quota_${sharedPhase}`)
              : elapsed
                ? t('auth_files.cooldown_refresh_hint')
                : t('auth_files.cooldown_earliest', { time: duration(earliestSeconds) })}
          </span>
        </span>
        <IconChevronDown size={14} className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.body}>
        <ul className={styles.list}>
          {rows.map(({ record, remainingSeconds }, index) => (
            <li className={styles.row} key={`${record.scope}:${record.modelKey ?? ''}:${index}`}>
              <div className={styles.rowHead}>
                <span className={styles.model}>
                  {record.scope === 'credential'
                    ? record.origin === 'shared_pool'
                      ? t('auth_files.shared_quota_all_text')
                      : t('auth_files.cooldown_scope_credential')
                    : record.modelKey}
                </span>
                <span className={styles.remaining}>
                  {remainingSeconds > 0
                    ? duration(remainingSeconds)
                    : record.origin === 'shared_pool'
                      ? t(
                          `auth_files.shared_quota_${record.phase === 'probing' ? 'probing' : 'probe_pending'}`
                        )
                      : t('auth_files.cooldown_timer_elapsed')}
                </span>
              </div>
              <div className={styles.reason}>
                <span>
                  {t(
                    record.origin === 'shared_pool'
                      ? sharedTitle(record)
                      : cooldownReasonKey(record.reason)
                  )}
                </span>
                {record.origin === 'shared_pool' && record.relatedAuthCount !== undefined && (
                  <span>
                    {t('auth_files.shared_quota_related', { count: record.relatedAuthCount })}
                  </span>
                )}
                {record.httpStatus !== undefined && (
                  <span>{t('auth_files.cooldown_http_status', { status: record.httpStatus })}</span>
                )}
                {record.backoffLevel !== undefined && (
                  <span>{t('auth_files.cooldown_backoff', { level: record.backoffLevel })}</span>
                )}
              </div>
              {remainingSeconds > 0 && (
                <div className={styles.deadline}>
                  {t('auth_files.cooldown_deadline')}{' '}
                  <time dateTime={record.retryAt}>
                    {formatDateTimeValue(record.retryAt, i18n.language)}
                  </time>
                </div>
              )}
              {record.origin === 'shared_pool' && (
                <p className={styles.note}>{t('auth_files.shared_quota_note')}</p>
              )}
              {canRetrySharedQuota(record) && onReset && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onReset(record)}
                  loading={resetting}
                  disabled={resetDisabled || record.phase === 'probing'}
                >
                  {t('auth_files.shared_quota_retry_button')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {snapshot.observedAt && (
          <p className={styles.observed}>
            {t('auth_files.cooldown_observed')}{' '}
            <time dateTime={snapshot.observedAt}>
              {formatDateTimeValue(snapshot.observedAt, i18n.language)}
            </time>
          </p>
        )}
        <p className={styles.note}>{t('auth_files.cooldown_note')}</p>
        {onReset && (
          <div className={styles.actionRow}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReset()}
              loading={resetting}
              disabled={resetDisabled}
              title={t('auth_files.cooldown_reset_hint')}
            >
              {!resetting && <IconRefreshCw size={14} />}
              {t('auth_files.cooldown_reset_button')}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
