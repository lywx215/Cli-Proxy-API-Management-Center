import { useEffect, useRef, useState } from 'react';
import { useAuthStore, useConfigStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import {
  normalizeGeminiEnterpriseConfig,
  readGeminiEnterpriseConfig,
} from '@/services/api/geminiEnterprise';
import type { OAuthStartOptions } from '@/services/api/oauth';
import type { GeminiEnterpriseConfig } from '@/types/config';
import { getErrorMessage } from '@/utils/helpers';
import {
  isGeminiEnterpriseApplicationField,
  validateGeminiEnterpriseConfig,
  withGeminiEnterpriseApplication,
} from '../geminiEnterprise';

export function useGeminiEnterpriseConfig(active: boolean, locked: boolean) {
  const [value, setValue] = useState(() =>
    withGeminiEnterpriseApplication(normalizeGeminiEnterpriseConfig(null))
  );
  const [manualResources, setManualResources] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null);
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
          setConfigured(false);
          setManualResources(false);
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
    const revision = apiClient.getConnectionRevision();
    if (!active) return () => request.abort();
    setLoading(true);
    setConfigured(false);
    setError('');
    useConfigStore
      .getState()
      .fetchConfig(reload > 0)
      .then((config) => {
        if (request.signal.aborted || revision !== apiClient.getConnectionRevision()) return;
        setValue(withGeminiEnterpriseApplication(readGeminiEnterpriseConfig(config.raw)));
        setConfigured(true);
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

  const errors = validateGeminiEnterpriseConfig(value, !manualResources);
  const startOptions: OAuthStartOptions = {
    geminiEnterprise: { ...value, discoverResources: !manualResources },
  };

  return {
    value,
    errors,
    loading,
    error,
    configured,
    manualResources,
    startOptions,
    startDisabled: !active || locked || loading || !configured || Object.keys(errors).length > 0,
    setManualResources: (manual: boolean) => {
      if (!locked) setManualResources(manual);
    },
    setField: (field: keyof GeminiEnterpriseConfig, text: string) => {
      if (!locked && !isGeminiEnterpriseApplicationField(field))
        setValue((previous) => ({ ...previous, [field]: text.trim() }));
    },
    retry: () => {
      useConfigStore.getState().clearCache();
      setReload((count) => count + 1);
    },
  };
}
