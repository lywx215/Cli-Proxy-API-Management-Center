import type { AuthFileItem } from '@/types';
import type { GeminiEnterpriseQuotaState } from '@/types/geminiEnterpriseQuota';
import {
  geminiEnterpriseApi,
  normalizeGeminiEnterpriseQuota,
} from '@/services/api/geminiEnterprise';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';
import { normalizeAuthIndex } from '@/utils/authIndex';

export const enterpriseQuotaKey = (file: AuthFileItem) =>
  `${file.name}\0${normalizeAuthIndex(file.authIndex ?? file.auth_index) ?? ''}\0${[
    file.geminiEnterprise?.projectId,
    file.geminiEnterprise?.location,
    file.geminiEnterprise?.engineId,
  ].join('/')}`;

export function shouldLoadGeminiEnterpriseQuota(
  state: GeminiEnterpriseQuotaState | undefined,
  now: number
): boolean {
  if (state?.loading) return false;
  const resetAt = state?.data?.resetAt ? Date.parse(state.data.resetAt) : null;
  return (
    !state ||
    now - state.fetchedAtMs > 120_000 ||
    (resetAt !== null && resetAt <= now && state.fetchedAtMs < resetAt)
  );
}

export async function loadGeminiEnterpriseQuota(file: AuthFileItem): Promise<void> {
  const key = enterpriseQuotaKey(file);
  const store = useQuotaStore.getState();
  if (store.geminiEnterpriseQuota[key]?.loading) return;
  const generation = captureQuotaCacheGeneration(file.name);
  store.setGeminiEnterpriseQuota((previous) => ({
    ...previous,
    [key]: { loading: true, fetchedAtMs: Date.now() },
  }));
  let data;
  try {
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    data = authIndex
      ? await geminiEnterpriseApi.quota(authIndex)
      : normalizeGeminiEnterpriseQuota(null);
  } catch {
    data = normalizeGeminiEnterpriseQuota(null);
  }
  commitIfQuotaCacheCurrent(generation, () => {
    useQuotaStore.getState().setGeminiEnterpriseQuota((previous) => ({
      ...previous,
      [key]: { loading: false, fetchedAtMs: Date.now(), data },
    }));
  });
}
