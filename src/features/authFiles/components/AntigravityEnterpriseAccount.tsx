import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconChevronDown, IconDownload, IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import {
  antigravityEnterpriseApi,
  antigravityEnterpriseBindingFiles,
  antigravityEnterpriseIdentity,
} from '@/services/api/antigravityEnterprise';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { useNow } from '@/hooks/useNow';
import type { AuthFileItem } from '@/types';
import type { AuthFileCooldownSnapshot } from '@/types/authFile';
import type { AntigravityEnterpriseQuota as Quota } from '@/types/antigravityEnterprise';
import { summarizeCooldowns } from '../cooldowns';
import { getAuthFileRefreshKey } from '../manualRefresh';
import type { AuthFileCardProps } from './AuthFileCard';
import { AuthFileCooldownSection } from './AuthFileCooldownSection';
import statusStyles from './AuthFileCard.module.scss';
import styles from './GeminiEnterpriseAccount.module.scss';
import ownStyles from './AntigravityEnterpriseAccount.module.scss';

type Props = Pick<
  AuthFileCardProps,
  | 'file'
  | 'selected'
  | 'disableControls'
  | 'deleting'
  | 'statusUpdating'
  | 'manualRefreshing'
  | 'onShowModels'
  | 'onEnterpriseResourcesSaved'
  | 'onDownload'
  | 'onManualRefresh'
  | 'onOpenPrefixProxyEditor'
  | 'onDelete'
  | 'onToggleStatus'
  | 'onToggleSelect'
  | 'onCooldownReset'
>;

export function AntigravityEnterpriseQuotaBody({
  data,
  cooldownSnapshot,
  loading,
  failed,
}: {
  data?: Quota;
  cooldownSnapshot?: AuthFileCooldownSnapshot;
  loading?: boolean;
  failed?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const quotaCooldowns = data?.cooldownSnapshot;
  const snapshot =
    quotaCooldowns &&
    (!cooldownSnapshot || quotaCooldowns.receivedAtMs >= cooldownSnapshot.receivedAtMs)
      ? quotaCooldowns
      : cooldownSnapshot;
  const now = useNow(Boolean(data?.weekly?.resetAt || snapshot?.records?.length));
  const rows = snapshot ? summarizeCooldowns(snapshot, now).rows : [];
  const bindingRestriction = rows.find(
    ({ record, remainingSeconds }) =>
      record.scope === 'credential' &&
      record.reason === 'binding_rate_limit' &&
      remainingSeconds > 0
  );
  const weeklyRestriction = rows.find(
    ({ record }) =>
      record.reason === 'weekly_quota' &&
      record.origin === 'shared_pool' &&
      record.feature === 'ai_developer_tools'
  );
  const limited = rows.filter(
    ({ record, remainingSeconds }) =>
      remainingSeconds > 0 &&
      (record.httpStatus === 429 ||
        record.reason === 'quota' ||
        record.reason === 'credential_quota')
  );
  const bucket = data?.weekly;
  const expired = Boolean(bucket?.resetAt && Date.parse(bucket.resetAt) <= now);
  const fraction = !expired && !bucket?.disabled ? bucket?.remainingFraction : null;
  const amount = !expired && !bucket?.disabled ? bucket?.remainingAmount : null;
  const reported =
    fraction !== null && fraction !== undefined
      ? new Intl.NumberFormat(i18n.resolvedLanguage, {
          style: 'percent',
          maximumFractionDigits: 5,
        }).format(fraction)
      : amount !== null && amount !== undefined
        ? t('antigravity_enterprise.remaining_units', { value: amount })
        : null;
  const fresh = data?.status === 'ok' && !data.stale && !failed;
  const exhausted =
    fresh && (fraction === 0 || (typeof amount === 'string' && /^0+$/.test(amount)));
  let headline = t('antigravity_enterprise.quota_unverified');
  if (loading && !data) headline = t('antigravity_enterprise.loading');
  if (bindingRestriction) {
    headline = t('antigravity_enterprise.binding_cooling_title');
  } else if (exhausted) {
    headline = t('antigravity_enterprise.weekly_exhausted');
  } else if (weeklyRestriction) {
    headline = t(
      weeklyRestriction.record.phase === 'cooling' && weeklyRestriction.remainingSeconds > 0
        ? 'antigravity_enterprise.weekly_exhausted'
        : 'antigravity_enterprise.quota_recheck_pending'
    );
  } else if (limited.length > 0) {
    headline = t(
      limited.some(({ record }) => record.scope === 'credential')
        ? 'antigravity_enterprise.binding_limited'
        : 'antigravity_enterprise.models_limited'
    );
  } else if (expired) {
    headline = t('antigravity_enterprise.quota_recheck_pending');
  }
  return (
    <div className={ownStyles.quotaBody} aria-live="polite">
      <strong>{headline}</strong>
      {bindingRestriction && (
        <>
          <span className={ownStyles.warning}>
            {t('antigravity_enterprise.binding_rate_limit')}
          </span>
          <time dateTime={bindingRestriction.record.retryAt}>
            {t('antigravity_enterprise.retry_at', {
              value: new Date(bindingRestriction.record.retryAt).toLocaleString(
                i18n.resolvedLanguage
              ),
            })}
          </time>
        </>
      )}
      {reported !== null && (
        <span className={ownStyles.observation}>
          {t('antigravity_enterprise.pool_reported', { value: reported })}
        </span>
      )}
      {bucket?.resetAt ? (
        <time
          dateTime={bucket.resetAt}
          title={new Date(bucket.resetAt).toLocaleString(i18n.resolvedLanguage)}
        >
          {expired
            ? t('antigravity_enterprise.reset_pending')
            : t('antigravity_enterprise.resets_at', {
                value: new Date(bucket.resetAt).toLocaleString(i18n.resolvedLanguage),
                hours: Math.ceil((Date.parse(bucket.resetAt) - now) / 3_600_000),
              })}
        </time>
      ) : (
        <span>{t('antigravity_enterprise.reset_unknown')}</span>
      )}
      {(data?.stale || failed) && (
        <span className={ownStyles.warning}>{t('antigravity_enterprise.stale')}</span>
      )}
      {data && data.overageEnabled !== false && (
        <span className={ownStyles.warning}>
          {t('antigravity_enterprise.subscription_only_required')}
        </span>
      )}
      {data?.observedAt && (
        <time dateTime={data.observedAt} className={ownStyles.observation}>
          {t('antigravity_enterprise.checked_at', {
            value: new Date(data.observedAt).toLocaleString(i18n.resolvedLanguage),
          })}
        </time>
      )}
    </div>
  );
}

function WeeklyQuota({ file, disabled }: { file: AuthFileItem; disabled: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Quota>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const loadRef = useRef<(refresh: boolean) => void>(() => undefined);
  const identity = antigravityEnterpriseIdentity(file);
  useEffect(() => {
    let active = true;
    const revision = apiClient.getConnectionRevision();
    const current = (controller: AbortController) =>
      active && !controller.signal.aborted && revision === apiClient.getConnectionRevision();
    const load = async (refresh: boolean) => {
      if (disabled || !active || revision !== apiClient.getConnectionRevision()) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      try {
        const result = await antigravityEnterpriseApi.quota(file, refresh, controller.signal);
        if (current(controller)) {
          setData(result);
          setFailed(false);
        }
      } catch {
        if (current(controller)) setFailed(true);
      } finally {
        if (current(controller)) setLoading(false);
      }
    };
    setData(undefined);
    setFailed(false);
    loadRef.current = (refresh) => void load(refresh);
    void load(false);
    const timer = window.setInterval(() => void load(true), 60_000);
    const unsubscribe = useAuthStore.subscribe(() => {
      if (
        revision !== apiClient.getConnectionRevision() ||
        !useAuthStore.getState().isAuthenticated
      ) {
        active = false;
        request.current?.abort();
        setData(undefined);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      request.current?.abort();
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [disabled, file, identity]);
  return (
    <section
      className={ownStyles.quota}
      aria-label={t('antigravity_enterprise.weekly_quota')}
      aria-busy={loading}
    >
      <div className={ownStyles.quotaHeading}>
        <span>{t('antigravity_enterprise.weekly_quota')}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || loading}
          onClick={() => loadRef.current(true)}
          aria-label={t('antigravity_enterprise.refresh_quota')}
        >
          <IconRefreshCw size={13} />
        </Button>
      </div>
      <AntigravityEnterpriseQuotaBody
        data={data}
        cooldownSnapshot={file.cooldownSnapshot}
        loading={loading}
        failed={failed}
      />
    </section>
  );
}

function BindingRows({
  file,
  parentDisabled,
  props,
}: {
  file: AuthFileItem;
  parentDisabled: boolean;
  props: Props;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const identity = antigravityEnterpriseIdentity(file);
  useEffect(() => () => request.current?.abort(), [identity]);
  const detailsId = useId();
  const binding = file.antigravityEnterprise;
  const license = binding?.license;
  const status = file.disabled
    ? 'disabled'
    : parentDisabled
      ? 'account_disabled'
      : file.unavailable
        ? 'unavailable'
        : 'enabled';
  const toggle = async (enabled: boolean) => {
    if (busy || props.disableControls) return;
    const controller = new AbortController();
    request.current = controller;
    const revision = apiClient.getConnectionRevision();
    const current = () =>
      !controller.signal.aborted && revision === apiClient.getConnectionRevision();
    setBusy(true);
    try {
      await antigravityEnterpriseApi.updateBinding(file, { disabled: !enabled }, controller.signal);
      if (current()) await props.onEnterpriseResourcesSaved?.(file);
    } catch {
      if (current())
        useNotificationStore
          .getState()
          .showNotification(t('antigravity_enterprise.update_error'), 'error');
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <>
      <tr className={styles.mainRow} data-binding-id={binding?.bindingId}>
        <td>
          <strong className={styles.resourceName}>{license?.projectId}</strong>
          <div className={styles.resourceMeta}>
            <span className={styles.region}>{license?.location}</span>
            <span>{license?.tierDisplayName}</span>
          </div>
        </td>
        <td>
          <WeeklyQuota file={file} disabled={props.disableControls} />
        </td>
        <td className={styles.rowActions}>
          <div className={styles.rowControls}>
            <div className={styles.switchRow}>
              <ToggleSwitch
                checked={!file.disabled}
                onChange={(enabled) => void toggle(enabled)}
                disabled={props.disableControls || busy || !binding?.revision}
                ariaLabel={t('antigravity_enterprise.toggle_binding', {
                  project: license?.projectId,
                  region: license?.location,
                })}
              />
              <span>{t('antigravity_enterprise.' + status)}</span>
            </div>
            <div className={styles.rowButtons}>
              <Button
                size="sm"
                variant="ghost"
                disabled={props.disableControls || busy}
                onClick={() => props.onShowModels(file)}
              >
                {t('antigravity_enterprise.models')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => setExpanded((previous) => !previous)}
              >
                {t('antigravity_enterprise.details')}
              </Button>
            </div>
          </div>
        </td>
      </tr>
      <tr className={styles.requestsRow}>
        <td colSpan={3}>
          <div className={styles.requests}>
            <span>{t('auth_files.card_requests')}</span>
            <span className={styles.counts}>
              <span className={styles.success}>
                {t('status_bar.success_short')} {file.successCount ?? 0}
              </span>
              <span className={styles.failure}>
                {t('status_bar.failure_short')} {file.failureCount ?? 0}
              </span>
            </span>
            <div className={styles.bars}>
              <ProviderStatusBar
                statusData={statusBarDataFromRecentRequests(file.recentRequests ?? [])}
                styles={{
                  ...statusStyles,
                  statusRate: styles.hiddenRate,
                  statusBlock: styles.requestBlock,
                }}
              />
            </div>
          </div>
          {expanded && (
            <div id={detailsId} className={styles.details}>
              <p className="hint">{t('antigravity_enterprise.catalog_hint')}</p>
              {file.statusMessage && <p role="status">{file.statusMessage}</p>}
              <AuthFileCooldownSection
                snapshot={file.cooldownSnapshot}
                resetDisabled={props.disableControls || busy}
                onReset={
                  file.authIndex ? (shared) => props.onCooldownReset(file, shared) : undefined
                }
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={props.disableControls || busy}
                onClick={() => props.onOpenPrefixProxyEditor(file)}
              >
                {t('auth_files.prefix_proxy_button')}
              </Button>
              <p className="hint">{t('antigravity_enterprise.cooldown_hint')}</p>
            </div>
          )}
        </td>
      </tr>
    </>
  );
}

export function AntigravityEnterpriseAccount(props: Props) {
  const { t } = useTranslation();
  const { file, disableControls } = props;
  const [expanded, setExpanded] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const request = useRef<AbortController | null>(null);
  const identity = antigravityEnterpriseIdentity(file);
  useEffect(() => () => request.current?.abort(), [identity]);
  const rowsId = useId();
  const children = useMemo(() => antigravityEnterpriseBindingFiles(file), [file]);
  const projectCount = new Set(
    children.map((child) => child.antigravityEnterprise?.license?.projectId)
  ).size;
  const account = file.antigravityEnterprise;
  const discover = async () => {
    if (disableControls || discovering) return;
    const controller = new AbortController();
    request.current = controller;
    const revision = apiClient.getConnectionRevision();
    const current = () =>
      !controller.signal.aborted && revision === apiClient.getConnectionRevision();
    setDiscovering(true);
    try {
      await antigravityEnterpriseApi.discover(file, controller.signal);
      if (current()) await props.onEnterpriseResourcesSaved?.(file);
    } catch {
      if (current())
        useNotificationStore
          .getState()
          .showNotification(t('antigravity_enterprise.discover_error'), 'error');
    } finally {
      if (current()) setDiscovering(false);
    }
  };
  return (
    <article className={styles.account}>
      <header className={styles.header}>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={rowsId}
          aria-label={t('antigravity_enterprise.expand_account')}
          onClick={() => setExpanded((previous) => !previous)}
        >
          <IconChevronDown
            size={16}
            style={{ transform: expanded ? undefined : 'rotate(-90deg)' }}
          />
        </Button>
        <SelectionCheckbox
          checked={props.selected}
          disabled={disableControls}
          onChange={() => props.onToggleSelect(file.name)}
          ariaLabel={t('antigravity_enterprise.select_account', { name: file.email || file.name })}
        />
        <div className={styles.identity}>
          <span className={ownStyles.badge}>{t('antigravity_enterprise.title')}</span>
          <h2 title={file.email || file.name}>{file.email || file.name}</h2>
          <p title={file.name}>{file.name}</p>
        </div>
        <div className={styles.accountActions}>
          <Button
            size="sm"
            variant="secondary"
            loading={discovering}
            disabled={disableControls || discovering || !account?.accountManagementSupported}
            onClick={() => void discover()}
            title={t('antigravity_enterprise.discover')}
            aria-label={t('antigravity_enterprise.discover')}
          >
            <IconRefreshCw size={13} />
            <span className={styles.discoverLabel}>{t('antigravity_enterprise.discover')}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={
              disableControls ||
              props.manualRefreshing[getAuthFileRefreshKey(file)] ||
              account?.hasRefreshToken === false
            }
            aria-label={t('auth_files.manual_refresh_button')}
            title={t('auth_files.manual_refresh_button')}
            onClick={() => props.onManualRefresh(file)}
          >
            <IconRefreshCw size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disableControls}
            aria-label={t('auth_files.download_button')}
            title={t('auth_files.download_button')}
            onClick={() => props.onDownload(file.name)}
          >
            <IconDownload size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disableControls || props.deleting === file.name}
            aria-label={t('auth_files.delete_button')}
            title={t('auth_files.delete_button')}
            onClick={() => props.onDelete(file.name)}
          >
            <IconTrash2 size={15} />
          </Button>
        </div>
      </header>
      <div className={styles.metadata}>
        <span>
          {t('antigravity_enterprise.binding_count', {
            projects: projectCount,
            bindings: children.length,
          })}
        </span>
        <ToggleSwitch
          checked={!file.disabled}
          disabled={disableControls || props.statusUpdating[getAuthFileRefreshKey(file)]}
          label={t('antigravity_enterprise.account_enabled')}
          onChange={(enabled) => props.onToggleStatus(file, enabled)}
        />
      </div>
      {expanded && (
        <div id={rowsId}>
          {children.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {['project_region', 'weekly_quota', 'status_actions'].map((column) => (
                      <th key={column} scope="col">
                        {t('antigravity_enterprise.' + column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {children.map((child) => (
                    <Fragment key={antigravityEnterpriseIdentity(child)}>
                      <BindingRows
                        file={child}
                        parentDisabled={file.disabled === true}
                        props={props}
                      />
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>{t('antigravity_enterprise.empty')}</p>
          )}
          <p className={styles.notice}>{t('antigravity_enterprise.shared_pool_hint')}</p>
          {account?.discovery?.status === 'partial' && (
            <p role="status" className={styles.notice}>
              {t('antigravity_enterprise.partial_discovery')}
            </p>
          )}
          {Boolean(account?.discovery?.unreachable.length) && (
            <p className={styles.notice}>{account?.discovery?.unreachable.join(', ')}</p>
          )}
        </div>
      )}
    </article>
  );
}
