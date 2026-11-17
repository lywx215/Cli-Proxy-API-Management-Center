import { apiClient } from '@/services/api/client';
import { captureQuotaCacheGeneration, useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';
import type { GeminiEnterpriseQuotaState } from '@/types/geminiEnterpriseQuota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { enterpriseCollectionFiles } from './enterpriseAccounts';
import { enterpriseSubscriptionGroup } from './enterpriseCollectionGroups';
import { enterprisePolicyRoutingPaused } from './enterpriseModelPolicy';
import {
  enterpriseQuotaDay,
  enterpriseQuotaKey,
  isEnterpriseQuotaCurrent,
  loadGeminiEnterpriseQuota,
  shouldLoadGeminiEnterpriseQuota,
} from './geminiEnterpriseQuota';

type QuotaCache = Record<string, GeminiEnterpriseQuotaState>;

export type EnterprisePaidQuotaPool = {
  key: string;
  edition: string;
  files: AuthFileItem[];
};

export type EnterprisePaidQuotaScope = {
  pools: Set<EnterprisePaidQuotaPool>;
  unidentified: number;
};

export function buildEnterprisePaidQuotaIndex(accounts: readonly AuthFileItem[]) {
  const pools = new Map<string, EnterprisePaidQuotaPool>();
  const byCredential = new Map<AuthFileItem, EnterprisePaidQuotaScope>();
  const byCollection = new Map<string, EnterprisePaidQuotaPool>();
  const all: EnterprisePaidQuotaScope = { pools: new Set(), unidentified: 0 };
  for (const account of accounts) {
    const scope: EnterprisePaidQuotaScope = { pools: new Set(), unidentified: 0 };
    byCredential.set(account, scope);
    if (account.disabled || account.unavailable) continue;
    for (const file of enterpriseCollectionFiles(account)) {
      const binding = file.geminiEnterprise;
      if (
        !binding ||
        file.disabled ||
        file.unavailable ||
        binding.effectiveDisabled ||
        binding.missing ||
        enterprisePolicyRoutingPaused(binding.modelPolicyState)
      )
        continue;
      const subscription = binding.modelPolicyState?.subscription;
      if (enterpriseSubscriptionGroup(subscription) !== 'paid') continue;

      const edition = subscription?.edition;
      const project = binding.quotaProjectNumber ?? binding.projectId;
      if (
        !edition ||
        !project ||
        !/^[1-9]\d*$/.test(project) ||
        !binding.accountId ||
        !binding.bindingId ||
        binding.revision === undefined ||
        !normalizeAuthIndex(file.authIndex ?? file.auth_index)
      ) {
        scope.unidentified++;
        all.unidentified++;
        continue;
      }
      const key = JSON.stringify([project, binding.location || 'global', edition]);
      let pool = pools.get(key);
      if (!pool) {
        pool = { key, edition, files: [] };
        pools.set(key, pool);
        all.pools.add(pool);
      }
      pool.files.push(file);
      scope.pools.add(pool);
      byCollection.set(enterpriseQuotaKey(file), pool);
    }
  }
  return { all, byCredential, byCollection };
}

function collectionQuotaState(file: AuthFileItem, edition: string, cache: QuotaCache) {
  const state = cache[enterpriseQuotaKey(file)];
  const data = state?.data;
  const binding = file.geminiEnterprise;
  if (
    data?.selectedPool &&
    (data.selectedPool.tier !== edition ||
      data.accountId !== binding?.accountId ||
      data.bindingId !== binding?.bindingId ||
      data.revision !== binding?.revision)
  )
    return undefined;
  return state;
}

function quotaStates(pool: EnterprisePaidQuotaPool, cache: QuotaCache) {
  return pool.files.flatMap((file) => {
    const state = collectionQuotaState(file, pool.edition, cache);
    return state ? [state] : [];
  });
}

function quotaReading(
  pool: EnterprisePaidQuotaPool,
  state: GeminiEnterpriseQuotaState | undefined,
  now: number
) {
  const data = state?.data;
  const selected = data?.selectedPool;
  if (
    !selected ||
    selected.tier !== pool.edition ||
    selected.limit === null ||
    selected.used === null ||
    !['ok', 'stale'].includes(selected.status) ||
    !data?.periodStart ||
    !data.resetAt ||
    !isEnterpriseQuotaCurrent(data, now) ||
    enterpriseQuotaDay(Date.parse(data.periodStart)) !== enterpriseQuotaDay(now)
  )
    return null;
  return { limit: selected.limit, used: selected.used, stale: selected.status === 'stale' };
}

function compareQuotaReadings(a: GeminiEnterpriseQuotaState, b: GeminiEnterpriseQuotaState) {
  const time = (value: string | null | undefined) => Date.parse(value ?? '') || 0;
  return (
    time(a.data?.selectedPool?.usageUpdatedAt) - time(b.data?.selectedPool?.usageUpdatedAt) ||
    time(a.data?.observedAt) - time(b.data?.observedAt) ||
    a.fetchedAtMs - b.fetchedAtMs
  );
}

export function enterprisePaidQuotaPoolState(
  pool: EnterprisePaidQuotaPool,
  cache: QuotaCache,
  now: number
): GeminiEnterpriseQuotaState | undefined {
  let latest: GeminiEnterpriseQuotaState | undefined;
  let reading: GeminiEnterpriseQuotaState | undefined;
  for (const state of quotaStates(pool, cache)) {
    if (!latest || state.fetchedAtMs > latest.fetchedAtMs) latest = state;
    if (!quotaReading(pool, state, now)) continue;
    if (!reading || compareQuotaReadings(state, reading) > 0) reading = state;
  }
  return reading ?? latest;
}

export function summarizeEnterprisePaidQuota(
  scope: EnterprisePaidQuotaScope,
  cache: QuotaCache,
  now: number
) {
  let remaining = 0n;
  let known = 0;
  let stale = 0;
  let failed = 0;
  let loading = false;
  for (const pool of scope.pools) {
    const states = quotaStates(pool, cache);
    loading ||= states.some((state) => state.loading);
    const state = enterprisePaidQuotaPoolState(pool, cache, now);
    const reading = quotaReading(pool, state, now);
    if (!reading || !state) {
      if (
        state &&
        !state.loading &&
        (state.data?.status === 'unavailable' ||
          state.data?.status === 'no_permission' ||
          state.data?.selectedPool?.status === 'no_permission')
      ) {
        failed++;
      }
      continue;
    }
    known++;
    remaining += BigInt(Math.max(0, reading.limit - reading.used));
    if (
      reading.stale ||
      states.some(
        (other) =>
          !other.loading && other.fetchedAtMs > state.fetchedAtMs && !quotaReading(pool, other, now)
      )
    )
      stale++;
  }
  return {
    remaining: known ? remaining : null,
    known,
    stale,
    failed,
    loading,
    total: scope.pools.size,
  };
}

const pending = new Map<string, Promise<void>>();
const waiting: (() => void)[] = [];
let active = 0;
const quotaReadConcurrency = 4;

function scheduleQuotaRead(read: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = () => {
      active++;
      void read()
        .then(resolve, reject)
        .finally(() => {
          active--;
          waiting.shift()?.();
        });
    };
    if (active < quotaReadConcurrency) start();
    else waiting.push(start);
  });
}

export async function refreshEnterprisePaidQuota(
  pools: Iterable<EnterprisePaidQuotaPool>,
  force: boolean
): Promise<void> {
  const connection = apiClient.getConnectionRevision();
  const generation = captureQuotaCacheGeneration();
  await Promise.all(
    Array.from(pools, (pool) => {
      const key = JSON.stringify([connection, generation.cacheGeneration, pool.key]);
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const task = scheduleQuotaRead(async () => {
        const current = useQuotaStore.getState();
        const cache = current.geminiEnterpriseQuota;
        const now = Date.now();
        const cached = enterprisePaidQuotaPoolState(pool, cache, now);
        if (!force && !shouldLoadGeminiEnterpriseQuota(cached, now)) return;
        // Prefer a previously successful credential, and try alternatives only after failure.
        const files = [...pool.files].sort(
          (a, b) =>
            Number(cache[enterpriseQuotaKey(b)] === cached) -
            Number(cache[enterpriseQuotaKey(a)] === cached)
        );
        for (const file of files) {
          const state = useQuotaStore.getState();
          if (
            connection !== apiClient.getConnectionRevision() ||
            generation.cacheGeneration !== state.cacheGeneration
          )
            return;
          if (
            (generation.fileGenerations[file.name] ?? 0) !== (state.fileGenerations[file.name] ?? 0)
          )
            continue;
          await loadGeminiEnterpriseQuota(file, force);
          const loaded = collectionQuotaState(
            file,
            pool.edition,
            useQuotaStore.getState().geminiEnterpriseQuota
          );
          const reading = quotaReading(pool, loaded, Date.now());
          if (reading && (!force || !reading.stale)) return;
        }
      }).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    })
  );
}
