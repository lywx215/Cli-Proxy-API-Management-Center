import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { apiClient } from '@/services/api/client';
import {
  enterpriseWebApi,
  ENTERPRISE_WEB_CHANGED,
  type EnterpriseWebStatus,
} from '@/services/api/geminiEnterpriseWeb';

export function useEnterpriseWebRuntime(enabled = true) {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [status, setStatus] = useState<EnterpriseWebStatus | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState(false);
  const epoch = useRef(0);
  const unsupportedRef = useRef(false);
  const refresh = useCallback(async () => {
    if (
      useAuthStore.getState().apiBase !== apiBase ||
      useAuthStore.getState().managementKey !== managementKey
    )
      return null;
    const current = ++epoch.current;
    const revision = apiClient.getConnectionRevision();
    if (!connected || !enabled) return null;
    try {
      const next = await enterpriseWebApi.status();
      if (current !== epoch.current || revision !== apiClient.getConnectionRevision()) return null;
      setStatus(next);
      setError(false);
      setUnsupported(false);
      unsupportedRef.current = false;
      return next;
    } catch (failure) {
      if (current !== epoch.current || revision !== apiClient.getConnectionRevision()) return null;
      setStatus(null);
      setError(true);
      const missing =
        typeof failure === 'object' &&
        failure !== null &&
        'status' in failure &&
        failure.status === 404;
      unsupportedRef.current = missing;
      setUnsupported(missing);
      return null;
    }
  }, [connected, apiBase, managementKey, enabled]);
  const invalidate = useCallback(() => {
    epoch.current++;
  }, []);
  useEffect(() => {
    unsupportedRef.current = false;
    setStatus(null);
    setUnsupported(false);
    setError(false);
    if (!enabled) return invalidate;
    void refresh();
    const changed = () => void refresh();
    window.addEventListener(ENTERPRISE_WEB_CHANGED, changed);
    const timer = window.setInterval(() => {
      if (!unsupportedRef.current) changed();
    }, 3000);
    return () => {
      invalidate();
      window.clearInterval(timer);
      window.removeEventListener(ENTERPRISE_WEB_CHANGED, changed);
    };
  }, [refresh, invalidate, enabled]);
  return { status, unsupported, error, refresh };
}
