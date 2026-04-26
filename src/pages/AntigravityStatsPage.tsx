/**
 * Antigravity Request Statistics page.
 * Displays auth×model request statistics for the Antigravity provider.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNotificationStore } from '@/stores';
import {
  antigravityStatsApi,
  type AntigravityStatsResponse,
  type AntigravityStatEntry,
  type AntigravityAuthSummary,
  type AntigravityModelSummary,
  type AntigravityStatsSummary,
} from '@/services/api/antigravityStats';
import styles from './AntigravityStatsPage.module.scss';

type ViewMode = 'auth' | 'model' | 'detail';

const EMPTY_SUMMARY: AntigravityStatsSummary = {
  total_auths: 0,
  total_models: 0,
  total_requests: 0,
  total_success: 0,
  total_failure: 0,
  total_credits: 0,
  error_rate: '0.0%',
};

function formatTime(iso: string): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString();
  } catch {
    return '-';
  }
}

function getErrorRateClass(rateStr: string): string {
  const num = parseFloat(rateStr);
  if (isNaN(num) || num <= 0) return styles.errorRateLow;
  if (num >= 30) return styles.errorRateHigh;
  if (num >= 10) return styles.errorRateMedium;
  return styles.errorRateLow;
}

function getStatusBadgeClass(code: number | string): string {
  const num = typeof code === 'string' ? parseInt(code, 10) : code;
  if (num === 429) return styles.statusBadge429;
  if (num >= 400 && num < 500) return styles.statusBadge4xx;
  if (num >= 500) return styles.statusBadge5xx;
  return styles.statusBadgeOther;
}

function StatusCodeBadges({ codes }: { codes?: Record<string, number> }) {
  if (!codes || Object.keys(codes).length === 0) return <span>-</span>;
  const sorted = Object.entries(codes).sort(([, a], [, b]) => b - a);
  return (
    <div className={styles.statusCodes}>
      {sorted.map(([code, count]) => (
        <span key={code} className={`${styles.statusBadge} ${getStatusBadgeClass(code)}`}>
          {code}:{count}
        </span>
      ))}
    </div>
  );
}

function ModelTags({ models }: { models?: string[] }) {
  if (!models || models.length === 0) return <span>-</span>;
  return (
    <div className={styles.modelTags}>
      {models.map((m) => (
        <span key={m} className={styles.modelTag}>{m}</span>
      ))}
    </div>
  );
}

export function AntigravityStatsPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [viewMode, setViewMode] = useState<ViewMode>('auth');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<AntigravityStatsResponse | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await antigravityStatsApi.getStats(viewMode);
      setData(result);
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknown_error');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [viewMode, t]);

  useHeaderRefresh(loadStats);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleReset = useCallback(async () => {
    setConfirmReset(false);
    try {
      const result = await antigravityStatsApi.resetStats();
      showNotification(
        `${t('antigravity_stats.reset_success', { count: result.cleared_entries })}`,
        'success'
      );
      await loadStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknown_error');
      showNotification(msg, 'error');
    }
  }, [loadStats, showNotification, t]);

  const summary = data?.summary ?? EMPTY_SUMMARY;
  const stats = data?.stats ?? [];

  const viewModes: Array<{ key: ViewMode; label: string }> = useMemo(() => [
    { key: 'auth', label: t('antigravity_stats.view_auth') },
    { key: 'model', label: t('antigravity_stats.view_model') },
    { key: 'detail', label: t('antigravity_stats.view_detail') },
  ], [t]);

  return (
    <div className={styles.container}>
      {loading && !data && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <LoadingSpinner size={28} />
        </div>
      )}

      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('antigravity_stats.title')}</h1>
        <p className={styles.description}>{t('antigravity_stats.description')}</p>
      </div>

      <div className={styles.headerActions}>
        <div className={styles.viewModeToggle}>
          {viewModes.map(({ key, label }) => (
            <Button
              key={key}
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${viewMode === key ? styles.viewModeButtonActive : ''}`}
              onClick={() => setViewMode(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadStats()}
          disabled={loading}
        >
          {loading ? t('common.loading') : t('common.refresh')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirmReset(true)}
          disabled={loading || summary.total_requests === 0}
        >
          {t('antigravity_stats.reset')}
        </Button>
        {lastRefreshedAt && (
          <span className={styles.lastRefreshed}>
            {lastRefreshedAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {/* Summary cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('antigravity_stats.total_requests')}</span>
          <span className={styles.summaryValue}>{summary.total_requests.toLocaleString()}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('antigravity_stats.total_success')}</span>
          <span className={`${styles.summaryValue} ${styles.summarySuccess}`}>
            {summary.total_success.toLocaleString()}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('antigravity_stats.total_failure')}</span>
          <span className={`${styles.summaryValue} ${styles.summaryDanger}`}>
            {summary.total_failure.toLocaleString()}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('antigravity_stats.error_rate')}</span>
          <span className={`${styles.summaryValue} ${styles.summaryValueSmall} ${getErrorRateClass(summary.error_rate)}`}>
            {summary.error_rate}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('antigravity_stats.total_auths')}</span>
          <span className={styles.summaryValue}>{summary.total_auths}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('antigravity_stats.total_models')}</span>
          <span className={styles.summaryValue}>{summary.total_models}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('antigravity_stats.total_credits', { defaultValue: '💎 积分消化' })}</span>
          <span className={`${styles.summaryValue} ${styles.summaryCredits}`}>
            {(summary.total_credits ?? 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Data table */}
      {stats.length === 0 && !loading ? (
        <div className={styles.emptyState}>{t('antigravity_stats.empty')}</div>
      ) : stats.length > 0 && (
        <div className={styles.tableWrapper}>
          <div className={styles.tableTitle}>
            {viewMode === 'auth' && t('antigravity_stats.table_auth_title')}
            {viewMode === 'model' && t('antigravity_stats.table_model_title')}
            {viewMode === 'detail' && t('antigravity_stats.table_detail_title')}
            <span className={styles.tableTitleCount}>{stats.length}</span>
          </div>
          <div className={styles.tableScroll}>
            {viewMode === 'auth' && (
              <AuthTable stats={stats as AntigravityAuthSummary[]} />
            )}
            {viewMode === 'model' && (
              <ModelTable stats={stats as AntigravityModelSummary[]} />
            )}
            {viewMode === 'detail' && (
              <DetailTable stats={stats as AntigravityStatEntry[]} />
            )}
          </div>
        </div>
      )}

      {/* Confirm reset overlay */}
      {confirmReset && (
        <div className={styles.confirmOverlay} onClick={() => setConfirmReset(false)}>
          <div className={styles.confirmModal} onClick={(e) => e.stopPropagation()}>
            <p>{t('antigravity_stats.reset_confirm')}</p>
            <div className={styles.confirmActions}>
              <Button variant="secondary" size="sm" onClick={() => setConfirmReset(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={handleReset}>
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthTable({ stats }: { stats: AntigravityAuthSummary[] }) {
  const { t } = useTranslation();
  return (
    <table className={styles.statsTable}>
      <thead>
        <tr>
          <th>{t('antigravity_stats.col_auth_id')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_total')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_success')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_failure')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_credits', { defaultValue: '💎积分' })}</th>
          <th>{t('antigravity_stats.col_error_rate')}</th>
          <th>{t('antigravity_stats.col_status_codes')}</th>
          <th>{t('antigravity_stats.col_models')}</th>
          <th>{t('antigravity_stats.col_last_seen')}</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((row) => (
          <tr key={row.auth_id}>
            <td className={styles.cellAuthId} title={row.auth_id}>{row.auth_id}</td>
            <td className={styles.cellNumber}>{row.total.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellSuccess}`}>{row.success.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellFailure}`}>{row.failure.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellCredits}`}>{(row.credits_count ?? 0).toLocaleString()}</td>
            <td className={`${styles.cellErrorRate} ${getErrorRateClass(row.error_rate)}`}>{row.error_rate}</td>
            <td><StatusCodeBadges codes={row.status_codes} /></td>
            <td><ModelTags models={row.models} /></td>
            <td className={styles.timeCell}>{formatTime(row.last_seen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelTable({ stats }: { stats: AntigravityModelSummary[] }) {
  const { t } = useTranslation();
  return (
    <table className={styles.statsTable}>
      <thead>
        <tr>
          <th>{t('antigravity_stats.col_model')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_total')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_success')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_failure')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_credits', { defaultValue: '💎积分' })}</th>
          <th>{t('antigravity_stats.col_error_rate')}</th>
          <th>{t('antigravity_stats.col_status_codes')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_auth_count')}</th>
          <th>{t('antigravity_stats.col_last_seen')}</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((row) => (
          <tr key={row.model}>
            <td className={styles.cellModel}>{row.model}</td>
            <td className={styles.cellNumber}>{row.total.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellSuccess}`}>{row.success.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellFailure}`}>{row.failure.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellCredits}`}>{(row.credits_count ?? 0).toLocaleString()}</td>
            <td className={`${styles.cellErrorRate} ${getErrorRateClass(row.error_rate)}`}>{row.error_rate}</td>
            <td><StatusCodeBadges codes={row.status_codes} /></td>
            <td className={styles.cellNumber}>{row.auth_count}</td>
            <td className={styles.timeCell}>{formatTime(row.last_seen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailTable({ stats }: { stats: AntigravityStatEntry[] }) {
  const { t } = useTranslation();
  return (
    <table className={styles.statsTable}>
      <thead>
        <tr>
          <th>{t('antigravity_stats.col_auth_id')}</th>
          <th>{t('antigravity_stats.col_model')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_total')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_success')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_failure')}</th>
          <th className={styles.cellNumber}>{t('antigravity_stats.col_credits', { defaultValue: '💎积分' })}</th>
          <th>{t('antigravity_stats.col_status_codes')}</th>
          <th>{t('antigravity_stats.col_last_seen')}</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((row) => (
          <tr key={`${row.auth_id}|${row.model}`}>
            <td className={styles.cellAuthId} title={row.auth_id}>{row.auth_id}</td>
            <td className={styles.cellModel}>{row.model}</td>
            <td className={styles.cellNumber}>{row.total.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellSuccess}`}>{row.success.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellFailure}`}>{row.failure.toLocaleString()}</td>
            <td className={`${styles.cellNumber} ${styles.cellCredits}`}>{(row.credits_count ?? 0).toLocaleString()}</td>
            <td><StatusCodeBadges codes={row.status_codes} /></td>
            <td className={styles.timeCell}>{formatTime(row.last_seen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
