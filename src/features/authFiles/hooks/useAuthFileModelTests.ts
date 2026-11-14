import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { authFileModelTestsApi } from '@/services/api/authFileModelTests';
import { useAuthStore } from '@/stores/useAuthStore';
import type { ApiError, AuthFileItem } from '@/types';
import { notifyAuthFilesChanged } from '../authFilesEvents';
import type { AuthFileModelItem } from '../constants';
import { enterpriseResources } from '../enterpriseResources';
import { useEnterpriseWebRuntime } from '../enterpriseWeb/useEnterpriseWebRuntime';
import {
  canTestEnterpriseFile,
  cancelModelTest,
  enterpriseModelCooldown,
  isEnterpriseModelExcluded,
  isEnterpriseTextModel,
  modelTestIdentity,
  runSerialModelTests,
  sanitizeModelTestMessage,
  type ModelTestResult,
  type ModelTestState,
} from '../modelTesting';

export function useAuthFileModelTests(file: AuthFileItem | null, models: AuthFileModelItem[]) {
  const isWeb = (file?.type || file?.provider) === 'gemini-enterprise-web';
  const webRuntime = useEnterpriseWebRuntime(isWeb);
  const channelReady = !isWeb || Boolean(webRuntime.status?.enabled && !webRuntime.error);
  const { t } = useTranslation();
  const [results, setResults] = useState<Record<string, ModelTestState>>({});
  const [busy, setBusy] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const request = useRef<AbortController | null>(null);
  const identity = file ? modelTestIdentity(file) : '';
  const identityRef = useRef(identity);
  const resultsRef = useRef(results);
  const fileRef = useRef(file);
  useEffect(() => {
    identityRef.current = identity;
    resultsRef.current = results;
    fileRef.current = file;
  }, [identity, results, file]);

  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setResults((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([id, result]) => [id, cancelModelTest(result)])
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
      if (!file || !canTestEnterpriseFile(file) || !channelReady || unsupported || request.current)
        return;
      const findModel = (id: string) => models.find((model) => model.id === id);
      const canRun = (target: AuthFileItem, id: string) => {
        const model = findModel(id);
        if (!model || enterpriseModelCooldown(target, model.upstream_model || id, resultsRef.current[id]))
          return false;
        return (
          model.policy_allowed !== false &&
          isEnterpriseTextModel(model) &&
          !isEnterpriseModelExcluded(target, model.upstream_model || id)
        );
      };
      const ids = [...new Set(requestedModels)].filter((id) => canRun(file, id));
      if (!ids.length) return;
      const controller = new AbortController();
      request.current = controller;
      const revision = apiClient.getConnectionRevision();
      const bindingIdentity = modelTestIdentity(file);
      const current = () =>
        !controller.signal.aborted &&
        request.current === controller &&
        identityRef.current === bindingIdentity &&
        revision === apiClient.getConnectionRevision();
      let completed = 0;
      let refreshedQuota = false;
      setBusy(true);
      setProgress({ completed, total: ids.length });
      try {
        await runSerialModelTests(
          ids,
          controller.signal,
          async (model) => {
            if (!current()) {
              controller.abort();
              controller.signal.throwIfAborted();
            }
            const started = Date.now();
            try {
              const upstreamModel = findModel(model)?.upstream_model || model;
              return await authFileModelTestsApi.test(
                file,
                model,
                controller.signal,
                upstreamModel
              );
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
                resources: isWeb ? undefined : enterpriseResources(file.geminiEnterprise),
                checkedAt: new Date().toISOString(),
                elapsedMs: Date.now() - started,
                httpStatus: error.status ?? 0,
                code: error.apiCode || 'request_failed',
                message:
                  error.status === 404
                    ? t('auth_files.model_test_unsupported')
                    : cause instanceof Error
                      ? sanitizeModelTestMessage(cause.message)
                      : t('auth_files.model_test_request_failed'),
              };
              return result;
            }
          },
          (model) => {
            if (current())
              setResults((previous) => ({
                ...previous,
                [model]: { ...previous[model], state: 'running' },
              }));
          },
          (model, result) => {
            if (!current()) return;
            if (file.antigravityEnterprise && result.httpStatus === 429 && !refreshedQuota) {
              refreshedQuota = true;
              notifyAuthFilesChanged();
            }
            completed += 1;
            setProgress({ completed, total: ids.length });
            setResults((previous) => ({
              ...previous,
              [model]: {
                state: result.status,
                result,
                ...(result.retryAfterSeconds
                  ? { cooldownUntilMs: Date.now() + result.retryAfterSeconds * 1000 }
                  : {}),
              },
            }));
          },
          (model) => !fileRef.current || !canRun(fileRef.current, model)
        );
      } catch (cause) {
        if (!controller.signal.aborted) throw cause;
      } finally {
        if (request.current === controller) {
          request.current = null;
          setBusy(false);
        }
      }
    },
    [file, models, unsupported, t, channelReady, isWeb]
  );

  return {
    modelTestEnabled: canTestEnterpriseFile(file) && channelReady,
    modelTestResults: results,
    modelTestBusy: busy,
    modelTestUnsupported: unsupported,
    modelTestProgress: progress,
    runModelTests: run,
    cancelModelTests: cancel,
    resetModelTests: reset,
  };
}
