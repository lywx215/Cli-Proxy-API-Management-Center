import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { authFileModelTestsApi } from '@/services/api/authFileModelTests';
import { useAuthStore } from '@/stores/useAuthStore';
import type { ApiError, AuthFileItem } from '@/types';
import type { AuthFileModelItem } from '../constants';
import { enterpriseResources } from '../enterpriseResources';
import {
  canTestEnterpriseFile,
  isEnterpriseTextModel,
  modelTestIdentity,
  runSerialModelTests,
  type ModelTestResult,
  type ModelTestState,
} from '../modelTesting';

export function useAuthFileModelTests(file: AuthFileItem | null, models: AuthFileModelItem[]) {
  const { t } = useTranslation();
  const [results, setResults] = useState<Record<string, ModelTestState>>({});
  const [busy, setBusy] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const request = useRef<AbortController | null>(null);
  const identity = file ? modelTestIdentity(file) : '';

  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setResults((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([id, result]) => [
          id,
          result.state === 'running' ? { state: 'cancelled' as const } : result,
        ])
      )
    );
  }, []);

  const reset = useCallback(() => {
    cancel();
    setResults({});
    setProgress({ completed: 0, total: 0 });
    setUnsupported(false);
  }, [cancel]);

  useEffect(() => {
    reset();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [identity, reset]);

  useEffect(() => {
    let revision = apiClient.getConnectionRevision();
    return useAuthStore.subscribe((state) => {
      const nextRevision = apiClient.getConnectionRevision();
      if (!state.isAuthenticated || revision !== nextRevision) {
        revision = nextRevision;
        reset();
      }
    });
  }, [reset]);

  const run = useCallback(
    async (requestedModels: string[]) => {
      if (!file || !canTestEnterpriseFile(file) || unsupported || request.current) return;
      const ids = [...new Set(requestedModels)].filter((id) =>
        models.some((model) => model.id === id && isEnterpriseTextModel(model))
      );
      if (!ids.length) return;
      const controller = new AbortController();
      request.current = controller;
      const revision = apiClient.getConnectionRevision();
      const current = () =>
        !controller.signal.aborted &&
        request.current === controller &&
        revision === apiClient.getConnectionRevision();
      let completed = 0;
      setBusy(true);
      setProgress({ completed, total: ids.length });
      try {
        await runSerialModelTests(
          ids,
          controller.signal,
          async (model) => {
            const started = Date.now();
            try {
              return await authFileModelTestsApi.test(file, model, controller.signal);
            } catch (cause) {
              const error = cause as Partial<ApiError>;
              if (!current()) controller.abort();
              if (current() && error.status === 404) setUnsupported(true);
              const result: ModelTestResult = {
                status:
                  error.status === 404 ||
                  error.status === 409 ||
                  !error.status ||
                  error.status >= 500
                    ? 'unavailable'
                    : 'failed',
                model,
                authIndex: String(file.authIndex ?? ''),
                resources: enterpriseResources(file.geminiEnterprise),
                checkedAt: new Date().toISOString(),
                elapsedMs: Date.now() - started,
                httpStatus: error.status ?? 0,
                code: error.apiCode || 'request_failed',
                message:
                  error.status === 404
                    ? t('auth_files.model_test_unsupported')
                    : cause instanceof Error
                      ? cause.message
                      : t('auth_files.model_test_request_failed'),
              };
              return result;
            }
          },
          (model) => {
            if (current())
              setResults((previous) => ({ ...previous, [model]: { state: 'running' } }));
          },
          (model, result) => {
            if (!current()) return;
            completed += 1;
            setResults((previous) => ({ ...previous, [model]: { state: result.status, result } }));
            setProgress({ completed, total: ids.length });
          }
        );
      } finally {
        if (request.current === controller) {
          request.current = null;
          setBusy(false);
        }
      }
    },
    [file, models, unsupported, t]
  );

  return {
    modelTestEnabled: canTestEnterpriseFile(file),
    modelTestResults: results,
    modelTestBusy: busy,
    modelTestUnsupported: unsupported,
    modelTestProgress: progress,
    runModelTests: run,
    cancelModelTests: cancel,
    resetModelTests: reset,
  };
}
