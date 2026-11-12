import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthFileItem, GeminiEnterpriseAccount } from '@/types';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { enterpriseHydrogenApi } from '@/services/api/enterpriseHydrogen';
import { authFileModelTestsApi } from '@/services/api/authFileModelTests';
import { geminiEnterpriseApi } from '@/services/api/geminiEnterprise';
import { enterpriseCollectionFiles } from '../enterpriseAccounts';
import {
  canEnableEnterpriseHydrogen,
  canTestEnterpriseHydrogen,
  enterpriseHydrogenAdmission,
  ENTERPRISE_HYDROGEN_MODEL,
} from '../enterpriseHydrogen';
import {
  hydrogenApplicationBatches,
  hydrogenApplicationTestFailure,
  runHydrogenApplicationTests,
  validHydrogenConfigurationApplication,
  shouldStopHydrogenApplicationTests,
} from '../enterpriseHydrogenOperations';
import type { ModelTestResult } from '../modelTesting';
import {
  hydrogenAuthorizationIdentity,
  hydrogenApplicationPermissionIdentity,
  hydrogenOperationScopeIdentity,
  confirmedHydrogenSwitch,
  olderHydrogenAccountSnapshot,
  protectHydrogenAccountEvidence,
  mergeHydrogenTestResult,
  synchronizeHydrogenOperationRows,
  type HydrogenOperationRow,
} from '../enterpriseHydrogenOperationState';
export type { HydrogenOperationRow } from '../enterpriseHydrogenOperationState';

export type HydrogenOperationMode = 'configure' | 'test';
export function useEnterpriseHydrogenOperations(
  file: AuthFileItem,
  onSaved?: (file: AuthFileItem) => Promise<void> | void
) {
  const [mode, setMode] = useState<HydrogenOperationMode | null>(null);
  const [rows, setRows] = useState<HydrogenOperationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const saves = useRef(new Map<string, AbortController>());
  const saveTargets = useRef(
    new Map<string, { file: AuthFileItem; account: AuthFileItem; enabled: boolean }>()
  );
  const operationMode = useRef<HydrogenOperationMode>('test');
  const expectedIdentity = useRef(hydrogenOperationScopeIdentity(file, 'test'));
  const fileRef = useRef(file);

  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setRows((previous) =>
      previous.map((row) =>
        row.state === 'pending' || row.state === 'running'
          ? {
              ...row,
              state: 'cancelled',
              reason: row.state === 'running' ? 'outcome_unknown' : row.reason,
            }
          : row
      )
    );
  }, []);
  const close = useCallback(() => {
    cancel();
    saves.current.forEach((controller) => controller.abort());
    saves.current.clear();
    saveTargets.current.clear();
    setMode(null);
  }, [cancel]);
  useEffect(() => {
    const previous = fileRef.current;
    if (olderHydrogenAccountSnapshot(previous, file)) return;
    const incoming = protectHydrogenAccountEvidence(previous, file);
    const identity = hydrogenOperationScopeIdentity(incoming, operationMode.current);
    if (identity !== expectedIdentity.current) {
      cancel();
    }
    const children = enterpriseCollectionFiles(incoming);
    const confirmed = new Set<string>();
    const invalidSaves = new Set<string>();
    saveTargets.current.forEach((saved, key) => {
      const latest = children.find((child) => child.geminiEnterprise?.bindingId === key);
      const sameAuthorization =
        hydrogenAuthorizationIdentity(saved.account) === hydrogenAuthorizationIdentity(incoming) &&
        Boolean(saved.account.disabled) === Boolean(incoming.disabled);
      if (latest && sameAuthorization && confirmedHydrogenSwitch(saved.file, latest, saved.enabled))
        confirmed.add(key);
      else if (
        !latest ||
        !sameAuthorization ||
        hydrogenApplicationPermissionIdentity(saved.file) !==
          hydrogenApplicationPermissionIdentity(latest)
      ) {
        saves.current.get(key)?.abort();
        saves.current.delete(key);
        saveTargets.current.delete(key);
        invalidSaves.add(key);
      }
    });
    expectedIdentity.current = identity;
    fileRef.current = incoming;
    setRows((currentRows) =>
      synchronizeHydrogenOperationRows(currentRows, previous, incoming, confirmed).map((row) =>
        invalidSaves.has(row.file.geminiEnterprise?.bindingId ?? '')
          ? { ...row, saving: false, saveFailed: true }
          : row
      )
    );
  }, [file, cancel]);
  useEffect(() => {
    const saveRequests = saves.current;
    const savedTargets = saveTargets.current;
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (
        !state.isAuthenticated ||
        state.apiBase !== previous.apiBase ||
        state.managementKey !== previous.managementKey
      )
        close();
    });
    return () => {
      unsubscribe();
      request.current?.abort();
      saveRequests.forEach((controller) => controller.abort());
      saveRequests.clear();
      savedTargets.clear();
    };
  }, [close]);

  const updateRow = (target: AuthFileItem, change: Partial<HydrogenOperationRow>) =>
    setRows((previous) =>
      previous.map((row) =>
        row.file.geminiEnterprise?.bindingId === target.geminiEnterprise?.bindingId
          ? { ...row, ...change }
          : row
      )
    );
  const adoptAccount = (
    account: GeminiEnterpriseAccount,
    confirmedBindings = new Set<string>()
  ) => {
    const previous = fileRef.current;
    const candidate = { ...previous, geminiEnterprise: account };
    const next = olderHydrogenAccountSnapshot(previous, candidate) ? previous : candidate;
    expectedIdentity.current = hydrogenOperationScopeIdentity(next, operationMode.current);
    fileRef.current = next;
    setRows((currentRows) =>
      synchronizeHydrogenOperationRows(currentRows, previous, next, confirmedBindings)
    );
    return next;
  };

  const start = async (operation: HydrogenOperationMode) => {
    if (request.current || saves.current.size) return;
    const selected = fileRef.current;
    if (operation === 'configure' && !selected.geminiEnterprise?.googleHydrogenConfigureSupported)
      return;
    const targets = enterpriseCollectionFiles(selected);
    if (!targets.length) return;
    const controller = new AbortController();
    request.current = controller;
    const connection = apiClient.getConnectionRevision();
    operationMode.current = operation;
    const identity = hydrogenOperationScopeIdentity(selected, operation);
    expectedIdentity.current = identity;
    const ownsRequest = () =>
      request.current === controller && connection === apiClient.getConnectionRevision();
    const current = () =>
      !controller.signal.aborted &&
      ownsRequest() &&
      hydrogenOperationScopeIdentity(fileRef.current, operation) === expectedIdentity.current;
    setRows(
      targets.map((target) =>
        operation === 'configure' && !validHydrogenConfigurationApplication(target)
          ? {
              file: target,
              state: 'done',
              reason: 'application_changed',
              configure: {
                bindingId: target.geminiEnterprise?.bindingId ?? '',
                authIndex: String(target.authIndex ?? ''),
                expectedRevision: target.geminiEnterprise?.revision ?? 0,
                status: 'changed',
                reason: 'credential_changed',
              },
            }
          : { file: target, state: 'pending' }
      )
    );
    setMode(operation);
    setBusy(true);
    setError(false);
    try {
      if (operation === 'configure') {
        let snapshotId: string | undefined;
        for (const batch of hydrogenApplicationBatches(
          targets.filter(validHydrogenConfigurationApplication)
        )) {
          if (!current()) break;
          batch.forEach((target) => updateRow(target, { state: 'running' }));
          const result = await enterpriseHydrogenApi.configureGoogle(
            selected,
            batch,
            controller.signal,
            snapshotId
          );
          if (!current()) break;
          snapshotId = result.snapshotId;
          result.results.forEach((entry) => {
            const target = batch.find(
              (candidate) => candidate.geminiEnterprise?.bindingId === entry.bindingId
            )!;
            updateRow(target, { state: 'done', configure: entry, reason: entry.reason });
          });
          if (result.results.some((entry) => entry.status === 'changed')) break;
        }
      } else {
        await runHydrogenApplicationTests(
          targets,
          controller.signal,
          async (target) => {
            try {
              if (!current()) {
                controller.abort();
                throw new DOMException('Operation changed', 'AbortError');
              }
              const latest = enterpriseCollectionFiles(fileRef.current).find(
                (child) => child.geminiEnterprise?.bindingId === target.geminiEnterprise?.bindingId
              );
              if (
                !latest ||
                hydrogenApplicationPermissionIdentity(latest) !==
                  hydrogenApplicationPermissionIdentity(target)
              ) {
                controller.abort();
                throw new DOMException('Application changed', 'AbortError');
              }
              if (!canTestEnterpriseHydrogen(latest))
                return {
                  status: 'unavailable',
                  model: ENTERPRISE_HYDROGEN_MODEL,
                  authIndex: String(target.authIndex ?? ''),
                  checkedAt: new Date().toISOString(),
                  elapsedMs: 0,
                  httpStatus: 0,
                  code: enterpriseHydrogenAdmission(latest)?.reason || 'test_required',
                } as ModelTestResult;
              return await authFileModelTestsApi.test(
                latest,
                ENTERPRISE_HYDROGEN_MODEL,
                controller.signal
              );
            } catch (cause) {
              return hydrogenApplicationTestFailure(target, cause);
            }
          },
          (target) => {
            if (current()) updateRow(target, { state: 'running' });
          },
          (target, result) => {
            if (!current()) return;
            const previous = fileRef.current;
            const next = mergeHydrogenTestResult(previous, target, result);
            if (result.hydrogenAdmission && next === previous) return;
            fileRef.current = next;
            expectedIdentity.current = hydrogenOperationScopeIdentity(next, operation);
            const latest =
              enterpriseCollectionFiles(next).find(
                (child) => child.geminiEnterprise?.bindingId === target.geminiEnterprise?.bindingId
              ) ?? target;
            setRows((currentRows) =>
              synchronizeHydrogenOperationRows(currentRows, previous, next).map((row) =>
                row.file.geminiEnterprise?.bindingId === target.geminiEnterprise?.bindingId
                  ? { ...row, state: 'done', test: result, file: latest, reason: result.code }
                  : row
              )
            );
          },
          shouldStopHydrogenApplicationTests
        );
      }
    } catch {
      if (current()) setError(true);
    } finally {
      if (ownsRequest()) {
        request.current = null;
        setBusy(false);
        setRows((previous) =>
          previous.map((row) =>
            row.state === 'pending' || row.state === 'running'
              ? {
                  ...row,
                  state: 'cancelled',
                  reason: row.state === 'running' ? 'outcome_unknown' : row.reason,
                }
              : row
          )
        );
        await onSaved?.(fileRef.current);
      }
    }
  };

  const changeEnabled = async (target: AuthFileItem, enabled: boolean) => {
    const key = target.geminiEnterprise?.bindingId;
    const latest = enterpriseCollectionFiles(fileRef.current).find(
      (child) => child.geminiEnterprise?.bindingId === key
    );
    if (
      !key ||
      !latest ||
      hydrogenApplicationPermissionIdentity(latest) !== hydrogenApplicationPermissionIdentity(target) ||
      request.current ||
      saves.current.size ||
      enterpriseHydrogenAdmission(latest)?.enabled === enabled ||
      (enabled && !canEnableEnterpriseHydrogen(latest))
    )
      return;
    const controller = new AbortController();
    const requested = latest;
    const selected = fileRef.current;
    saves.current.set(key, controller);
    saveTargets.current.set(key, { file: requested, account: selected, enabled });
    const connection = apiClient.getConnectionRevision();
    const current = () => {
      if (
        controller.signal.aborted ||
        saves.current.get(key) !== controller ||
        connection !== apiClient.getConnectionRevision() ||
        hydrogenAuthorizationIdentity(selected) !== hydrogenAuthorizationIdentity(fileRef.current) ||
        Boolean(selected.disabled) !== Boolean(fileRef.current.disabled)
      )
        return false;
      const currentTarget = enterpriseCollectionFiles(fileRef.current).find(
        (child) => child.geminiEnterprise?.bindingId === key
      );
      return Boolean(
        currentTarget &&
        (hydrogenApplicationPermissionIdentity(currentTarget) ===
          hydrogenApplicationPermissionIdentity(requested) ||
          confirmedHydrogenSwitch(requested, currentTarget, enabled))
      );
    };
    updateRow(requested, { saving: true, saveFailed: false, saveRequestedEnabled: enabled });
    try {
      const account = await geminiEnterpriseApi.updateCollection(
        requested,
        {
          fields: { hydrogen_enabled: enabled },
          ...(enabled && enterpriseHydrogenAdmission(requested)?.verificationRequired !== false
            ? { hydrogenTestId: enterpriseHydrogenAdmission(requested)?.test?.testId }
            : {}),
        },
        controller.signal
      );
      if (!current()) return;
      const nextFile = { ...fileRef.current, geminiEnterprise: account };
      const next = enterpriseCollectionFiles(nextFile).find(
        (child) => child.geminiEnterprise?.bindingId === key
      );
      if (
        !next ||
        hydrogenAuthorizationIdentity(nextFile) !== hydrogenAuthorizationIdentity(selected) ||
        !confirmedHydrogenSwitch(requested, next, enabled)
      )
        throw new Error('state_unknown');
      const adopted = adoptAccount(account, new Set([key]));
      updateRow(requested, { saving: false, saveFailed: false, saveRequestedEnabled: undefined });
      saves.current.delete(key);
      saveTargets.current.delete(key);
      await onSaved?.(adopted);
    } catch {
      if (current()) {
        const latestTarget = enterpriseCollectionFiles(fileRef.current).find(
          (child) => child.geminiEnterprise?.bindingId === key
        );
        const confirmed = latestTarget && confirmedHydrogenSwitch(requested, latestTarget, enabled);
        updateRow(requested, {
          saving: false,
          saveFailed: !confirmed,
          ...(confirmed ? { saveRequestedEnabled: undefined } : {}),
        });
        saves.current.delete(key);
        saveTargets.current.delete(key);
        await onSaved?.(fileRef.current);
      }
    } finally {
      if (saves.current.get(key) === controller) {
        saves.current.delete(key);
        saveTargets.current.delete(key);
      }
    }
  };
  return {
    mode,
    rows,
    busy,
    error,
    start,
    cancel,
    close,
    changeEnabled,
    completed: rows.filter((row) => row.state === 'done').length,
    total: rows.length,
  };
}
