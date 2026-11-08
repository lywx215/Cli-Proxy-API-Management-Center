import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthFileItem, GeminiEnterpriseAccount } from '@/types';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { enterpriseCarbonApi } from '@/services/api/enterpriseCarbon';
import { authFileModelTestsApi } from '@/services/api/authFileModelTests';
import { geminiEnterpriseApi } from '@/services/api/geminiEnterprise';
import { enterpriseCollectionFiles } from '../enterpriseAccounts';
import {
  canEnableEnterpriseCarbon,
  canTestEnterpriseCarbon,
  enterpriseCarbonAdmission,
  ENTERPRISE_CARBON_MODEL,
} from '../enterpriseCarbon';
import {
  carbonApplicationBatches,
  carbonApplicationTestFailure,
  runCarbonApplicationTests,
  validCarbonConfigurationApplication,
  shouldStopCarbonApplicationTests,
} from '../enterpriseCarbonOperations';
import type { ModelTestResult } from '../modelTesting';
import {
  carbonAuthorizationIdentity,
  carbonApplicationPermissionIdentity,
  carbonOperationScopeIdentity,
  confirmedCarbonSwitch,
  olderCarbonAccountSnapshot,
  protectCarbonAccountEvidence,
  mergeCarbonTestResult,
  synchronizeCarbonOperationRows,
  type CarbonOperationRow,
} from '../enterpriseCarbonOperationState';
export type { CarbonOperationRow } from '../enterpriseCarbonOperationState';

export type CarbonOperationMode = 'configure' | 'test';
export function useEnterpriseCarbonOperations(
  file: AuthFileItem,
  onSaved?: (file: AuthFileItem) => Promise<void> | void
) {
  const [mode, setMode] = useState<CarbonOperationMode | null>(null);
  const [rows, setRows] = useState<CarbonOperationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const saves = useRef(new Map<string, AbortController>());
  const saveTargets = useRef(
    new Map<string, { file: AuthFileItem; account: AuthFileItem; enabled: boolean }>()
  );
  const operationMode = useRef<CarbonOperationMode>('test');
  const expectedIdentity = useRef(carbonOperationScopeIdentity(file, 'test'));
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
    if (olderCarbonAccountSnapshot(previous, file)) return;
    const incoming = protectCarbonAccountEvidence(previous, file);
    const identity = carbonOperationScopeIdentity(incoming, operationMode.current);
    if (identity !== expectedIdentity.current) {
      cancel();
    }
    const children = enterpriseCollectionFiles(incoming);
    const confirmed = new Set<string>();
    const invalidSaves = new Set<string>();
    saveTargets.current.forEach((saved, key) => {
      const latest = children.find((child) => child.geminiEnterprise?.bindingId === key);
      const sameAuthorization =
        carbonAuthorizationIdentity(saved.account) === carbonAuthorizationIdentity(incoming) &&
        Boolean(saved.account.disabled) === Boolean(incoming.disabled);
      if (latest && sameAuthorization && confirmedCarbonSwitch(saved.file, latest, saved.enabled))
        confirmed.add(key);
      else if (
        !latest ||
        !sameAuthorization ||
        carbonApplicationPermissionIdentity(saved.file) !==
          carbonApplicationPermissionIdentity(latest)
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
      synchronizeCarbonOperationRows(currentRows, previous, incoming, confirmed).map((row) =>
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

  const updateRow = (target: AuthFileItem, change: Partial<CarbonOperationRow>) =>
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
    const next = olderCarbonAccountSnapshot(previous, candidate) ? previous : candidate;
    expectedIdentity.current = carbonOperationScopeIdentity(next, operationMode.current);
    fileRef.current = next;
    setRows((currentRows) =>
      synchronizeCarbonOperationRows(currentRows, previous, next, confirmedBindings)
    );
    return next;
  };

  const start = async (operation: CarbonOperationMode) => {
    if (request.current || saves.current.size) return;
    const selected = fileRef.current;
    if (operation === 'configure' && !selected.geminiEnterprise?.googleCarbonConfigureSupported)
      return;
    const targets = enterpriseCollectionFiles(selected);
    if (!targets.length) return;
    const controller = new AbortController();
    request.current = controller;
    const connection = apiClient.getConnectionRevision();
    operationMode.current = operation;
    const identity = carbonOperationScopeIdentity(selected, operation);
    expectedIdentity.current = identity;
    const ownsRequest = () =>
      request.current === controller && connection === apiClient.getConnectionRevision();
    const current = () =>
      !controller.signal.aborted &&
      ownsRequest() &&
      carbonOperationScopeIdentity(fileRef.current, operation) === expectedIdentity.current;
    setRows(
      targets.map((target) =>
        operation === 'configure' && !validCarbonConfigurationApplication(target)
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
        for (const batch of carbonApplicationBatches(
          targets.filter(validCarbonConfigurationApplication)
        )) {
          if (!current()) break;
          batch.forEach((target) => updateRow(target, { state: 'running' }));
          const result = await enterpriseCarbonApi.configureGoogle(
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
        await runCarbonApplicationTests(
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
                carbonApplicationPermissionIdentity(latest) !==
                  carbonApplicationPermissionIdentity(target)
              ) {
                controller.abort();
                throw new DOMException('Application changed', 'AbortError');
              }
              if (!canTestEnterpriseCarbon(latest))
                return {
                  status: 'unavailable',
                  model: ENTERPRISE_CARBON_MODEL,
                  authIndex: String(target.authIndex ?? ''),
                  checkedAt: new Date().toISOString(),
                  elapsedMs: 0,
                  httpStatus: 0,
                  code: enterpriseCarbonAdmission(latest)?.reason || 'test_required',
                } as ModelTestResult;
              return await authFileModelTestsApi.test(
                latest,
                ENTERPRISE_CARBON_MODEL,
                controller.signal
              );
            } catch (cause) {
              return carbonApplicationTestFailure(target, cause);
            }
          },
          (target) => {
            if (current()) updateRow(target, { state: 'running' });
          },
          (target, result) => {
            if (!current()) return;
            const previous = fileRef.current;
            const next = mergeCarbonTestResult(previous, target, result);
            if (result.carbonAdmission && next === previous) return;
            fileRef.current = next;
            expectedIdentity.current = carbonOperationScopeIdentity(next, operation);
            const latest =
              enterpriseCollectionFiles(next).find(
                (child) => child.geminiEnterprise?.bindingId === target.geminiEnterprise?.bindingId
              ) ?? target;
            setRows((currentRows) =>
              synchronizeCarbonOperationRows(currentRows, previous, next).map((row) =>
                row.file.geminiEnterprise?.bindingId === target.geminiEnterprise?.bindingId
                  ? { ...row, state: 'done', test: result, file: latest, reason: result.code }
                  : row
              )
            );
          },
          shouldStopCarbonApplicationTests
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
      carbonApplicationPermissionIdentity(latest) !== carbonApplicationPermissionIdentity(target) ||
      request.current ||
      saves.current.size ||
      enterpriseCarbonAdmission(latest)?.enabled === enabled ||
      (enabled && !canEnableEnterpriseCarbon(latest))
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
        carbonAuthorizationIdentity(selected) !== carbonAuthorizationIdentity(fileRef.current) ||
        Boolean(selected.disabled) !== Boolean(fileRef.current.disabled)
      )
        return false;
      const currentTarget = enterpriseCollectionFiles(fileRef.current).find(
        (child) => child.geminiEnterprise?.bindingId === key
      );
      return Boolean(
        currentTarget &&
        (carbonApplicationPermissionIdentity(currentTarget) ===
          carbonApplicationPermissionIdentity(requested) ||
          confirmedCarbonSwitch(requested, currentTarget, enabled))
      );
    };
    updateRow(requested, { saving: true, saveFailed: false, saveRequestedEnabled: enabled });
    try {
      const account = await geminiEnterpriseApi.updateCollection(
        requested,
        {
          fields: { carbon_enabled: enabled },
          ...(enabled && enterpriseCarbonAdmission(requested)?.verificationRequired !== false
            ? { carbonTestId: enterpriseCarbonAdmission(requested)?.test?.testId }
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
        carbonAuthorizationIdentity(nextFile) !== carbonAuthorizationIdentity(selected) ||
        !confirmedCarbonSwitch(requested, next, enabled)
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
        const confirmed = latestTarget && confirmedCarbonSwitch(requested, latestTarget, enabled);
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
