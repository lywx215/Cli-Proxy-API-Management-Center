import { EnterpriseDiscoveryStatus } from './EnterpriseDiscoveryStatus';
import { EnterpriseCatalogStatus } from './EnterpriseCatalogFields';
import { enterprisePolicyRoutingPaused } from '../enterpriseModelPolicy';
import { enterpriseSubscriptionTone } from '../enterpriseSubscriptionTone';
import { EnterpriseModelPolicyStatus } from './EnterpriseModelPolicyFields';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconChevronDown, IconDownload, IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { apiClient } from '@/services/api/client';
import {
  geminiEnterpriseApi,
  type EnterpriseCollectionPatch,
} from '@/services/api/geminiEnterprise';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { AuthFileItem } from '@/types';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import {
  enterpriseCollectionFiles,
  enterpriseCollectionIdentity,
  enterpriseCollectionName,
} from '../enterpriseAccounts';
import {
  enterpriseSubscriptionUnknownReason,
  groupEnterpriseCollections,
  type EnterpriseCollectionGroupKind,
} from '../enterpriseCollectionGroups';
import { getAuthFileRefreshKey } from '../manualRefresh';
import type { AuthFileCardProps } from './AuthFileCard';
import { GeminiEnterpriseQuota } from './GeminiEnterpriseQuota';
import { GeminiEnterpriseBinding } from './GeminiEnterpriseBinding';
import { GeminiEnterpriseRegionEditor } from './GeminiEnterpriseRegionEditor';
import { AuthFileCooldownSection } from './AuthFileCooldownSection';
import { useEnterpriseHydrogenOperations } from '../hooks/useEnterpriseHydrogenOperations';
import { EnterpriseHydrogenOperationsModal } from './EnterpriseHydrogenOperationsModal';
import {
  enterpriseHydrogenAdmission,
  enterpriseHydrogenSummary,
  enterpriseHydrogenSupported,
} from '../enterpriseHydrogen';
import statusStyles from './AuthFileCard.module.scss';
import styles from './GeminiEnterpriseAccount.module.scss';

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
>;

function CollectionRows({
  file,
  parentDisabled,
  props,
}: {
  file: AuthFileItem;
  parentDisabled: boolean;
  props: Props;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const binding = file.geminiEnterprise;
  const subscriptionTone = enterpriseSubscriptionTone(binding?.modelPolicyState?.subscription);
  const unknownReason = enterpriseSubscriptionUnknownReason(
    binding?.modelPolicyState?.subscription
  );
  const identity = enterpriseCollectionIdentity(file);
  const statusData = statusBarDataFromRecentRequests(file.recentRequests ?? []);
  const hasRecent = statusData.totalSuccess + statusData.totalFailure > 0;
  const detailId = useId();
  const unavailable = file.unavailable || binding?.missing;
  const routingPaused =
    !file.disabled &&
    !parentDisabled &&
    !unavailable &&
    enterprisePolicyRoutingPaused(binding?.modelPolicyState);
  const argonForceEnabled =
    binding?.modelPolicyState?.argonForceEnabled ?? binding?.settings?.argon_force_enabled === true;
  const allModelsEnabled =
    binding?.modelPolicyState?.allModelsEnabled ?? binding?.settings?.all_models_enabled === true;
  const modelSwitchDisabled =
    props.disableControls ||
    busy ||
    binding?.revision === undefined ||
    !String(file.authIndex ?? '').trim();
  const status = file.disabled
    ? 'disabled'
    : parentDisabled
      ? 'account_disabled'
      : unavailable
        ? 'unavailable'
        : file.status === 'active' || file.status === 'ok'
          ? 'available'
          : 'ready';
  const saveCollection = async (patch: EnterpriseCollectionPatch) => {
    if (request.current || props.disableControls || !binding?.bindingId) return;
    const controller = new AbortController();
    request.current = controller;
    const revision = apiClient.getConnectionRevision();
    const current = () =>
      !controller.signal.aborted && revision === apiClient.getConnectionRevision();
    setBusy(true);
    try {
      await geminiEnterpriseApi.updateCollection(file, patch, controller.signal);
      if (current()) await props.onEnterpriseResourcesSaved?.(file);
    } catch {
      if (current()) {
        useNotificationStore
          .getState()
          .showNotification(t('gemini_enterprise.collections.update_error'), 'error');
        await props.onEnterpriseResourcesSaved?.(file);
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  };
  const switchCollection = (enabled: boolean) => {
    if (busy || props.disableControls) return;
    if (binding?.bindingId) void saveCollection({ disabled: !enabled });
    else props.onToggleStatus(file, enabled);
  };
  return (
    <>
      <tr
        className={styles.mainRow}
        data-binding-id={binding?.bindingId}
        data-subscription-tone={subscriptionTone}
      >
        <td>
          <strong className={styles.resourceName} title={enterpriseCollectionName(file)}>
            {enterpriseCollectionName(file) || t('gemini_enterprise.collections.unnamed_project')}
          </strong>
          <div className={styles.resourceMeta}>
            {binding?.projectName && <span className={styles.mono}>{binding.projectId}</span>}
            <span className={styles.region}>{binding?.location || 'global'}</span>
          </div>
          <EnterpriseModelPolicyStatus snapshot={binding?.modelPolicyState} compact />
          {unknownReason && (
            <small className={styles.subscriptionReason} role="status">
              {t('gemini_enterprise.policy.reason_' + unknownReason, {
                defaultValue: unknownReason,
              })}
            </small>
          )}
          {enterpriseHydrogenSupported(file) && (
            <small className="hint">
              {t(
                'gemini_enterprise.hydrogen.' +
                  (enterpriseHydrogenAdmission(file)?.enabled ? 'enabled' : 'disabled')
              )}
              {' · '}
              {t(
                'gemini_enterprise.hydrogen.' +
                  (enterpriseHydrogenAdmission(file)?.available ? 'available' : 'unavailable')
              )}
            </small>
          )}
        </td>
        <td>
          <GeminiEnterpriseQuota file={file} disableControls={props.disableControls} compact />
        </td>
        <td className={styles.rowActions}>
          <div className={styles.rowControls}>
            <div className={styles.switchRow}>
              <ToggleSwitch
                checked={!file.disabled}
                onChange={switchCollection}
                disabled={
                  props.disableControls ||
                  busy ||
                  (!binding?.bindingId && props.statusUpdating[getAuthFileRefreshKey(file)]) ||
                  (Boolean(binding?.bindingId) && binding?.revision === undefined)
                }
                ariaLabel={t('gemini_enterprise.collections.toggle_collection', {
                  name: enterpriseCollectionName(file),
                  region: binding?.location,
                })}
              />
              <span
                title={
                  routingPaused
                    ? t('gemini_enterprise.policy.paused')
                    : t('gemini_enterprise.collections.' + status)
                }
              >
                {routingPaused
                  ? t('gemini_enterprise.policy.routing_paused')
                  : t('gemini_enterprise.collections.' + status)}
              </span>
            </div>
            {binding?.argonForceSupported === true && binding.bindingId && (
              <div className={styles.modelSwitchRow}>
                <ToggleSwitch
                  checked={argonForceEnabled}
                  label={t('gemini_enterprise.policy.force_argon')}
                  onChange={(enabled) =>
                    void saveCollection({ fields: { argon_force_enabled: enabled } })
                  }
                  disabled={modelSwitchDisabled}
                />
              </div>
            )}
            {binding?.allModelsSupported === true && binding.bindingId && (
              <div className={styles.modelSwitchRow}>
                <ToggleSwitch
                  checked={allModelsEnabled}
                  label={t('gemini_enterprise.policy.all_models')}
                  onChange={(enabled) =>
                    void saveCollection({ fields: { all_models_enabled: enabled } })
                  }
                  disabled={modelSwitchDisabled}
                />
              </div>
            )}
            <div className={styles.rowButtons}>
              <Button
                size="sm"
                variant="ghost"
                disabled={props.disableControls || busy}
                onClick={() => props.onShowModels(file)}
              >
                {t('gemini_enterprise.collections.models')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={expanded}
                aria-controls={detailId}
                onClick={() => setExpanded((previous) => !previous)}
              >
                {t('gemini_enterprise.collections.details')}
              </Button>
            </div>
          </div>
        </td>
      </tr>
      <tr className={styles.requestsRow} data-subscription-tone={subscriptionTone}>
        <td colSpan={3}>
          <div className={styles.requests}>
            <div className={styles.requestHeading}>
              <span>{t('gemini_enterprise.collections.requests')}</span>
              <span className={styles.counts}>
                <span title={t('gemini_enterprise.collections.success')}>
                  {t('status_bar.success_short')}{' '}
                  <strong className={styles.success}>
                    {(file.successCount ?? 0).toLocaleString(i18n.resolvedLanguage)}
                  </strong>
                </span>
                <span title={t('gemini_enterprise.collections.failure')}>
                  {t('status_bar.failure_short')}{' '}
                  <strong className={styles.failure}>
                    {(file.failureCount ?? 0).toLocaleString(i18n.resolvedLanguage)}
                  </strong>
                </span>
              </span>
            </div>
            <div className={styles.recent} title={t('gemini_enterprise.collections.recent_window')}>
              <div className={styles.bars}>
                <ProviderStatusBar
                  statusData={statusData}
                  styles={{
                    ...statusStyles,
                    statusRate: styles.hiddenRate,
                    statusBlock: styles.requestBlock,
                  }}
                />
              </div>
              <span>
                {t('gemini_enterprise.collections.recent_rate')}{' '}
                <strong className={hasRecent ? styles.success : ''}>
                  {hasRecent ? statusData.successRate.toFixed(1) + '%' : '—'}
                </strong>
              </span>
            </div>
          </div>
          {expanded && (
            <div id={detailId} className={styles.details}>
              {file.statusMessage && <p role="status">{file.statusMessage}</p>}
              <GeminiEnterpriseBinding binding={binding} />
              <EnterpriseCatalogStatus snapshot={binding?.modelPolicyState} />
              {(binding?.accountManagementSupported || binding?.resourceEditSupported) && (
                <GeminiEnterpriseRegionEditor
                  key={identity}
                  file={file}
                  disabled={props.disableControls || busy}
                  onSaved={props.onEnterpriseResourcesSaved}
                />
              )}
              <AuthFileCooldownSection snapshot={file.cooldownSnapshot} />
              <Button
                size="sm"
                variant="secondary"
                disabled={props.disableControls || busy}
                onClick={() => props.onOpenPrefixProxyEditor(file)}
              >
                {t('auth_files.prefix_proxy_button')}
              </Button>
            </div>
          )}
        </td>
      </tr>
    </>
  );
}

export function GeminiEnterpriseAccount(props: Props) {
  const { t } = useTranslation();
  const { file, disableControls } = props;
  const [expanded, setExpanded] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<EnterpriseCollectionGroupKind>>(
    () => new Set(['trial'])
  );
  const [discovering, setDiscovering] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const rowsId = useId();
  const children = useMemo(() => enterpriseCollectionFiles(file), [file]);
  const groups = useMemo(() => groupEnterpriseCollections(children), [children]);
  const projectCount = new Set(children.map((child) => child.geminiEnterprise?.projectId)).size;
  const hydrogenSummary = enterpriseHydrogenSummary(children);
  const account = file.geminiEnterprise;
  const hydrogenOperations = useEnterpriseHydrogenOperations(
    file,
    props.onEnterpriseResourcesSaved
  );
  const discover = async () => {
    if (disableControls || discovering) return;
    const controller = new AbortController();
    request.current = controller;
    const revision = apiClient.getConnectionRevision();
    const current = () =>
      !controller.signal.aborted && revision === apiClient.getConnectionRevision();
    setDiscovering(true);
    try {
      const result = await geminiEnterpriseApi.discover(file, controller.signal);
      if (!current()) return;
      useNotificationStore.getState().showNotification(
        t(
          'gemini_enterprise.collections.' +
            (result.status === 'partial' ? 'discovered_partial' : 'discovered'),
          {
            projects: result.addedProjectCount,
            collections: result.addedCollectionCount,
          }
        ),
        result.status === 'partial' ? 'warning' : 'success'
      );
      await props.onEnterpriseResourcesSaved?.(file);
    } catch {
      if (current())
        useNotificationStore
          .getState()
          .showNotification(t('gemini_enterprise.collections.discover_error'), 'error');
      if (current()) await props.onEnterpriseResourcesSaved?.(file);
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
          aria-label={t('gemini_enterprise.collections.expand_account')}
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
          ariaLabel={t('gemini_enterprise.collections.select_account', {
            name: file.email || file.name,
          })}
        />
        <div className={styles.identity}>
          <h2 title={file.email || file.name}>{file.email || file.name}</h2>
          <p title={file.name}>{file.name}</p>
          {hydrogenSummary.supported && (
            <p>{t('gemini_enterprise.hydrogen.summary', hydrogenSummary)}</p>
          )}
        </div>
        <div className={styles.accountActions}>
          <Button
            size="sm"
            variant="secondary"
            loading={discovering}
            disabled={disableControls || discovering || !account?.accountManagementSupported}
            onClick={() => void discover()}
            title={t('gemini_enterprise.collections.discover')}
            aria-label={t('gemini_enterprise.collections.discover')}
          >
            <IconRefreshCw size={13} />
            <span className={styles.discoverLabel}>
              {t('gemini_enterprise.collections.discover')}
            </span>
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
          {t('gemini_enterprise.collections.count', {
            projects: projectCount,
            collections: children.length,
          })}
        </span>
        {account?.hasRefreshToken !== undefined && (
          <span>
            {t(
              'gemini_enterprise.' + (account.hasRefreshToken ? 'renewal_ready' : 'renewal_missing')
            )}
          </span>
        )}
        <ToggleSwitch
          checked={!file.disabled}
          disabled={disableControls || props.statusUpdating[getAuthFileRefreshKey(file)]}
          label={t('gemini_enterprise.collections.account_enabled')}
          onChange={(enabled) => props.onToggleStatus(file, enabled)}
        />
      </div>
      <div className={styles.hydrogenActions}>
        <Button
          size="sm"
          variant="secondary"
          disabled={
            disableControls ||
            hydrogenOperations.busy ||
            discovering ||
            !account?.googleHydrogenConfigureSupported ||
            !children.length
          }
          onClick={() => void hydrogenOperations.start('configure')}
          aria-describedby={`${rowsId}-hydrogen-hint`}
        >
          {t('gemini_enterprise.hydrogen_batch.configure')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={
            disableControls ||
            hydrogenOperations.busy ||
            discovering ||
            !hydrogenSummary.supported ||
            !children.length ||
            file.disabled === true
          }
          onClick={() => void hydrogenOperations.start('test')}
        >
          {t('gemini_enterprise.hydrogen_batch.test')}
        </Button>
        <p id={`${rowsId}-hydrogen-hint`} className="hint">
          {t('gemini_enterprise.hydrogen_batch.remote_warning')}
        </p>
        {!account?.googleHydrogenConfigureSupported && (
          <p className="hint">{t('gemini_enterprise.hydrogen_batch.unsupported')}</p>
        )}
      </div>
      <EnterpriseHydrogenOperationsModal
        {...hydrogenOperations}
        disabled={disableControls}
        onCancel={hydrogenOperations.cancel}
        onClose={hydrogenOperations.close}
        onChange={(target, enabled) => void hydrogenOperations.changeEnabled(target, enabled)}
        onShowModels={(target) => {
          hydrogenOperations.close();
          props.onShowModels(target);
        }}
      />
      {expanded && (
        <div id={rowsId}>
          {children.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {['resource_region', 'quota', 'status_actions'].map((column) => (
                      <th key={column} scope="col">
                        {t('gemini_enterprise.collections.' + column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                {groups.map((group) => {
                  const groupId = rowsId + '-' + group.kind;
                  const groupExpanded = !collapsedGroups.has(group.kind);
                  return (
                    <Fragment key={group.kind}>
                      <tbody>
                        <tr className={styles.groupHeading} data-subscription-group={group.kind}>
                          <td colSpan={3}>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className={styles.groupToggle}
                              aria-expanded={groupExpanded}
                              aria-controls={groupId}
                              onClick={() =>
                                setCollapsedGroups((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(group.kind)) next.delete(group.kind);
                                  else next.add(group.kind);
                                  return next;
                                })
                              }
                            >
                              <IconChevronDown
                                size={14}
                                aria-hidden="true"
                                style={{
                                  transform: groupExpanded ? undefined : 'rotate(-90deg)',
                                }}
                              />
                              <span className={styles.groupLabel}>
                                {t('gemini_enterprise.collections.group_' + group.kind, {
                                  count: group.files.length,
                                })}
                              </span>
                              <span className={styles.groupAction}>
                                {t(
                                  'gemini_enterprise.collections.' +
                                    (groupExpanded ? 'collapse_group' : 'expand_group')
                                )}
                              </span>
                            </Button>
                          </td>
                        </tr>
                      </tbody>
                      <tbody id={groupId} className={styles.groupRows} hidden={!groupExpanded}>
                        {group.files.map((child) => (
                          <CollectionRows
                            key={enterpriseCollectionIdentity(child)}
                            file={child}
                            parentDisabled={file.disabled === true}
                            props={props}
                          />
                        ))}
                      </tbody>
                    </Fragment>
                  );
                })}
              </table>
            </div>
          ) : (
            <p className={styles.empty}>{t('gemini_enterprise.collections.empty')}</p>
          )}
          <EnterpriseDiscoveryStatus account={account} />
        </div>
      )}
    </article>
  );
}
