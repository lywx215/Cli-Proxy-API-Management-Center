import { useEffect, useRef, useState } from 'react';
import { useAuthStore, useConfigStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import {
  geminiEnterpriseApi,
  normalizeGeminiEnterpriseConfig,
  readGeminiEnterpriseConfig,
  type GeminiEnterpriseOAuthApplications,
} from '@/services/api/geminiEnterprise';
import type { GeminiEnterpriseConfig } from '@/types/config';
import { getErrorMessage } from '@/utils/helpers';
import {
  GEMINI_ENTERPRISE_APPLICATION,
  isGeminiEnterpriseApplicationField,
  resolveGeminiEnterpriseOAuthStart,
  validateGeminiEnterpriseConfig,
  withGeminiEnterpriseApplication,
  type GeminiEnterpriseRenewal,
} from '../geminiEnterprise';

export function useGeminiEnterpriseConfig(
  active: boolean,
  locked: boolean,
  renewal: GeminiEnterpriseRenewal | null = null
) {
  const [value, setValue] = useState(() =>
    withGeminiEnterpriseApplication(normalizeGeminiEnterpriseConfig(null))
  );
  const [manualResources, setManualResources] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [catalogue, setCatalogue] = useState<GeminiEnterpriseOAuthApplications | null>(null);
  const [applicationClientId, setApplicationClientId] = useState('');
  const keepApplicationSelection = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  useEffect(() => {
    if (locked) keepApplicationSelection.current = true;
  }, [locked]);

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
          setCatalogue(null);
          keepApplicationSelection.current = false;
          setApplicationClientId('');
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
    Promise.all([
      useConfigStore.getState().fetchConfig(reload > 0),
      geminiEnterpriseApi.getOAuthApplications(request.signal),
    ])
      .then(([config, applications]) => {
        if (request.signal.aborted || revision !== apiClient.getConnectionRevision()) return;
        setValue(withGeminiEnterpriseApplication(readGeminiEnterpriseConfig(config.raw)));
        setCatalogue(applications);
        setApplicationClientId((current) =>
          keepApplicationSelection.current &&
          applications?.applications.some((app) => app.clientId === current)
            ? current
            : applications?.defaultClientId || GEMINI_ENTERPRISE_APPLICATION.clientId
        );
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

  const applications = catalogue ? [...catalogue.applications] : [];
  if (
    catalogue &&
    !catalogue.legacyClientId &&
    !applications.some((app) => app.clientId === GEMINI_ENTERPRISE_APPLICATION.clientId)
  ) {
    applications.push({ clientId: GEMINI_ENTERPRISE_APPLICATION.clientId, name: '', ready: true });
  }
  const selected = applications.find((app) => app.clientId === applicationClientId);
  const renewalName = renewal
    ? catalogue?.applications.find((app) => app.clientId === renewal.clientId)?.name ||
      renewal.clientId
    : '';
  const applicationUnavailable = Boolean(!renewal && selected && !selected.ready);
  const { startOptions, renewalUnsupported } = resolveGeminiEnterpriseOAuthStart({
    value,
    catalogue,
    renewal,
    manualResources,
    applicationClientId,
  });
  const errors = renewal ? {} : validateGeminiEnterpriseConfig(value, !manualResources);

  return {
    value,
    errors,
    loading,
    error,
    configured,
    manualResources: !renewal && manualResources,
    applications,
    applicationClientId,
    renewal,
    renewalName,
    applicationUnavailable,
    renewalUnsupported,
    startOptions,
    resetForNewAccount: () => {
      keepApplicationSelection.current = false;
      setManualResources(false);
      setApplicationClientId(catalogue?.defaultClientId || GEMINI_ENTERPRISE_APPLICATION.clientId);
    },
    startDisabled:
      !active ||
      locked ||
      loading ||
      !configured ||
      applicationUnavailable ||
      renewalUnsupported ||
      Object.keys(errors).length > 0,
    setApplicationClientId: (clientId: string) => {
      if (!locked && applications.some((app) => app.clientId === clientId)) {
        keepApplicationSelection.current = true;
        setApplicationClientId(clientId);
      }
    },
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
