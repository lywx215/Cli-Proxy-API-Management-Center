import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import type { AuthFileModelsSnapshot } from '@/services/api/authFiles';
import { antigravityEnterpriseBindingFiles } from '@/services/api/antigravityEnterprise';
import { geminiEnterpriseApi } from '@/services/api/geminiEnterprise';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { modelTestIdentity, type ModelTestResult, type ModelTestState } from '../modelTesting';
import { useAuthFileModelTests } from './useAuthFileModelTests';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { enterpriseCollectionFiles } from '../enterpriseAccounts';
import {
  canEnableEnterpriseCarbon,
  enterpriseCarbonAdmission,
  enterpriseCarbonTargetIdentity,
  sameEnterpriseNonCarbonState,
} from '../enterpriseCarbon';

type ModelsError = 'unsupported' | null;

const applyModelsSnapshot = (
  item: AuthFileItem,
  snapshot: AuthFileModelsSnapshot
): AuthFileItem => ({
  ...item,
  geminiEnterprise: item.geminiEnterprise
    ? {
        ...item.geminiEnterprise,
        ...(snapshot.modelPolicyState ? { modelPolicyState: snapshot.modelPolicyState } : {}),
        carbonAdmissionSupported: snapshot.carbonAdmissionSupported,
        carbonAdmission: snapshot.carbonAdmission,
      }
    : undefined,
});

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsList: AuthFileModelItem[];
  modelsTestCandidates: AuthFileModelItem[];
  modelsFileName: string;
  modelsFileType: string;
  modelsError: ModelsError;
  modelsFile: AuthFileItem | null;
  showModels: (item: AuthFileItem) => Promise<void>;
  closeModelsModal: () => void;
  /** Invalidate derived caches after credential changes. */
  invalidateModels: (names?: string[]) => void;
  syncModelsFile: (files: AuthFileItem[]) => void;
  carbonSaving: boolean;
  carbonError: string | null;
  changeCarbonEnabled: (enabled: boolean) => Promise<void>;
  enterpriseMutationVersion: number;
} & ReturnType<typeof useAuthFileModelTests>;

export function useAuthFilesModels(): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsTestCandidates, setModelsTestCandidates] = useState<AuthFileModelItem[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsError, setModelsError] = useState<ModelsError>(null);
  const [modelsFile, setModelsFile] = useState<AuthFileItem | null>(null);
  const [carbonSaving, setCarbonSaving] = useState(false);
  const [carbonError, setCarbonError] = useState<string | null>(null);
  const [lastCarbonTest, setLastCarbonTest] = useState<ModelTestState>();
  const [enterpriseMutationVersion, setEnterpriseMutationVersion] = useState(0);
  const modelsFileRef = useRef<AuthFileItem | null>(null);
  const carbonRequest = useRef<AbortController | null>(null);
  const reloadSelected = useRef<(file: AuthFileItem) => Promise<void>>(null);
  const modelsCacheRef = useRef<Map<string, AuthFileModelsSnapshot>>(new Map());
  const modelsCacheVersionRef = useRef(0);
  const modelsFileVersionRef = useRef<Map<string, number>>(new Map());
  const activeModelsRequestIdRef = useRef(0);
  const listRequest = useRef<AbortController | null>(null);

  const acceptCarbonResult = useCallback((result: ModelTestResult, tested: AuthFileItem) => {
    const selected = modelsFileRef.current;
    if (
      !selected ||
      enterpriseCarbonTargetIdentity(selected) !== enterpriseCarbonTargetIdentity(tested)
    )
      return;
    const next =
      result.carbonAdmissionSupported === true && result.carbonAdmission
        ? {
            ...selected,
            geminiEnterprise: {
              ...selected.geminiEnterprise,
              revision: result.revision,
              carbonAdmissionSupported: true,
              carbonAdmission: result.carbonAdmission,
            },
          }
        : selected;
    modelsFileRef.current = next;
    setModelsFile(next);
    setLastCarbonTest({ state: result.status, result });
    modelsCacheRef.current.clear();
    setEnterpriseMutationVersion((value) => value + 1);
    void reloadSelected.current?.(next);
  }, []);
  const tests = useAuthFileModelTests(
    modelsFile,
    [...modelsList, ...modelsTestCandidates],
    acceptCarbonResult
  );
  const { resetModelTests } = tests;

  const closeModelsModal = useCallback(() => {
    resetModelTests();
    listRequest.current?.abort();
    carbonRequest.current?.abort();
    carbonRequest.current = null;
    setCarbonSaving(false);
    setCarbonError(null);
    setLastCarbonTest(undefined);
    modelsFileRef.current = null;
    setModelsFile(null);
    setModelsTestCandidates([]);
    activeModelsRequestIdRef.current += 1;
    setModelsModalOpen(false);
    setModelsLoading(false);
  }, [resetModelTests]);

  const invalidateModels = useCallback(
    (names?: string[]) => {
      if (!names || (modelsFileRef.current && names.includes(modelsFileRef.current.name))) {
        closeModelsModal();
      }
      if (!names) {
        modelsCacheRef.current.clear();
        modelsFileVersionRef.current.clear();
        modelsCacheVersionRef.current += 1;
        return;
      }
      new Set(names.map((name) => name.trim()).filter(Boolean)).forEach((name) => {
        for (const key of modelsCacheRef.current.keys()) {
          if (key.startsWith(`${name}\0`)) modelsCacheRef.current.delete(key);
        }
        modelsFileVersionRef.current.set(name, (modelsFileVersionRef.current.get(name) ?? 0) + 1);
      });
    },
    [closeModelsModal]
  );

  const syncModelsFile = useCallback(
    (files: AuthFileItem[]) => {
      const selected = modelsFileRef.current;
      if (!selected) return;
      const candidates = files.flatMap((file) =>
        file.antigravityEnterprise?.bindings
          ? antigravityEnterpriseBindingFiles(file)
          : file.geminiEnterprise?.collections
            ? enterpriseCollectionFiles(file)
            : [file]
      );
      const current = candidates.find(
        (file) =>
          file.name === selected.name &&
          String(file.authIndex ?? '') === String(selected.authIndex ?? '')
      );
      if (
        current &&
        modelTestIdentity(current) !== modelTestIdentity(selected) &&
        sameEnterpriseNonCarbonState(current, selected)
      ) {
        setLastCarbonTest((previous) =>
          previous?.result?.carbonTestId &&
          previous.result.carbonTestId !== enterpriseCarbonAdmission(current)?.test?.testId
            ? undefined
            : previous
        );
        modelsFileRef.current = current;
        setModelsFile(current);
        void reloadSelected.current?.(current);
      } else if (!current || modelTestIdentity(current) !== modelTestIdentity(selected)) {
        resetModelTests();
        carbonRequest.current?.abort();
        carbonRequest.current = null;
        setCarbonSaving(false);
        setLastCarbonTest(undefined);
        listRequest.current?.abort();
        activeModelsRequestIdRef.current += 1;
        setModelsModalOpen(false);
        setModelsList([]);
        setModelsTestCandidates([]);
        setModelsLoading(false);
        modelsFileRef.current = null;
        setModelsFile(null);
      } else {
        modelsFileRef.current = current;
        setModelsFile(current);
      }
    },
    [resetModelTests]
  );

  const showModels = useCallback(
    async (item: AuthFileItem, preserveCarbonResult = false) => {
      resetModelTests();
      listRequest.current?.abort();
      const controller = new AbortController();
      listRequest.current = controller;
      modelsFileRef.current = item;
      setModelsFile(item);
      setCarbonError(null);
      if (!preserveCarbonResult) setLastCarbonTest(undefined);
      const revision = apiClient.getConnectionRevision();
      const cacheKey = `${item.name.trim()}\0${revision}:${modelTestIdentity(item)}`;
      const requestId = ++activeModelsRequestIdRef.current;

      setModelsFileName(item.name);
      setModelsFileType(item.type || item.provider || '');
      setModelsList([]);
      setModelsTestCandidates([]);
      setModelsError(null);
      setModelsModalOpen(true);

      const cached = modelsCacheRef.current.get(cacheKey);
      if (cached) {
        const selected = applyModelsSnapshot(item, cached);
        modelsFileRef.current = selected;
        setModelsFile(selected);
        setModelsList(cached.models);
        setModelsTestCandidates(cached.testCandidates);
        setModelsLoading(false);
        return;
      }

      const cacheVersion = modelsCacheVersionRef.current;
      const fileVersion = modelsFileVersionRef.current.get(item.name.trim()) ?? 0;
      const isCacheCurrent = () =>
        cacheVersion === modelsCacheVersionRef.current &&
        fileVersion === (modelsFileVersionRef.current.get(item.name.trim()) ?? 0);
      const isRequestCurrent = () =>
        !controller.signal.aborted && requestId === activeModelsRequestIdRef.current;
      const isConnectionCurrent = () => revision === apiClient.getConnectionRevision();

      setModelsLoading(true);
      try {
        const snapshot = await authFilesApi.getModelsForAuthFileSnapshot(item.name, {
          authIndex: String(item.authIndex ?? ''),
          bindingId: item.antigravityEnterprise?.bindingId ?? item.geminiEnterprise?.bindingId,
          signal: controller.signal,
        });
        if (isRequestCurrent() && isCacheCurrent() && isConnectionCurrent()) {
          modelsCacheRef.current.set(cacheKey, snapshot);
          const selected = applyModelsSnapshot(item, snapshot);
          modelsFileRef.current = selected;
          setModelsFile(selected);
          setModelsList(snapshot.models);
          setModelsTestCandidates(snapshot.testCandidates);
        }
      } catch (err) {
        if (!isRequestCurrent() || !isCacheCurrent() || !isConnectionCurrent()) return;
        const errorMessage = err instanceof Error ? err.message : '';
        if (
          errorMessage.includes('404') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('Not Found')
        ) {
          setModelsError('unsupported');
        } else {
          showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
        }
      } finally {
        if (isRequestCurrent()) setModelsLoading(false);
      }
    },
    [showNotification, t, resetModelTests]
  );

  useEffect(() => {
    reloadSelected.current = (item) => showModels(item, true);
  }, [showModels]);

  const changeCarbonEnabled = useCallback(
    async (enabled: boolean) => {
      const selected = modelsFileRef.current;
      if (!selected || carbonRequest.current || (enabled && !canEnableEnterpriseCarbon(selected)))
        return;
      if (!enabled) tests.cancelModelTests();
      const controller = new AbortController();
      carbonRequest.current = controller;
      const connection = apiClient.getConnectionRevision();
      const identity = enterpriseCarbonTargetIdentity(selected);
      const current = () =>
        !controller.signal.aborted &&
        carbonRequest.current === controller &&
        connection === apiClient.getConnectionRevision() &&
        modelsFileRef.current !== null &&
        enterpriseCarbonTargetIdentity(modelsFileRef.current) === identity;
      setCarbonSaving(true);
      setCarbonError(null);
      try {
        const account = await geminiEnterpriseApi.updateCollection(
          selected,
          {
            fields: { carbon_enabled: enabled },
            ...(enabled && enterpriseCarbonAdmission(selected)?.verificationRequired !== false
              ? { carbonTestId: enterpriseCarbonAdmission(selected)?.test?.testId }
              : {}),
          },
          controller.signal
        );
        if (!current()) return;
        const next = enterpriseCollectionFiles({ ...selected, geminiEnterprise: account }).find(
          (item) => item.geminiEnterprise?.bindingId === selected.geminiEnterprise?.bindingId
        );
        if (!next || enterpriseCarbonAdmission(next)?.enabled !== enabled)
          throw new Error(t('gemini_enterprise.carbon.state_unknown'));
        modelsCacheRef.current.clear();
        modelsFileRef.current = next;
        setModelsFile(next);
        setLastCarbonTest(undefined);
        setEnterpriseMutationVersion((value) => value + 1);
        await showModels(next);
      } catch {
        if (current()) {
          setCarbonError(t('gemini_enterprise.carbon.save_failed'));
          setEnterpriseMutationVersion((value) => value + 1);
        }
      } finally {
        if (carbonRequest.current === controller) {
          carbonRequest.current = null;
          setCarbonSaving(false);
        }
      }
    },
    [showModels, tests, t]
  );

  useEffect(() => {
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (
        !state.isAuthenticated ||
        state.apiBase !== previous.apiBase ||
        state.managementKey !== previous.managementKey
      ) {
        closeModelsModal();
        invalidateModels();
      }
    });
    return () => {
      unsubscribe();
      listRequest.current?.abort();
      carbonRequest.current?.abort();
    };
  }, [closeModelsModal, invalidateModels]);

  return {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsTestCandidates,
    modelsFileName,
    modelsFileType,
    modelsError,
    modelsFile,
    showModels,
    closeModelsModal,
    invalidateModels,
    syncModelsFile,
    ...tests,
    modelTestResults: lastCarbonTest
      ? {
          ...tests.modelTestResults,
          'gemini-4-carbon': tests.modelTestResults['gemini-4-carbon'] ?? lastCarbonTest,
        }
      : tests.modelTestResults,
    carbonSaving,
    carbonError,
    changeCarbonEnabled,
    enterpriseMutationVersion,
  };
}
