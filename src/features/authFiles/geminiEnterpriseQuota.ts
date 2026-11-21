import type { AuthFileItem } from '@/types';
import type { GeminiEnterpriseQuotaData } from '@/types/geminiEnterpriseQuota';
import { apiClient } from '@/services/api/client';
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
import { enterpriseCollectionIdentity } from './enterpriseAccounts';

export const enterpriseQuotaKey = (file: AuthFileItem) =>
  `${file.name}\0${enterpriseCollectionIdentity(file)}`;

const pacificDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const enterpriseQuotaDay = (time: number): string => pacificDay.format(time);

export function isEnterpriseQuotaCurrent(
  data: GeminiEnterpriseQuotaData | undefined,
  now: number
): boolean {
  if (!data) return false;
  if (data.resetAt)
    return (
      Date.parse(data.resetAt) > now && (!data.periodStart || Date.parse(data.periodStart) <= now)
    );
  if (!data.observedAt) return false;
  return enterpriseQuotaDay(Date.parse(data.observedAt)) === enterpriseQuotaDay(now);
}

export async function loadGeminiEnterpriseQuota(file: AuthFileItem): Promise<void> {
  const key = enterpriseQuotaKey(file);
  const store = useQuotaStore.getState();
  if (store.geminiEnterpriseQuota[key]?.loading) return;
  const connection = apiClient.getConnectionRevision();
  const generation = captureQuotaCacheGeneration(file.name);
  store.setGeminiEnterpriseQuota((previous) => ({
    ...previous,
    [key]: { ...previous[key], loading: true, fetchedAtMs: Date.now() },
  }));
  let data;
  try {
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    data = authIndex
      ? await geminiEnterpriseApi.quota(
          authIndex,
          file.geminiEnterprise?.bindingId
            ? {
                bindingId: file.geminiEnterprise.bindingId,
                accountId: file.geminiEnterprise.accountId,
                revision: file.geminiEnterprise.revision,
                refresh: true,
              }
            : { refresh: true }
        )
      : normalizeGeminiEnterpriseQuota(null);
  } catch {
    data = normalizeGeminiEnterpriseQuota(null);
  }
  if (connection !== apiClient.getConnectionRevision()) return;
  commitIfQuotaCacheCurrent(generation, () => {
    const binding = file.geminiEnterprise;
    const poolScope =
      data.selectedPool && data.periodStart
        ? JSON.stringify([
            binding?.accountId || binding?.accountAuthIndex || file.name,
            binding?.projectId,
            binding?.location,
            data.selectedPool.tier,
            data.periodStart,
          ])
        : undefined;
    useQuotaStore.getState().setGeminiEnterpriseQuota((previous) => {
      const next = { ...previous };
      // A shared upstream pool updates sibling displays without touching request health.
      if (poolScope)
        for (const [siblingKey, sibling] of Object.entries(next)) {
          if (sibling.poolScope === poolScope && siblingKey !== key && sibling.data) {
            next[siblingKey] = {
              ...sibling,
              fetchedAtMs: Date.now(),
              data: {
                ...data,
                accountId: sibling.data.accountId,
                bindingId: sibling.data.bindingId,
                revision: sibling.data.revision,
              },
            };
          }
        }
      next[key] = { loading: false, fetchedAtMs: Date.now(), data, poolScope };
      return next;
    });
  });
}
