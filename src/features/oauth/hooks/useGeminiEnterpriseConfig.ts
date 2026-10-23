import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useConfigStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import {
  geminiEnterpriseApi,
  GeminiEnterpriseConfigConflict,
  normalizeGeminiEnterpriseConfig,
  readGeminiEnterpriseConfig,
  sameGeminiEnterpriseConfig,
} from '@/services/api/geminiEnterprise';
import type { GeminiEnterpriseConfig } from '@/types/config';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import {
  isGeminiEnterpriseApplicationField,
  validateGeminiEnterpriseConfig,
  withGeminiEnterpriseApplication,
} from '../geminiEnterprise';

export function useGeminiEnterpriseConfig(active: boolean, locked: boolean) {
  const { t } = useTranslation();
  const [value, setValue] = useState(() =>
    withGeminiEnterpriseApplication(normalizeGeminiEnterpriseConfig(null))
  );
  const [baseline, setBaseline] = useState<GeminiEnterpriseConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const connection = useRef(-1);
  const inFlight = useRef(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  useEffect(
    () =>
      useAuthStore.subscribe((current, previous) => {
        if (
          current.apiBase !== previous.apiBase ||
          current.managementKey !== previous.managementKey ||
          current.isAuthenticated !== previous.isAuthenticated
        ) {
          controller.current?.abort();
          setBaseline(null);
          setValue(withGeminiEnterpriseApplication(normalizeGeminiEnterpriseConfig(null)));
          setConnectionEpoch((epoch) => epoch + 1);
        }
      }),
    []
  );

  useEffect(() => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    connection.current = apiClient.getConnectionRevision();
    const revision = connection.current;
    if (!active) return () => request.abort();
    setLoading(true);
    setSaving(false);
    inFlight.current = false;
    setBaseline(null);
    setError('');
    useConfigStore
      .getState()
      .fetchConfig(reload > 0)
      .then((config) => {
        if (request.signal.aborted || revision !== apiClient.getConnectionRevision()) return;
        const next = readGeminiEnterpriseConfig(config.raw);
        setValue(withGeminiEnterpriseApplication(next));
        // Preserve the actual server binding for conflict detection before saving.
        setBaseline(next);
      })
      .catch((err: unknown) => {
        if (!request.signal.aborted && revision === apiClient.getConnectionRevision())
          setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!request.signal.aborted && revision === apiClient.getConnectionRevision())
          setLoading(false);
      });
    return () => request.abort();
  }, [active, reload, connectionEpoch]);

  const errors = validateGeminiEnterpriseConfig(value);
  const dirty = baseline !== null && !sameGeminiEnterpriseConfig(value, baseline);
  const save = useCallback(async () => {
    const request = controller.current;
    const revision = connection.current;
    if (
      !active ||
      locked ||
      !baseline ||
      !request ||
      request.signal.aborted ||
      revision !== apiClient.getConnectionRevision() ||
      inFlight.current ||
      Object.keys(validateGeminiEnterpriseConfig(value)).length
    )
      return false;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await geminiEnterpriseApi.save(value, baseline, request.signal);
      if (request.signal.aborted || revision !== apiClient.getConnectionRevision()) return false;
      useConfigStore.getState().clearCache();
      setBaseline(value);
      return true;
    } catch (err: unknown) {
      if (!request.signal.aborted && revision === apiClient.getConnectionRevision()) {
        setError(
          err instanceof GeminiEnterpriseConfigConflict || (isRecord(err) && err.status === 409)
            ? t('gemini_enterprise.conflict')
            : getErrorMessage(err)
        );
      }
      return false;
    } finally {
      if (!request.signal.aborted && revision === apiClient.getConnectionRevision()) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }, [active, locked, baseline, value, t]);

  return {
    value,
    errors,
    dirty,
    loading,
    saving,
    error,
    configured: baseline !== null,
    startDisabled: loading || saving || baseline === null || Object.keys(errors).length > 0,
    setField: (field: keyof GeminiEnterpriseConfig, text: string) => {
      if (!locked && !saving && !isGeminiEnterpriseApplicationField(field))
        setValue((previous) => ({ ...previous, [field]: text.trim() }));
    },
    retry: () => {
      useConfigStore.getState().clearCache();
      setReload((count) => count + 1);
    },
    save,
  };
}
