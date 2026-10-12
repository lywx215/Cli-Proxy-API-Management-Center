import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
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
import { isRecord } from '@/utils/helpers';
import type { GeminiKeyConfig } from '@/types';
import type { ProviderResource } from '../types';
import {
  GEMINI_SHARED_FIELDS,
  appendGeminiKeys,
  findGeminiMergeCandidates,
  getGeminiGroupKeys,
  getGeminiMergeDiagnostics,
  mergeGeminiGroups,
  patchGeminiGroups,
  patchGeminiKey,
  rebaseGeminiTargets,
  restoreGeminiInheritance,
} from '../geminiGroups';
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
import {
  GeminiGroupEditorDialog,
  GeminiKeyImportDialog,
  GeminiKeyInheritanceDialog,
} from './GeminiGroupDialogs';
import { GeminiGroupedResources } from './GeminiGroupedResources';
import { maskGeminiImportKey } from './GeminiGroupDialogDraft';
import styles from './GeminiResourcePanel.module.scss';

interface GeminiResourcePanelProps extends ProviderResourcePanelProps {
  createRequest?: number;
  editRequest?: { id: number; resource: ProviderResource } | null;
  onRequestsConsumed?: (createId?: number, editId?: number) => void;
  snapshot: GeminiSnapshot | null;
  snapshotLoading: boolean;
  snapshotError: unknown;
  onReload: () => Promise<unknown>;
  preferences: ProviderFilterState;
  onPreferences: (patch: Partial<ProviderFilterState>) => void;
}

interface GroupDialogState {
  kind: 'import' | 'group' | 'key' | 'restore' | 'merge' | 'patch';
  source: GeminiSnapshot;
  targets: GeminiTarget[];
  connectionRevision: number;
}

export function GeminiResourcePanel({
  snapshot,
  snapshotLoading,
  snapshotError,
  onReload,
  preferences,
  onPreferences,
  createRequest = 0,
  editRequest,
  onRequestsConsumed,
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
  const [dialog, setDialog] = useState<GroupDialogState | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [dialogConflict, setDialogConflict] = useState(false);
  const [restoreFields, setRestoreFields] = useState<Set<string>>(new Set(['models']));
  const [mergeCandidate, setMergeCandidate] = useState(0);
  const [focusGroup, setFocusGroup] = useState<number | undefined>();
  const dialogRef = useRef(dialog);
  const mutationRef = useRef(false);
  const seenCreate = useRef(0);
  const seenEdit = useRef(0);
  const connectionRef = useRef(apiClient.getConnectionRevision());
  const connectionRevision = apiClient.getConnectionRevision();
  const revisionRef = useRef(snapshot?.revision);
  useLayoutEffect(() => {
    revisionRef.current = snapshot?.revision;
    dialogRef.current = dialog;
  }, [snapshot?.revision, dialog]);
  const compact = preferences.compact ?? false;
  const pageSize = preferences.pageSize ?? 25;
  const selectable =
    Boolean(snapshot?.capabilities.batch) && !snapshotLoading && !panel.disableMutations && !busy;

  useEffect(() => {
    setSelected(new Set());
    setSelectionRevision(snapshot?.revision);
  }, [snapshot?.revision]);
  useEffect(() => {
    if (connectionRef.current === connectionRevision) return;
    connectionRef.current = connectionRevision;
    setDialog(null);
    setDialogError('');
    setDialogConflict(false);
    setSelected(new Set());
  }, [connectionRevision]);
  useEffect(() => {
    if (!snapshot || snapshotLoading || panel.disableMutations || busy) return;
    if (createRequest > seenCreate.current) {
      seenCreate.current = createRequest;
      setDialog({
        kind: snapshot.groups.length ? 'import' : 'group',
        source: snapshot,
        targets: [],
        connectionRevision: apiClient.getConnectionRevision(),
      });
      setDialogError('');
      setDialogConflict(false);
      onRequestsConsumed?.(createRequest);
    }
    if (editRequest && editRequest.id > seenEdit.current) {
      seenEdit.current = editRequest.id;
      const source = (editRequest.resource.raw as GeminiKeyConfig).source;
      try {
        if (!source || source.keyIndex === undefined) throw new Error('Missing Key identity.');
        const [target] = rebaseGeminiTargets([source.group], snapshot.groups, [
          { groupIndex: 0, keyIndex: source.keyIndex },
        ]);
        setDialog({
          kind: 'key',
          source: snapshot,
          targets: [target],
          connectionRevision: apiClient.getConnectionRevision(),
        });
        setDialogError('');
        setDialogConflict(false);
      } catch {
        showNotification(t('gemini_groups.conflict'), 'warning');
      }
      onRequestsConsumed?.(undefined, editRequest.id);
    }
  }, [
    createRequest,
    editRequest,
    panel.disableMutations,
    snapshot,
    snapshotLoading,
    busy,
    onRequestsConsumed,
    showNotification,
    t,
  ]);
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

  const openDialog = (kind: GroupDialogState['kind'], desiredTargets: GeminiTarget[] = []) => {
    if (!snapshot || !selectable) return;
    setDialog({
      kind: kind === 'import' && !snapshot.groups.length ? 'group' : kind,
      source: snapshot,
      targets: desiredTargets,
      connectionRevision: apiClient.getConnectionRevision(),
    });
    setDialogError('');
    setDialogConflict(false);
    setMergeCandidate(0);
    setRestoreFields(new Set(['models']));
  };
  const closeDialog = () => {
    if (mutationRef.current) return;
    setDialog(null);
    setDialogError('');
    setDialogConflict(false);
  };
  const repreview = async () => {
    const context = dialogRef.current;
    if (
      !context ||
      mutationRef.current ||
      context.connectionRevision !== apiClient.getConnectionRevision()
    )
      return;
    setBusy(true);
    try {
      const latest = await geminiManagementApi.snapshot();
      if (
        dialogRef.current !== context ||
        context.connectionRevision !== apiClient.getConnectionRevision()
      )
        return;
      let nextTargets: GeminiTarget[];
      try {
        nextTargets = rebaseGeminiTargets(context.source.groups, latest.groups, context.targets);
      } catch {
        if (context.kind !== 'import') {
          setDialogError(t('gemini_groups.targetChanged'));
          setDialogConflict(true);
          return;
        }
        // Keep the import text in memory, but require an explicit target selection.
        nextTargets = [];
      }
      setDialog({ ...context, source: latest, targets: nextTargets });
      setDialogError('');
      setDialogConflict(false);
      setMergeCandidate(0);
      await onReload();
      showNotification(t('gemini_groups.repreviewed'), 'info');
    } catch {
      if (context.connectionRevision === apiClient.getConnectionRevision()) {
        setDialogError(t('gemini_groups.invalidInput'));
        setDialogConflict(true);
      }
    } finally {
      if (context.connectionRevision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };
  const saveGroups = async (
    transform: (groups: Record<string, unknown>[]) => Record<string, unknown>[],
    afterSave?: (latest: GeminiSnapshot | null, submitted: Record<string, unknown>[]) => void
  ) => {
    const context = dialogRef.current;
    if (
      !context ||
      mutationRef.current ||
      context.connectionRevision !== apiClient.getConnectionRevision()
    )
      return;
    if (dialogConflict || revisionRef.current !== context.source.revision) {
      setDialogConflict(true);
      setDialogError(t('gemini_groups.conflict'));
      throw new Error(t('gemini_groups.conflict'));
    }
    mutationRef.current = true;
    setBusy(true);
    setDialogError('');
    let submitted = false;
    try {
      const next = transform(context.source.groups);
      submitted = true;
      await geminiManagementApi.saveGroups(context.source.revision, next);
      if (context.connectionRevision !== apiClient.getConnectionRevision()) return;
      setDialog(null);
      setDialogConflict(false);
      setSelected(new Set());
      clearCache('gemini-api-key');
      showNotification(
        `${t('gemini_groups.saved')} ${t('gemini_groups.serverReloadHint')}`,
        'success'
      );
      let latest: GeminiSnapshot | null = null;
      try {
        const result = await onReload();
        if (isRecord(result) && typeof result.revision === 'string' && Array.isArray(result.groups))
          latest = result as unknown as GeminiSnapshot;
        if (!latest) showNotification(t('gemini_groups.serverReloadHint'), 'warning');
      } catch {
        showNotification(t('gemini_groups.serverReloadHint'), 'warning');
      }
      if (context.connectionRevision === apiClient.getConnectionRevision())
        afterSave?.(latest, next);
    } catch (error: unknown) {
      if (context.connectionRevision !== apiClient.getConnectionRevision()) return;
      const conflict = isGeminiConfigConflict(error);
      const text = t(
        conflict
          ? 'gemini_groups.conflict'
          : submitted &&
              (!isRecord(error) || error.status === undefined || Number(error.status) >= 500)
            ? 'gemini_groups.unknownResult'
            : 'gemini_groups.invalidInput'
      );
      setDialogConflict(conflict);
      setDialogError(text);
      const failure: Error & { cause?: unknown } = new Error(text);
      failure.cause = error;
      throw failure;
    } finally {
      mutationRef.current = false;
      if (context.connectionRevision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };
  const onEditKey = (resource: ProviderResource) => {
    const target = getGeminiTarget(resource);
    if (target) openDialog('key', [target]);
  };
  const revealGroup = (index: number) => {
    setFocusGroup(index);
    setGroupFilter('');
    setStatusFilter('all');
    panel.onFilterChange('');
    panel.toolbarControls?.onSelectedModelsChange(new Set());
    onPreferences({ viewMode: 'groups' });
  };

  const performBatch = async (
    expectedRevision: string,
    connectionRevision: number,
    action: GeminiBatchAction,
    desiredTargets: GeminiTarget[],
    changes?: Record<string, unknown>
  ) => {
    if (connectionRevision !== apiClient.getConnectionRevision() || mutationRef.current) return;
    if (revisionRef.current !== expectedRevision) {
      showNotification(t('gemini_management.conflict'), 'warning');
      if (action === 'patch') {
        setDialogError(t('gemini_groups.conflict'));
        setDialogConflict(true);
      }
      return;
    }
    mutationRef.current = true;
    setBusy(true);
    try {
      await geminiManagementApi.batch(expectedRevision, action, desiredTargets, changes);
      if (connectionRevision !== apiClient.getConnectionRevision()) return;
      setSelected(new Set());
      if (action === 'patch') setDialog(null);
      clearCache('gemini-api-key');
      await onReload();
      if (connectionRevision === apiClient.getConnectionRevision())
        showNotification(t('gemini_management.updated'), 'success');
    } catch (error: unknown) {
      if (connectionRevision !== apiClient.getConnectionRevision()) return;
      if (isGeminiConfigConflict(error)) {
        if (action === 'patch') {
          setDialogError(t('gemini_groups.conflict'));
          setDialogConflict(true);
        } else setSelected(new Set());
        await onReload();
        if (connectionRevision === apiClient.getConnectionRevision())
          showNotification(t('gemini_management.conflict'), 'warning');
      } else {
        showNotification(t('gemini_groups.invalidInput'), 'error');
      }
    } finally {
      mutationRef.current = false;
      if (connectionRevision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };

  const confirmBatch = (
    action: GeminiBatchAction,
    desiredTargets: GeminiTarget[] = targets,
    changes?: Record<string, unknown>
  ) => {
    if (!snapshot || desiredTargets.length === 0) return;
    const expectedRevision =
      action === 'patch' && dialog ? dialog.source.revision : snapshot.revision;
    const connectionRevision = apiClient.getConnectionRevision();
    const selectedLabels = desiredTargets.map((target) => {
      const group = snapshot.groups[target.groupIndex];
      if (target.keyIndex === undefined) return String(group?.name ?? `#${target.groupIndex + 1}`);
      const resource = panel.group.resources.find((entry) => {
        const current = getGeminiTarget(entry);
        return current && geminiTargetId(current) === geminiTargetId(target);
      });
      return `${resource?.name ?? ''} · ${maskGeminiImportKey(resource?.apiKey ?? '')}`;
    });
    const affected = desiredTargets.reduce(
      (count, target) =>
        count +
        (target.keyIndex === undefined && Array.isArray(snapshot.groups[target.groupIndex]?.keys)
          ? (snapshot.groups[target.groupIndex].keys as unknown[]).length
          : 1),
      0
    );
    showConfirmation({
      title: t(`gemini_management.${action === 'patch' ? 'patch' : action}`),
      message: (
        <div>
          <p>{t('gemini_management.confirmCount', { count: affected })}</p>
          <ul className={styles.preview}>
            {selectedLabels.slice(0, 20).map((label, index) => (
              <li key={index}>{label}</li>
            ))}
          </ul>
          {selectedLabels.length > 20 && (
            <p>{t('gemini_groups.remainingPreview', { count: selectedLabels.length - 20 })}</p>
          )}
          {changes && (
            <p>
              {Object.keys(changes)
                .map((field) => t(`gemini_groups.field.${field}`))
                .join(' · ')}
            </p>
          )}
        </div>
      ),
      variant: action === 'delete' ? 'danger' : 'primary',
      onConfirm: () =>
        performBatch(expectedRevision, connectionRevision, action, desiredTargets, changes),
    });
  };

  const extraToolbar = (
    <div className={styles.controls}>
      <div className={styles.actions}>
        <Button size="sm" disabled={!selectable} onClick={() => openDialog('import')}>
          {t('gemini_groups.addKeys')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectable}
          onClick={() => openDialog('group')}
        >
          {t('gemini_groups.newGroup')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectable}
          onClick={() => openDialog('merge')}
        >
          {t('gemini_groups.mergeGroups')}
        </Button>
        <Button
          size="sm"
          variant={preferences.viewMode === 'keys' ? 'secondary' : 'primary'}
          aria-pressed={preferences.viewMode !== 'keys'}
          onClick={() => onPreferences({ viewMode: 'groups' })}
        >
          {t('gemini_groups.viewGroups')}
        </Button>
        <Button
          size="sm"
          variant={preferences.viewMode === 'keys' ? 'primary' : 'secondary'}
          aria-pressed={preferences.viewMode === 'keys'}
          onClick={() => onPreferences({ viewMode: 'keys' })}
        >
          {t('gemini_groups.viewKeys')}
        </Button>
      </div>
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
        {preferences.viewMode === 'keys' && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!selectable || pageItems.length === 0}
            onClick={() => selectResources(pageItems, true)}
          >
            {t('gemini_management.selectPage')}
          </Button>
        )}
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
          onClick={() => openDialog('patch', targets)}
        >
          {t('gemini_management.patch')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectable || targets.length === 0}
          onClick={() => openDialog('group', toGeminiGroupTargets(targets))}
        >
          {t('gemini_groups.editGroup')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectable || targets.length === 0}
          onClick={() => openDialog('restore', targets)}
        >
          {t('gemini_groups.restoreInheritance')}
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

  const pageSizeControl = (
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
  );
  const footer = (
    <div className={styles.pagination}>
      {pageSizeControl}
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
  const mergeCandidates = useMemo(
    () => (dialog?.kind === 'merge' ? findGeminiMergeCandidates(dialog.source.groups) : []),
    [dialog]
  );
  const candidate = mergeCandidates[mergeCandidate];
  const mergeDiagnostics = useMemo(
    () => (dialog?.kind === 'merge' ? getGeminiMergeDiagnostics(dialog.source.groups) : []),
    [dialog]
  );
  const mergeReasonLabels = {
    'group-settings': 'defaults',
    'key-settings': 'keys',
    'unknown-fields': 'unknown',
    'duplicate-identity': 'duplicate',
    empty: 'empty',
  };

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
        onCreate={() => openDialog('import')}
        onEdit={onEditKey}
        footer={
          preferences.viewMode === 'keys' ? (
            footer
          ) : (
            <div className={styles.pagination}>{pageSizeControl}</div>
          )
        }
        resourceContent={
          snapshot && preferences.viewMode !== 'keys' ? (
            <GeminiGroupedResources
              key={`${snapshot.revision}:${groupFilter}:${panel.filter}:${statusFilter}:${pageSize}:${focusGroup ?? ''}:${Array.from(panel.toolbarControls?.selectedModels ?? []).join(',')}`}
              groups={snapshot.groups}
              resources={panel.group.resources}
              filteredResources={filtered}
              includeEmpty={statusFilter === 'all' && !panel.toolbarControls?.selectedModels.size}
              groupFilter={groupFilter}
              nameFilter={panel.filter.toLowerCase()}
              pageSize={pageSize}
              compact={compact}
              aliasCount={snapshot.aliases.length}
              selected={currentSelection}
              disabled={!selectable}
              selectedId={panel.selectedId}
              focusGroup={focusGroup}
              usageByProvider={panel.usageByProvider}
              onSelect={selectResources}
              onAdd={(groupIndex) => openDialog('import', [{ groupIndex }])}
              onEditGroup={(groupIndex) => openDialog('group', [{ groupIndex }])}
              onView={panel.onView}
              onEdit={onEditKey}
              onDelete={(resource) => {
                const target = getGeminiTarget(resource);
                if (target && selectable) confirmBatch('delete', [target]);
              }}
              onToggle={(resource, disabled) => {
                const target = getGeminiTarget(resource);
                if (target && selectable)
                  void performBatch(
                    snapshot.revision,
                    apiClient.getConnectionRevision(),
                    disabled ? 'disable' : 'enable',
                    [target]
                  ).catch(() => undefined);
              }}
            />
          ) : undefined
        }
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
      {dialog?.kind === 'patch' && (
        <GeminiBatchPatchDialog
          onClose={closeDialog}
          conflict={dialogConflict}
          busy={busy}
          onReload={repreview}
          onPreview={(scope, changes) =>
            confirmBatch(
              'patch',
              scope === 'groups' ? toGeminiGroupTargets(dialog.targets) : dialog.targets,
              changes
            )
          }
        />
      )}
      {dialog?.kind === 'import' && (
        <GeminiKeyImportDialog
          groups={dialog.source.groups}
          initialGroupIndex={dialog.targets[0]?.groupIndex}
          disabled={busy || snapshotLoading || panel.disableMutations}
          error={dialogError}
          conflict={dialogConflict}
          onClose={closeDialog}
          onReload={repreview}
          onSave={(groupIndex, keys) =>
            saveGroups(
              (groups) => appendGeminiKeys(groups, groupIndex, keys),
              () => revealGroup(groupIndex)
            )
          }
        />
      )}
      {dialog?.kind === 'group' && (
        <GeminiGroupEditorDialog
          allowNameChange={dialog.targets.length < 2}
          groups={dialog.targets.map((target) => dialog.source.groups[target.groupIndex])}
          group={
            dialog.targets.length ? dialog.source.groups[dialog.targets[0].groupIndex] : undefined
          }
          affectedKeys={dialog.targets.reduce(
            (count, target) =>
              count + getGeminiGroupKeys(dialog.source.groups[target.groupIndex]).length,
            0
          )}
          disabled={busy || snapshotLoading || panel.disableMutations}
          error={dialogError}
          conflict={dialogConflict}
          onClose={closeDialog}
          onReload={repreview}
          onSave={(changes) =>
            saveGroups(
              (groups) => {
                const indices = dialog.targets.map((target) => target.groupIndex);
                const name = typeof changes.name === 'string' ? changes.name.trim() : '';
                if (
                  (!indices.length && !name) ||
                  (name &&
                    groups.some((group, index) => !indices.includes(index) && group.name === name))
                )
                  throw new Error(t('gemini_groups.invalidInput'));
                if (!indices.length) return [...groups, { ...changes, name, keys: [] }];
                if (indices.length > 1 && changes.name !== undefined)
                  throw new Error(t('gemini_groups.invalidInput'));
                return patchGeminiGroups(groups, indices, changes);
              },
              (latest, submitted) => {
                let groupIndex = dialog.targets[0]?.groupIndex ?? dialog.source.groups.length;
                if (latest) {
                  try {
                    groupIndex = rebaseGeminiTargets(submitted, latest.groups, [{ groupIndex }])[0]
                      .groupIndex;
                  } catch {
                    showNotification(t('gemini_groups.conflict'), 'warning');
                    return;
                  }
                }
                revealGroup(groupIndex);
                if (dialog.targets.length === 0 && latest) {
                  setDialog({
                    kind: 'import',
                    source: latest,
                    targets: [{ groupIndex }],
                    connectionRevision: apiClient.getConnectionRevision(),
                  });
                  setDialogError('');
                }
              }
            )
          }
        />
      )}
      {dialog?.kind === 'key' && (
        <GeminiKeyInheritanceDialog
          group={dialog.source.groups[dialog.targets[0].groupIndex]}
          keyEntry={
            getGeminiGroupKeys(dialog.source.groups[dialog.targets[0].groupIndex])[
              dialog.targets[0].keyIndex!
            ]
          }
          disabled={busy || snapshotLoading || panel.disableMutations}
          error={dialogError}
          conflict={dialogConflict}
          onClose={closeDialog}
          onReload={repreview}
          onSave={(changes, inheritFields) =>
            saveGroups((groups) =>
              patchGeminiKey(groups, dialog.targets[0], changes, inheritFields)
            )
          }
        />
      )}
      {dialog?.kind === 'restore' && (
        <Modal
          open
          title={t('gemini_groups.restoreTitle')}
          onClose={closeDialog}
          closeDisabled={busy}
          footer={
            <Button
              disabled={
                busy ||
                snapshotLoading ||
                panel.disableMutations ||
                dialogConflict ||
                restoreFields.size === 0
              }
              onClick={() =>
                void saveGroups((groups) =>
                  restoreGeminiInheritance(groups, dialog.targets, Array.from(restoreFields))
                ).catch(() => undefined)
              }
            >
              {t('gemini_groups.restoreInheritance')}
            </Button>
          }
        >
          <p>{t('gemini_groups.restorePreview', { count: dialog.targets.length })}</p>
          <div className={styles.patchForm}>
            {GEMINI_SHARED_FIELDS.map((field) => (
              <SelectionCheckbox
                key={field}
                label={t(`gemini_groups.field.${field}`)}
                checked={restoreFields.has(field)}
                disabled={busy}
                onChange={(checked) =>
                  setRestoreFields((current) => {
                    const next = new Set(current);
                    if (checked) next.add(field);
                    else next.delete(field);
                    return next;
                  })
                }
              />
            ))}
          </div>
          {dialogError && (
            <p role="alert" className="error-box">
              {dialogError}
            </p>
          )}
          {(dialogConflict || dialogError) && (
            <Button variant="secondary" disabled={busy} onClick={() => void repreview()}>
              {t('gemini_groups.refreshPreview')}
            </Button>
          )}
        </Modal>
      )}
      {dialog?.kind === 'merge' && (
        <Modal
          open
          title={t('gemini_groups.mergeTitle')}
          onClose={closeDialog}
          closeDisabled={busy}
          footer={
            <Button
              disabled={
                busy || snapshotLoading || panel.disableMutations || dialogConflict || !candidate
              }
              onClick={() =>
                void saveGroups(
                  (groups) => mergeGeminiGroups(groups, candidate.groupIndices),
                  () => revealGroup(candidate.groupIndices[0])
                ).catch(() => undefined)
              }
            >
              {t('gemini_groups.mergeGroups')}
            </Button>
          }
        >
          {mergeCandidates.length === 0 ? (
            <p>{t('gemini_groups.mergeEmpty')}</p>
          ) : (
            <div className={styles.patchForm}>
              <Select
                value={String(mergeCandidate)}
                onChange={(value) => setMergeCandidate(Number(value))}
                ariaLabel={t('gemini_groups.mergeTitle')}
                options={mergeCandidates.map((entry, index) => ({
                  value: String(index),
                  label: entry.groupIndices
                    .map((groupIndex) =>
                      String(dialog.source.groups[groupIndex].name ?? `#${groupIndex + 1}`)
                    )
                    .join(' · '),
                }))}
              />
              <p>
                {t('gemini_groups.mergePreview', {
                  count: candidate.keyCount,
                  groups: candidate.groupIndices.length,
                })}
              </p>
              <p>
                {t('gemini_groups.mergeTarget', {
                  name: String(dialog.source.groups[candidate.groupIndices[0]].name ?? ''),
                })}
              </p>
            </div>
          )}
          {mergeDiagnostics.length > 0 && (
            <div className={styles.patchForm}>
              <p>{t('gemini_groups.mergeSkipped')}</p>
              <ul className={styles.preview}>
                {mergeDiagnostics.map((entry) => (
                  <li key={entry.groupIndex}>
                    {String(
                      dialog.source.groups[entry.groupIndex].name ?? `#${entry.groupIndex + 1}`
                    )}
                    {' · '}
                    {t(`gemini_groups.mergeReasons.${mergeReasonLabels[entry.reason]}`)}
                    {entry.fields?.length ? ` (${entry.fields.join(', ')})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dialogError && (
            <p role="alert" className="error-box">
              {dialogError}
            </p>
          )}
          {(dialogConflict || dialogError) && (
            <Button variant="secondary" disabled={busy} onClick={() => void repreview()}>
              {t('gemini_groups.refreshPreview')}
            </Button>
          )}
        </Modal>
      )}
    </>
  );
}
