import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  geminiBudgetApi,
  isGeminiBudgetConflict,
  isGeminiBudgetUnsupported,
  type GeminiBudgetSnapshot,
} from '@/services/api/geminiBudget';
import { guardConfigConnection } from '@/services/api/configValue';
import { useAuthStore, useNotificationStore, useQuotaStore } from '@/stores';
import {
  canInitializeGeminiBudget,
  formatGeminiBudgetTime,
  geminiBudgetStateKey,
} from '../geminiBudgetView';
import styles from './GeminiBudgetSection.module.scss';

export interface GeminiBudgetContentProps {
  snapshot: GeminiBudgetSnapshot;
}

export function GeminiBudgetContent({ snapshot }: GeminiBudgetContentProps) {
  const { t, i18n } = useTranslation();
  const displayTime = (value: string | null) =>
    formatGeminiBudgetTime(value, i18n.language) ?? t('gemini_budget.unknown');
  return (
    <>
      <div className={styles.summary}>
        <span className={styles.badge}>{t(geminiBudgetStateKey(snapshot.engineState))}</span>
        <span>{t('gemini_budget.pacific_day', { date: snapshot.pacificDate })}</span>
        <span>{t('gemini_budget.next_reset', { time: displayTime(snapshot.nextReset) })}</span>
        {snapshot.estimated && <span className={styles.badge}>{t('gemini_budget.estimated')}</span>}
      </div>
      <p className={styles.note}>{t('gemini_budget.count_note')}</p>
      {['disaster', 'storage_error', 'locked'].includes(snapshot.engineState) && (
        <div role="alert" className={styles.warning}>
          {t(`gemini_budget.notice_${snapshot.engineState}`)}
        </div>
      )}
      {snapshot.projects.length === 0 ? (
        <p className={styles.note}>{t('gemini_budget.no_projects')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>{t('gemini_budget.table_caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('gemini_budget.project')}</th>
                <th scope="col">{t('gemini_budget.model')}</th>
                <th scope="col">{t('gemini_budget.sent_limit')}</th>
                <th scope="col">{t('gemini_budget.remaining')}</th>
                <th scope="col">{t('gemini_budget.inflight')}</th>
                <th scope="col">{t('gemini_budget.status')}</th>
                <th scope="col">{t('gemini_budget.retry_at')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.projects.flatMap((project) =>
                project.models.map((model) => (
                  <tr key={`${project.projectId}:${model.model}`}>
                    <td>
                      <code>{project.projectId}</code>
                      <span className={styles.keyCount}>
                        {t('gemini_budget.key_count', { count: project.keyCount })}
                      </span>
                    </td>
                    <th scope="row" className={styles.model}>
                      {model.model}
                    </th>
                    <td className={styles.counter}>
                      {model.used} / {model.limit}
                      {model.estimated && (
                        <span className={styles.keyCount}>{t('gemini_budget.estimated')}</span>
                      )}
                    </td>
                    <td className={styles.counter}>{model.remaining}</td>
                    <td className={styles.counter}>{model.inflight}</td>
                    <td>{t(geminiBudgetStateKey(model.state))}</td>
                    <td>{model.retryAt ? displayTime(model.retryAt) : t('gemini_budget.none')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.backup}>
        <strong>{t('gemini_budget.backup')}</strong>
        <span>
          {snapshot.backupEnabled
            ? t(geminiBudgetStateKey(snapshot.lastBackup.state))
            : t('gemini_budget.state_disabled')}
        </span>
        {snapshot.lastBackup.date && <span>{snapshot.lastBackup.date}</span>}
        {snapshot.lastBackup.attemptedAt && (
          <span>
            {t('gemini_budget.backup_attempt', {
              time: displayTime(snapshot.lastBackup.attemptedAt),
            })}
          </span>
        )}
        {snapshot.lastBackup.completedAt && (
          <span>
            {t('gemini_budget.backup_completed', {
              time: displayTime(snapshot.lastBackup.completedAt),
            })}
          </span>
        )}
      </div>
      <p className={styles.note}>{t('gemini_budget.backup_note')}</p>
    </>
  );
}

export function GeminiBudgetSection({ refreshGeneration = 0 }: { refreshGeneration?: number }) {
  const { t } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const generation = useQuotaStore((state) => state.cacheGeneration);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [result, setResult] = useState<{
    generation: number;
    snapshot: GeminiBudgetSnapshot | null;
    unsupported: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializingGeneration, setInitializingGeneration] = useState<number | null>(null);
  const initializing = initializingGeneration === generation;
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const mutationBusy = useRef(false);
  const snapshot = result?.generation === generation && connected ? result.snapshot : null;
  const unsupported = result?.generation === generation && result.unsupported;

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (!connected) return;
    const current = () =>
      id === requestId.current && generation === useQuotaStore.getState().cacheGeneration;
    setLoading(true);
    setError('');
    try {
      const next = await geminiBudgetApi.snapshot();
      if (current()) setResult({ generation, snapshot: next, unsupported: false });
    } catch (err) {
      if (!current()) return;
      if (isGeminiBudgetUnsupported(err)) {
        setResult({ generation, snapshot: null, unsupported: true });
      } else {
        setError(t('gemini_budget.load_failed'));
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [connected, generation, t]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load, refreshGeneration]);

  const initialize = () => {
    if (!connected || loading || mutationBusy.current || !canInitializeGeminiBudget(snapshot))
      return;
    const revision = snapshot!.revision;
    const assertConnection = guardConfigConnection();
    const current = () =>
      useAuthStore.getState().connectionStatus === 'connected' &&
      generation === useQuotaStore.getState().cacheGeneration;
    showConfirmation({
      title: t('gemini_budget.init_title'),
      message: t('gemini_budget.init_message'),
      confirmText: t('gemini_budget.init_confirm'),
      variant: 'primary',
      onConfirm: async () => {
        if (mutationBusy.current) return;
        assertConnection();
        mutationBusy.current = true;
        setInitializingGeneration(generation);
        try {
          await geminiBudgetApi.initialize(revision);
          if (!current()) return;
          showNotification(t('gemini_budget.init_success'), 'success');
          await load();
        } catch (err) {
          if (!current()) return;
          const message = t(
            isGeminiBudgetConflict(err)
              ? 'gemini_budget.init_conflict'
              : 'gemini_budget.init_failed'
          );
          showNotification(message, 'error');
          setError(message);
          if (isGeminiBudgetConflict(err)) {
            await load();
            if (current()) {
              showConfirmation({
                title: t('gemini_budget.init_title'),
                message,
                confirmText: t('common.close'),
                variant: 'secondary',
                onConfirm: () => {},
              });
            }
          }
          // eslint-disable-next-line preserve-caught-error -- Avoid logging untrusted management response details.
          throw new Error(message);
        } finally {
          mutationBusy.current = false;
          if (current()) setInitializingGeneration(null);
        }
      },
    });
  };

  if (!connected) return null;
  return (
    <section className={styles.section} aria-labelledby="gemini-budget-title">
      <div className={styles.header}>
        <div>
          <h2 id="gemini-budget-title">{t('gemini_budget.title')}</h2>
          <p className={styles.note}>{t('gemini_budget.subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            disabled={initializing}
            onClick={() => void load()}
          >
            {t('gemini_budget.refresh')}
          </Button>
          {canInitializeGeminiBudget(snapshot) && (
            <Button size="sm" loading={initializing} disabled={loading} onClick={initialize}>
              {t('gemini_budget.initialize')}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className={styles.warning}>
          {error}
        </div>
      )}
      {unsupported ? (
        <p className={styles.note}>{t('gemini_budget.unsupported')}</p>
      ) : snapshot ? (
        <GeminiBudgetContent snapshot={snapshot} />
      ) : loading ? (
        <Skeleton height={90} rounded={10} />
      ) : null}
    </section>
  );
}
