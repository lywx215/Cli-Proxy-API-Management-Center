import { beforeEach, expect, spyOn, test } from 'bun:test';
import {
  buildEnterprisePaidQuotaIndex,
  refreshEnterprisePaidQuota,
  summarizeEnterprisePaidQuota,
} from '@/features/authFiles/enterpriseQuotaSummary';
import { enterpriseQuotaDay, enterpriseQuotaKey } from '@/features/authFiles/geminiEnterpriseQuota';
import { apiClient } from '@/services/api/client';
import { normalizeEnterpriseAccount } from '@/services/api/enterpriseAccounts';
import { normalizeGeminiEnterpriseQuota } from '@/services/api/geminiEnterprise';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';
import type { GeminiEnterpriseQuotaState } from '@/types/geminiEnterpriseQuota';

const plus = 'enterprise_plus';
const edition = 'enterprise_standard';
const hour = 3600_000;
const now = Date.parse('2026-11-17T15:00:00Z');
const period = '2026-11-17T08:00:00Z';
const reset = '2026-11-18T08:00:00Z';

function account(
  id: string,
  projectId: string,
  {
    location = 'global',
    tier = plus,
    freeTrial = false,
    status = 'ok',
    canonical,
    child = {},
    disabled = false,
  }: {
    location?: string;
    tier?: string;
    freeTrial?: boolean;
    status?: string;
    canonical?: string;
    child?: Record<string, unknown>;
    disabled?: boolean;
  } = {}
): AuthFileItem {
  return {
    name: id + '.json',
    type: 'gemini-enterprise',
    disabled,
    geminiEnterprise: normalizeEnterpriseAccount({
      account_id: id,
      collections: [
        {
          binding_id: id + '-binding',
          auth_index: id + '-index',
          revision: 1,
          project_id: projectId,
          quota_project_number: canonical,
          location,
          model_policy_state: {
            status,
            effective_mode: 'catalog',
            subscription: { status, free_trial: freeTrial, edition: tier },
          },
          ...child,
        },
      ],
    }),
  };
}

function rawReading(
  file: AuthFileItem,
  limit: number,
  used: number,
  overrides: Record<string, unknown> = {}
) {
  const binding = file.geminiEnterprise;
  return {
    status: 'ok',
    account_id: binding?.accountId,
    binding_id: binding?.bindingId,
    revision: binding?.revision,
    period_start: period,
    reset_at: reset,
    observed_at: new Date(now).toISOString(),
    selected_pool: {
      tier: binding?.modelPolicyState?.subscription.edition,
      status: 'ok',
      limit,
      used,
      usage_updated_at: new Date(now - hour).toISOString(),
    },
    ...overrides,
  };
}

const state = (raw: unknown, fetchedAtMs = now): GeminiEnterpriseQuotaState => ({
  loading: false,
  fetchedAtMs,
  data: normalizeGeminiEnterpriseQuota(raw),
});

beforeEach(() => useQuotaStore.getState().clearQuotaCache());

test('counts shared project aliases once across credentials and keeps separate regions and editions', () => {
  const first = account('first', '123');
  const same = account('same', 'project-alias', { canonical: '123', status: 'stale' });
  const eu = account('eu', '123', { location: 'eu' });
  const otherTier = account('other-tier', '123', { tier: edition });
  const scope = buildEnterprisePaidQuotaIndex([
    first,
    same,
    eu,
    otherTier,
    account('trial', '444', { freeTrial: true }),
    account('unknown', '555', { status: 'unknown' }),
    account('disabled', '666', { disabled: true }),
    account('missing', '777', { child: { missing: true } }),
    account('unavailable', '888', { child: { unavailable: true } }),
    account('child-disabled', '999', { child: { disabled: true } }),
    account('legacy-alias', 'cannot-resolve'),
  ]);
  expect(scope.all.pools.size).toBe(3);
  expect(scope.all.unidentified).toBe(1);
  const shared = [...scope.all.pools].find((pool) => pool.files.length === 2)!;
  const [a, b] = shared.files;
  const euFile = [...scope.byCredential.get(eu)!.pools][0].files[0];
  const tierFile = [...scope.byCredential.get(otherTier)!.pools][0].files[0];
  const newer = rawReading(b, 100, 40);
  const cache = {
    [enterpriseQuotaKey(a)]: state(rawReading(a, 100, 10), now + 200),
    // The second measurement has older receipt time, but newer reported usage.
    [enterpriseQuotaKey(b)]: state(
      {
        ...newer,
        selected_pool: { ...newer.selected_pool, usage_updated_at: new Date(now).toISOString() },
      },
      now + 100
    ),
    [enterpriseQuotaKey(euFile)]: state(rawReading(euFile, 200, 250)),
    [enterpriseQuotaKey(tierFile)]: state(rawReading(tierFile, 100, 20)),
  };
  expect(summarizeEnterprisePaidQuota(scope.all, cache, now)).toMatchObject({
    remaining: 140n,
    known: 3,
    total: 3,
  });
  expect(summarizeEnterprisePaidQuota(scope.byCredential.get(first)!, cache, now).remaining).toBe(
    60n
  );
  expect(summarizeEnterprisePaidQuota(scope.byCredential.get(same)!, cache, now).remaining).toBe(
    60n
  );
});

test('keeps a same-day stale subtotal and excludes incomplete, expired and foreign readings', () => {
  const scope = buildEnterprisePaidQuotaIndex([
    account('stale-data', '123'),
    account('no-access', '234'),
    account('expired', '345'),
    account('foreign-binding', '456'),
    account('wrong-tier', '567'),
    account('no-limit', '678'),
  ]).all;
  const [a, b, c, d, e, f] = [...scope.pools].map((pool) => pool.files[0]);
  const stale = rawReading(a, 100, 25);
  const wrongTier = rawReading(e, 100, 25);
  const noLimit = rawReading(f, 100, 25);
  const cache = {
    [enterpriseQuotaKey(a)]: state({
      ...stale,
      selected_pool: { ...stale.selected_pool, status: 'stale' },
    }),
    [enterpriseQuotaKey(b)]: state({ status: 'no_permission' }),
    [enterpriseQuotaKey(c)]: state(
      rawReading(c, 100, 0, { period_start: '2026-11-16T08:00:00Z', reset_at: period })
    ),
    [enterpriseQuotaKey(d)]: state(rawReading(d, 100, 0, { binding_id: 'unrelated' })),
    [enterpriseQuotaKey(e)]: state({
      ...wrongTier,
      selected_pool: { ...wrongTier.selected_pool, tier: edition },
    }),
    [enterpriseQuotaKey(f)]: state({
      ...noLimit,
      selected_pool: { ...noLimit.selected_pool, limit: null },
    }),
  };
  expect(summarizeEnterprisePaidQuota(scope, cache, now)).toMatchObject({
    remaining: 75n,
    known: 1,
    total: 6,
    stale: 1,
    failed: 1,
  });
  expect(summarizeEnterprisePaidQuota(scope, cache, Date.parse(reset)).remaining).toBeNull();
});

function currentPeriod() {
  const current = Date.now();
  const day = enterpriseQuotaDay(current);
  const boundary = (left: number, right: number, startsDay: boolean) => {
    while (right - left > 1) {
      const midpoint = Math.floor((left + right) / 2);
      if ((enterpriseQuotaDay(midpoint) === day) === startsDay) right = midpoint;
      else left = midpoint;
    }
    return right;
  };
  return {
    observed_at: new Date(current).toISOString(),
    period_start: new Date(boundary(current - 26 * hour, current, true)).toISOString(),
    reset_at: new Date(boundary(current, current + 26 * hour, false)).toISOString(),
  };
}

test('combines refreshes of the same pool and retries a stale read with a sibling credential', async () => {
  const first = account('first', '123');
  const scope = buildEnterprisePaidQuotaIndex([first, account('sibling', '123')]);
  const [a, b] = [...scope.all.pools][0].files;
  const stale = rawReading(a, 100, 25, currentPeriod());
  const fresh = rawReading(b, 100, 40, currentPeriod());
  const get = spyOn(apiClient, 'get')
    .mockResolvedValueOnce({
      ...stale,
      selected_pool: {
        ...stale.selected_pool,
        status: 'stale',
        usage_updated_at: new Date(Date.now() - 60_000).toISOString(),
      },
    })
    .mockResolvedValueOnce({
      ...fresh,
      selected_pool: { ...fresh.selected_pool, usage_updated_at: new Date().toISOString() },
    });
  try {
    await Promise.all([
      refreshEnterprisePaidQuota(scope.all.pools, true),
      refreshEnterprisePaidQuota(scope.byCredential.get(first)!.pools, true),
    ]);
    expect(get.mock.calls.map(([, config]) => config?.params)).toEqual([
      { auth_index: 'first-index', binding_id: 'first-binding', refresh: true },
      { auth_index: 'sibling-index', binding_id: 'sibling-binding', refresh: true },
    ]);
    expect(
      summarizeEnterprisePaidQuota(
        scope.all,
        useQuotaStore.getState().geminiEnterpriseQuota,
        Date.now()
      )
    ).toMatchObject({ remaining: 60n, stale: 0 });
  } finally {
    get.mockRestore();
  }
});

test('limits active reads and stops queued targets from using a different connection', async () => {
  const scope = buildEnterprisePaidQuotaIndex(
    Array.from({ length: 8 }, (_, i) => account('account-' + i, String(123 + i)))
  ).all;
  const releases: (() => void)[] = [];
  let revision = 1;
  const connection = spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  const get = spyOn(apiClient, 'get').mockImplementation(
    () => new Promise((resolve) => releases.push(() => resolve({ status: 'no_permission' })))
  );
  const pending = refreshEnterprisePaidQuota(scope.pools, true);
  try {
    expect(get).toHaveBeenCalledTimes(4);
    revision++;
    useQuotaStore.getState().clearQuotaCache();
    releases.forEach((release) => release());
    await pending;
    expect(get).toHaveBeenCalledTimes(4);
    expect(useQuotaStore.getState().geminiEnterpriseQuota).toEqual({});
  } finally {
    releases.forEach((release) => release());
    await pending;
    get.mockRestore();
    connection.mockRestore();
  }
});
