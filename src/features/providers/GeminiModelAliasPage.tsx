import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { OAuthAliasMappingRow } from '@/features/authFiles/components/OAuthAliasMappingRow';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import {
  geminiManagementApi,
  isGeminiConfigConflict,
  type GeminiAliasRule,
  type GeminiMigrationPreview,
} from '@/services/api/geminiManagement';
import { generateId, getErrorMessage, isRecord } from '@/utils/helpers';
import { useGeminiSnapshot } from './useGeminiSnapshot';
import {
  getGeminiAliasDraftSignature,
  normalizeGeminiAliasDraft,
  validateGeminiAliasDraft,
} from './geminiManagement';
import styles from '@/features/authFiles/components/OAuthEditor.module.scss';
import managementStyles from './components/GeminiResourcePanel.module.scss';

type DraftRow = { id: string; rule: GeminiAliasRule };
const emptyRow = (): DraftRow => ({ id: generateId(), rule: { name: '', alias: '', fork: true } });

export function GeminiModelAliasPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const { showNotification, showConfirmation } = useNotificationStore();
  const clearCache = useConfigStore((state) => state.clearCache);
  const { snapshot, loading, error, reload } = useGeminiSnapshot(connected);
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [preview, setPreview] = useState<GeminiMigrationPreview | null>(null);
  const [candidateIds, setCandidateIds] = useState<Set<string>>(new Set());
  const revisionRef = useRef(snapshot?.revision);
  useLayoutEffect(() => {
    revisionRef.current = snapshot?.revision;
  }, [snapshot?.revision]);
  const dirty =
    Boolean(snapshot) && getGeminiAliasDraftSignature(rows.map((row) => row.rule)) !== baseline;
  const controlsDisabled = !connected || loading || busy || !snapshot?.capabilities.aliases;
  const dialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );
  useUnsavedChangesGuard({ shouldBlock: dirty, dialog });

  useEffect(() => {
    setBusy(false);
    setPreview(null);
    setCandidateIds(new Set());
    if (!snapshot) {
      setRows([emptyRow()]);
      setBaseline('');
      return;
    }
    const nextRows = snapshot.aliases.length
      ? snapshot.aliases.map((rule) => ({ id: generateId(), rule: { ...rule } }))
      : [emptyRow()];
    setRows(nextRows);
    setBaseline(getGeminiAliasDraftSignature(nextRows.map((row) => row.rule)));
  }, [snapshot]);

  useEffect(() => {
    if (!connected) {
      setCatalog([]);
      return;
    }
    let cancelled = false;
    const revision = apiClient.getConnectionRevision();
    setCatalog([]);
    void geminiManagementApi
      .modelDefinitions()
      .then((result) => {
        if (!cancelled && revision === apiClient.getConnectionRevision()) {
          setCatalog(
            (result.models ?? []).flatMap((model) =>
              typeof model.id === 'string' ? [model.id] : []
            )
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connected, snapshot?.revision]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const refresh = () => {
    const connectionRevision = apiClient.getConnectionRevision();
    if (dirty)
      showConfirmation({
        ...dialog,
        onConfirm: () => {
          if (connectionRevision === apiClient.getConnectionRevision()) void reload();
        },
      });
    else void reload();
  };
  useHeaderRefresh(refresh);

  const options = useMemo(() => {
    const names = new Set(catalog);
    const addModels = (value: unknown) => {
      if (!Array.isArray(value)) return;
      value.forEach((model) => {
        if (isRecord(model) && typeof model.name === 'string') names.add(model.name);
      });
    };
    snapshot?.groups.forEach((group) => {
      addModels(group.models);
      if (Array.isArray(group.keys))
        group.keys.forEach((key) => {
          if (isRecord(key)) addModels(key.models);
        });
    });
    snapshot?.aliases.forEach((rule) => names.add(rule.name));
    return Array.from(names)
      .sort()
      .map((name) => ({ value: name }));
  }, [catalog, snapshot]);

  const handleError = async (failure: unknown, connectionRevision: number) => {
    if (connectionRevision !== apiClient.getConnectionRevision()) return;
    if (isGeminiConfigConflict(failure)) {
      await reload();
      if (connectionRevision === apiClient.getConnectionRevision())
        showNotification(t('gemini_management.conflict'), 'warning');
    } else showNotification(getErrorMessage(failure), 'error');
  };
  const save = async () => {
    if (!snapshot || controlsDisabled) return;
    const rules = rows.map((row) => row.rule);
    const invalid = validateGeminiAliasDraft(rules);
    if (invalid) {
      showNotification(t(`gemini_management.${invalid}`), 'error');
      return;
    }
    const connectionRevision = apiClient.getConnectionRevision();
    setBusy(true);
    try {
      await geminiManagementApi.saveAliases(snapshot.revision, normalizeGeminiAliasDraft(rules));
      if (connectionRevision !== apiClient.getConnectionRevision()) return;
      clearCache('gemini-api-key');
      await reload();
      if (connectionRevision === apiClient.getConnectionRevision())
        showNotification(t('gemini_management.saved'), 'success');
    } catch (failure) {
      await handleError(failure, connectionRevision);
    } finally {
      if (connectionRevision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };
  const previewMigration = async () => {
    if (!snapshot || dirty || controlsDisabled) return;
    const connectionRevision = apiClient.getConnectionRevision();
    const revision = snapshot.revision;
    setBusy(true);
    try {
      const result = await geminiManagementApi.previewMigration(revision);
      if (
        connectionRevision !== apiClient.getConnectionRevision() ||
        revisionRef.current !== revision
      )
        return;
      setPreview(result);
      setCandidateIds(new Set(result.candidates.map((candidate) => candidate.id)));
    } catch (failure) {
      await handleError(failure, connectionRevision);
    } finally {
      if (connectionRevision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };
  const applyMigration = async () => {
    if (!preview || candidateIds.size === 0 || busy || !snapshot) return;
    const connectionRevision = apiClient.getConnectionRevision();
    if (preview.revision !== snapshot.revision) {
      setPreview(null);
      await reload();
      showNotification(t('gemini_management.conflict'), 'warning');
      return;
    }
    setBusy(true);
    try {
      await geminiManagementApi.applyMigration(preview.revision, [...candidateIds]);
      if (connectionRevision !== apiClient.getConnectionRevision()) return;
      setPreview(null);
      clearCache('gemini-api-key');
      await reload();
      if (connectionRevision === apiClient.getConnectionRevision())
        showNotification(t('gemini_management.migrated'), 'success');
    } catch (failure) {
      await handleError(failure, connectionRevision);
    } finally {
      if (connectionRevision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };

  return (
    <SecondaryScreenShell
      title={t('gemini_management.aliases')}
      onBack={() => navigate('/ai-providers')}
      backLabel={t('common.back')}
      contentClassName={styles.pageContent}
      topBarClassName={`${styles.topBar} ${managementStyles.aliasTopBar}`}
      isLoading={loading && !snapshot}
      loadingLabel={t('common.loading')}
      rightAction={
        <Button onClick={() => void save()} disabled={controlsDisabled || !dirty} loading={busy}>
          {t('common.save')}
        </Button>
      }
    >
      <div className={styles.intro}>
        <div>
          <h1 className={styles.introTitle}>{t('gemini_management.aliases')}</h1>
          <p className={styles.description}>{t('gemini_management.aliasDescription')}</p>
        </div>
      </div>
      {error || (snapshot && !snapshot.capabilities.aliases) ? (
        <div className="error-box" role="alert">
          {t('gemini_management.unavailable')}{' '}
          <Button variant="ghost" size="sm" onClick={refresh}>
            {t('common.refresh')}
          </Button>
        </div>
      ) : null}
      <Card className={styles.settingsCard}>
        <div className={styles.editorHeader}>
          <strong>{t('gemini_management.rules')}</strong>
          <div className={managementStyles.actions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={controlsDisabled}
              onClick={() => setRows((previous) => [...previous, emptyRow()])}
            >
              {t('gemini_management.addAlias')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={controlsDisabled || dirty || !snapshot?.capabilities.migration}
              onClick={() => void previewMigration()}
            >
              {t('gemini_management.migrationPreview')}
            </Button>
          </div>
        </div>
        <div className={styles.catalogHint}>
          <p className={styles.description}>
            {t('gemini_management.aliasHint', { count: options.length })}
            {dirty ? ` ${t('gemini_management.saveBeforeMigration')}` : ''}
          </p>
        </div>
        <div className={styles.mappingsBody}>
          {rows.map((row, index) => (
            <OAuthAliasMappingRow
              key={row.id}
              entry={row.rule}
              index={index}
              options={options}
              disabled={controlsDisabled}
              canRemove={true}
              translationPrefix="gemini_management"
              onChange={(field, value) =>
                setRows((previous) =>
                  previous.map((entry) =>
                    entry.id === row.id
                      ? { ...entry, rule: { ...entry.rule, [field]: value } }
                      : entry
                  )
                )
              }
              onRemove={() =>
                setRows((previous) => {
                  const next = previous.filter((entry) => entry.id !== row.id);
                  return next.length ? next : [emptyRow()];
                })
              }
            />
          ))}
        </div>
      </Card>
      <Modal
        open={Boolean(preview)}
        title={t('gemini_management.migrationPreview')}
        width={720}
        closeDisabled={busy}
        onClose={() => setPreview(null)}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy || candidateIds.size === 0}
              loading={busy}
              onClick={() => void applyMigration()}
            >
              {t('gemini_management.applyMigration', { count: candidateIds.size })}
            </Button>
          </>
        }
      >
        <p>{t('gemini_management.migrationHint')}</p>
        {preview?.candidates.length === 0 && <p>{t('gemini_management.noCandidates')}</p>}
        <div className={managementStyles.migrationList}>
          {preview?.candidates.map((candidate) => (
            <div className={managementStyles.migrationRule} key={candidate.id}>
              <SelectionCheckbox
                checked={candidateIds.has(candidate.id)}
                disabled={busy}
                label={`${candidate.rule.name} → ${candidate.rule.alias}`}
                onChange={(checked) =>
                  setCandidateIds((previous) => {
                    const next = new Set(previous);
                    if (checked) next.add(candidate.id);
                    else next.delete(candidate.id);
                    return next;
                  })
                }
              />
              <p>
                {t('gemini_management.affectedKeys', { count: candidate.affectedKeys })}
                {candidate.originalNameAdded
                  ? ` · ${t('gemini_management.originalNameAdded')}`
                  : ''}
              </p>
              <p>
                {t('gemini_management.migrationTargets')}:{' '}
                {candidate.targets
                  .map((target) => {
                    const group = snapshot?.groups[target.groupIndex];
                    return `${String(group?.name ?? `#${target.groupIndex + 1}`)}${target.keyIndex === undefined ? '' : ` / #${target.keyIndex + 1}`}`;
                  })
                  .join(', ')}
              </p>
            </div>
          ))}
        </div>
        {Boolean(preview?.skipped.length) && (
          <details>
            <summary>{t('gemini_management.skipped', { count: preview?.skipped.length })}</summary>
            <ul>
              {preview?.skipped.map((entry, index) => (
                <li key={index}>
                  {entry.alias ?? entry.name ?? ''}
                  {' · '}
                  {t(`gemini_management.skipReasons.${entry.reason}`, {
                    defaultValue: t('gemini_management.skipOther'),
                  })}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Modal>
    </SecondaryScreenShell>
  );
}
