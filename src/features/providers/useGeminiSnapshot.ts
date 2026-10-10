import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { geminiManagementApi, type GeminiSnapshot } from '@/services/api/geminiManagement';

export function useGeminiSnapshot(enabled: boolean, refreshKey?: string) {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const [snapshot, setSnapshot] = useState<GeminiSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const currentScope = `${apiBase}\n${managementKey}`;
  const connectionRevision = apiClient.getConnectionRevision();
  const [snapshotScope, setSnapshotScope] = useState(currentScope);

  const reload = useCallback(async () => {
    if (!enabled || connectionRevision !== apiClient.getConnectionRevision()) return null;
    const request = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const scope = currentScope;
    setLoading(true);
    setError(null);
    try {
      const next = await geminiManagementApi.snapshot();
      if (request !== requestRef.current || revision !== apiClient.getConnectionRevision())
        return null;
      setSnapshot(next);
      setSnapshotScope(scope);
      return next;
    } catch (nextError: unknown) {
      if (request === requestRef.current && revision === apiClient.getConnectionRevision()) {
        setError(nextError);
        setSnapshotScope(scope);
        setSnapshot(null);
      }
      return null;
    } finally {
      if (request === requestRef.current && revision === apiClient.getConnectionRevision()) {
        setLoading(false);
      }
    }
  }, [enabled, currentScope, connectionRevision]);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    setLoading(false);
    void reload();
    return () => {
      requestRef.current += 1;
    };
  }, [apiBase, managementKey, refreshKey, reload]);

  return {
    snapshot: snapshotScope === currentScope ? snapshot : null,
    error: snapshotScope === currentScope ? error : null,
    loading,
    reload,
  };
}
