import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Select } from '@/components/ui/Select';
import { useConfigStore, useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import {
  geminiManagementApi,
  isGeminiConfigConflict,
  type GeminiSnapshot,
  type GeminiBatchAction,
  type GeminiTarget,
} from '@/services/api/geminiManagement';
import { getErrorMessage } from '@/utils/helpers';
import {
  filterGeminiResources,
  getGeminiTarget,
  geminiTargetId,
  paginateGeminiResources,
  selectGeminiTargets,
  toGeminiGroupTargets,
} from '../geminiManagement';
import type { ProviderFilterState } from '../uiState';
import { PROVIDER_DESCRIPTORS } from '../descriptors';
import { ProviderResourcePanel, type ProviderResourcePanelProps } from './ProviderResourcePanel';
import { GeminiBatchPatchDialog } from './GeminiBatchPatchDialog';
import styles from './GeminiResourcePanel.module.scss';

interface GeminiResourcePanelProps extends ProviderResourcePanelProps {
  snapshot: GeminiSnapshot | null;
  snapshotLoading: boolean;
  snapshotError: unknown;
  onReload: () => Promise<unknown>;
  preferences: ProviderFilterState;
  onPreferences: (patch: Partial<ProviderFilterState>) => void;
}

export function GeminiResourcePanel({
  snapshot,
  snapshotLoading,
  snapshotError,
  onReload,
  preferences,
  onPreferences,
  ...panel
}: GeminiResourcePanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const id = useId();
  const { showConfirmation, showNotification } = useNotificationStore();
  const clearCache = useConfigStore((state) => state.clearCache);
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionRevision, setSelectionRevision] = useState(snapshot?.revision);
  const currentSelection = useMemo(
    () => (selectionRevision === snapshot?.revision ? selected : new Set<string>()),
    [selected, selectionRevision, snapshot?.revision]
  );
  const [busy, setBusy] = useState(false);
  const [patchOpen, setPatchOpen] = useState(false);
  const revisionRef = useRef(snapshot?.revision);
  useLayoutEffect(() => {
    revisionRef.current = snapshot?.revision;
  }, [snapshot?.revision]);
  const compact = preferences.compact ?? false;
  const pageSize = preferences.pageSize ?? 25;
  const selectable =
    Boolean(snapshot?.capabilities.batch) && !snapshotLoading && !panel.disableMutations && !busy;

  useEffect(() => {
    setSelected(new Set());
    setSelectionRevision(snapshot?.revision);
    setPatchOpen(false);
    setBusy(false);
  }, [snapshot?.revision]);
  useEffect(() => {
    setPage(1);
  }, [panel.filter, groupFilter, statusFilter, pageSize, panel.toolbarControls?.selectedModels]);

  const filtered = useMemo(
    () => filterGeminiResources(panel.filteredResources, groupFilter, statusFilter),
    [panel.filteredResources, groupFilter, statusFilter]
  );
  const { currentPage, totalPages, pageItems } = paginateGeminiResources(filtered, page, pageSize);
  const targets = selectGeminiTargets(currentSelection, panel.group.resources);
  const groupOptions = useMemo(
    () =>
      snapshot?.groups.map((group, groupIndex) => ({
        value: String(groupIndex),
        label: String(group.name ?? `#${groupIndex + 1}`),
      })) ??
      Array.from(
        new Map(
          panel.group.resources.map((resource) => [
            String(getGeminiTarget(resource)?.groupIndex ?? ''),
            {
              value: String(getGeminiTarget(resource)?.groupIndex ?? ''),
              label: resource.name ?? '',
            },
          ])
        ).values()
      ).filter((option) => option.value !== ''),
    [snapshot, panel.group.resources]
  );

  const selectResources = (resources: typeof filtered, checked: boolean) => {
    setSelected((old) => {
      const next = new Set(old);
      resources.forEach((resource) => {
        const target = getGeminiTarget(resource);
        if (!target) return;
        if (checked) next.add(geminiTargetId(target));
        else next.delete(geminiTargetId(target));
      });
      return next;
    });
  };

  const performBatch = async (
    expectedRevision: string,
    connectionRevision: number,
    action: GeminiBatchAction,
    desiredTargets: GeminiTarget[],
    changes?: Record<string, unknown>
  ) => {
    if (connectionRevision !== apiClient.getConnectionRevision()) return;
    if (revisionRef.current !== expectedRevision) {
      showNotification(t('gemini_management.conflict'), 'warning');
      return;
    }
    setBusy(true);
    try {
      await geminiManagementApi.batch(expectedRevision, action, desiredTargets, changes);
      if (connectionRevision !== apiClient.getConnectionRevision()) return;
      setSelected(new Set());
      clearCache('gemini-api-key');
      await onReload();
      if (connectionRevision === apiClient.getConnectionRevision())
        showNotification(t('gemini_management.updated'), 'success');
    } catch (error: unknown) {
      if (connectionRevision !== apiClient.getConnectionRevision()) return;
      if (isGeminiConfigConflict(error)) {
        setSelected(new Set());
        await onReload();
        if (connectionRevision === apiClient.getConnectionRevision())
          showNotification(t('gemini_management.conflict'), 'warning');
      } else {
        showNotification(getErrorMessage(error), 'error');
        throw error;
      }
    } finally {
      if (connectionRevision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };

  const confirmBatch = (
    action: GeminiBatchAction,
    desiredTargets: GeminiTarget[] = targets,
    changes?: Record<string, unknown>
  ) => {
    if (!snapshot || desiredTargets.length === 0) return;
    const expectedRevision = snapshot.revision;
    const connectionRevision = apiClient.getConnectionRevision();
    const selectedLabels = desiredTargets.map((target) => {
      const group = snapshot.groups[target.groupIndex];
      if (target.keyIndex === undefined) return String(group?.name ?? `#${target.groupIndex + 1}`);
      const resource = panel.group.resources.find((entry) => {
        const current = getGeminiTarget(entry);
        return current && geminiTargetId(current) === geminiTargetId(target);
      });
      return `${resource?.name ?? ''} · ${resource?.apiKeyPreview ?? '#'}`;
    });
    const affected = desiredTargets.reduce(
      (count, target) =>
        count +
        (target.keyIndex === undefined && Array.isArray(snapshot.groups[target.groupIndex]?.keys)
          ? (snapshot.groups[target.groupIndex].keys as unknown[]).length
          : 1),
      0
    );
    setPatchOpen(false);
    showConfirmation({
      title: t(`gemini_management.${action === 'patch' ? 'patch' : action}`),
      message: (
        <div>
          <p>{t('gemini_management.confirmCount', { count: affected })}</p>
          <ul className={styles.preview}>
            {selectedLabels.map((label, index) => (
              <li key={index}>{label}</li>
            ))}
          </ul>
          {changes && <pre className={styles.preview}>{JSON.stringify(changes, null, 2)}</pre>}
        </div>
      ),
      variant: action === 'delete' ? 'danger' : 'primary',
      onConfirm: () =>
        performBatch(expectedRevision, connectionRevision, action, desiredTargets, changes),
    });
  };

  const extraToolbar = (
    <div className={styles.controls}>
      <label className={styles.field} htmlFor={`${id}-group`}>
        {t('gemini_management.group')}
        <Select
          id={`${id}-group`}
          value={groupFilter}
          onChange={setGroupFilter}
          ariaLabel={t('gemini_management.group')}
          options={[{ value: '', label: t('gemini_management.allGroups') }, ...groupOptions]}
        />
      </label>
      <label className={styles.field} htmlFor={`${id}-status`}>
        {t('gemini_management.status')}
        <Select
          id={`${id}-status`}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as typeof statusFilter)}
          ariaLabel={t('gemini_management.status')}
          options={[
            { value: 'all', label: t('gemini_management.allStatuses') },
            { value: 'enabled', label: t('gemini_management.enabled') },
            { value: 'disabled', label: t('gemini_management.disabled') },
          ]}
        />
      </label>
      <ToggleSwitch
        label={t('gemini_management.compact')}
        checked={compact}
        onChange={(value) => onPreferences({ compact: value })}
      />
      {PROVIDER_DESCRIPTORS[panel.group.id].supportsGlobalModelAliases && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate('/ai-providers/model-alias?provider=gemini')}
        >
          {t('gemini_management.aliases')}
        </Button>
      )}
      {(snapshotError !== null || (snapshot && !snapshot.capabilities.batch)) && (
        <p className={styles.message} role="status">
          {t('gemini_management.unavailable')}{' '}
          <Button size="sm" variant="ghost" onClick={() => void onReload()}>
            {t('common.refresh')}
          </Button>
        </p>
      )}
      <p className={styles.message}>{t('gemini_management.recentWindow')}</p>
      <div className={styles.actions}>
        <span aria-live="polite">{t('gemini_management.selected', { count: targets.length })}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectable || pageItems.length === 0}
          onClick={() => selectResources(pageItems, true)}
        >
          {t('gemini_management.selectPage')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectable || filtered.length === 0}
          onClick={() => selectResources(filtered, true)}
        >
          {t('gemini_management.selectFiltered')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={targets.length === 0 || busy}
          onClick={() => setSelected(new Set())}
        >
          {t('gemini_management.clearSelection')}
        </Button>
        <Button
          size="sm"
          disabled={!selectable || targets.length === 0}
          onClick={() => confirmBatch('enable')}
        >
          {t('gemini_management.enable')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectable || targets.length === 0}
          onClick={() => confirmBatch('disable')}
        >
          {t('gemini_management.disable')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectable || targets.length === 0}
          onClick={() => setPatchOpen(true)}
        >
          {t('gemini_management.patch')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!selectable || targets.length === 0}
          onClick={() => confirmBatch('delete')}
        >
          {t('gemini_management.delete')}
        </Button>
      </div>
    </div>
  );

  const footer = (
    <div className={styles.pagination}>
      <label className={styles.field} htmlFor={`${id}-size`}>
        {t('gemini_management.pageSize')}
        <Select
          id={`${id}-size`}
          value={String(pageSize)}
          ariaLabel={t('gemini_management.pageSize')}
          onChange={(value) => onPreferences({ pageSize: Number(value) })}
          options={[25, 50, 100].map((size) => ({ value: String(size), label: String(size) }))}
        />
      </label>
      <span>
        {t('gemini_management.pageInfo', {
          current: currentPage,
          total: totalPages,
          count: filtered.length,
        })}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={currentPage <= 1}
        onClick={() => setPage(currentPage - 1)}
      >
        {t('auth_files.pagination_prev')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={currentPage >= totalPages}
        onClick={() => setPage(currentPage + 1)}
      >
        {t('auth_files.pagination_next')}
      </Button>
    </div>
  );

  return (
    <>
      <ProviderResourcePanel
        {...panel}
        filteredResources={pageItems}
        extraToolbar={extraToolbar}
        disableMutations={panel.disableMutations || busy || !snapshot?.capabilities.batch}
        onDelete={(resource) => {
          const target = getGeminiTarget(resource);
          if (target && selectable) confirmBatch('delete', [target]);
        }}
        onToggleDisabled={(resource, disabled) => {
          const target = getGeminiTarget(resource);
          if (target && selectable && snapshot)
            void performBatch(
              snapshot.revision,
              apiClient.getConnectionRevision(),
              disabled ? 'disable' : 'enable',
              [target]
            ).catch(() => undefined);
        }}
        footer={footer}
        compact={compact}
        aliasCount={snapshot?.aliases.length}
        selection={{
          selected: currentSelection,
          disabled: !selectable,
          getId: (resource) => {
            const target = getGeminiTarget(resource);
            return target ? geminiTargetId(target) : resource.id;
          },
          onToggle: (resource, checked) => selectResources([resource], checked),
          onTogglePage: (checked) => selectResources(pageItems, checked),
        }}
      />
      {patchOpen && (
        <GeminiBatchPatchDialog
          onClose={() => setPatchOpen(false)}
          onPreview={(scope, changes) =>
            confirmBatch(
              'patch',
              scope === 'groups' ? toGeminiGroupTargets(targets) : targets,
              changes
            )
          }
        />
      )}
    </>
  );
}
