import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { modelTestIdentity } from '../modelTesting';
import { useAuthFileModelTests } from './useAuthFileModelTests';
import { apiClient } from '@/services/api/client';

type ModelsError = 'unsupported' | null;

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsList: AuthFileModelItem[];
  modelsFileName: string;
  modelsFileType: string;
  modelsError: ModelsError;
  showModels: (item: AuthFileItem) => Promise<void>;
  closeModelsModal: () => void;
  /** Invalidate derived caches after credential changes. */
  invalidateModels: (names?: string[]) => void;
  syncModelsFile: (files: AuthFileItem[]) => void;
} & ReturnType<typeof useAuthFileModelTests>;

export function useAuthFilesModels(): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsError, setModelsError] = useState<ModelsError>(null);
  const [modelsFile, setModelsFile] = useState<AuthFileItem | null>(null);
  const modelsFileRef = useRef<AuthFileItem | null>(null);
  const tests = useAuthFileModelTests(modelsFile, modelsList);
  const { resetModelTests } = tests;
  const modelsCacheRef = useRef<Map<string, AuthFileModelItem[]>>(new Map());
  const modelsCacheVersionRef = useRef(0);
  const modelsFileVersionRef = useRef<Map<string, number>>(new Map());
  const activeModelsRequestIdRef = useRef(0);

  const closeModelsModal = useCallback(() => {
    resetModelTests();
    modelsFileRef.current = null;
    setModelsFile(null);
    activeModelsRequestIdRef.current += 1;
    setModelsModalOpen(false);
    setModelsLoading(false);
  }, [resetModelTests]);

  const invalidateModels = useCallback(
    (names?: string[]) => {
      if (!names || (modelsFileRef.current && names.includes(modelsFileRef.current.name))) {
        resetModelTests();
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
    [resetModelTests]
  );

  const syncModelsFile = useCallback(
    (files: AuthFileItem[]) => {
      const selected = modelsFileRef.current;
      if (!selected) return;
      const current = files.find(
        (file) =>
          file.name === selected.name &&
          String(file.authIndex ?? '') === String(selected.authIndex ?? '')
      );
      if (!current || modelTestIdentity(current) !== modelTestIdentity(selected)) {
        resetModelTests();
        activeModelsRequestIdRef.current += 1;
        setModelsModalOpen(false);
        setModelsList([]);
        setModelsLoading(false);
        modelsFileRef.current = null;
        setModelsFile(null);
      }
    },
    [resetModelTests]
  );

  const showModels = useCallback(
    async (item: AuthFileItem) => {
      resetModelTests();
      modelsFileRef.current = item;
      setModelsFile(item);
      const revision = apiClient.getConnectionRevision();
      const cacheKey = `${item.name.trim()}\0${revision}:${modelTestIdentity(item)}`;
      const requestId = ++activeModelsRequestIdRef.current;

      setModelsFileName(item.name);
      setModelsFileType(item.type || '');
      setModelsList([]);
      setModelsError(null);
      setModelsModalOpen(true);

      const cached = modelsCacheRef.current.get(cacheKey);
      if (cached) {
        setModelsList(cached);
        setModelsLoading(false);
        return;
      }

      const cacheVersion = modelsCacheVersionRef.current;
      const fileVersion = modelsFileVersionRef.current.get(item.name.trim()) ?? 0;
      const isCacheCurrent = () =>
        cacheVersion === modelsCacheVersionRef.current &&
        fileVersion === (modelsFileVersionRef.current.get(item.name.trim()) ?? 0);
      const isRequestCurrent = () => requestId === activeModelsRequestIdRef.current;
      const isConnectionCurrent = () => revision === apiClient.getConnectionRevision();

      setModelsLoading(true);
      try {
        const models = await authFilesApi.getModelsForAuthFile(item.name);
        if (isCacheCurrent() && isConnectionCurrent()) {
          modelsCacheRef.current.set(cacheKey, models);
          if (isRequestCurrent()) setModelsList(models);
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

  return {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModels,
    syncModelsFile,
    ...tests,
  };
}
