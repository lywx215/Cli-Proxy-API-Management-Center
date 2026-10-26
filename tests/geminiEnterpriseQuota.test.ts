import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import {
  geminiEnterpriseApi,
  normalizeGeminiEnterpriseQuota,
} from '@/services/api/geminiEnterprise';
import {
  enterpriseQuotaKey,
  loadGeminiEnterpriseQuota,
  shouldLoadGeminiEnterpriseQuota,
} from '@/features/authFiles/geminiEnterpriseQuota';
import { GeminiEnterpriseQuotaBody } from '@/features/authFiles/components/GeminiEnterpriseQuota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';

const file: AuthFileItem = {
  name: 'enterprise.json',
  type: 'gemini-enterprise',
  authIndex: 'fixture',
};
const fixture = {
  status: 'ok',
  observed_at: '2026-10-23T10:00:00Z',
  period_start: '2026-10-23T07:00:00Z',
  reset_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  pools: [
    {
      tier: 'enterprise_plus',
      status: 'ok',
      limit: 10000,
      used: 6,
      remaining: 9994,
      usage_updated_at: '2026-10-23T09:17:55Z',
    },
  ],
  selected_pool: {
    tier: 'enterprise_plus',
    status: 'ok',
    limit: 10000,
    used: 6,
    remaining: 9994,
    usage_updated_at: '2026-10-23T09:17:55Z',
  },
};

describe('Gemini Enterprise credential quota', () => {
  beforeEach(() => useQuotaStore.getState().clearQuotaCache());

  test('normalizes only observations and preserves unknown values instead of inventing zero', () => {
    const data = normalizeGeminiEnterpriseQuota({
      ...fixture,
      access_token: 'never-copy',
      pools: [{ ...fixture.pools[0], used: null, remaining: null, refresh_token: 'never-copy' }],
    });
    expect(data.pools[0]).toMatchObject({ limit: 10000, used: null, remaining: null });
    expect(JSON.stringify(data)).not.toContain('never-copy');
    expect(
      normalizeGeminiEnterpriseQuota({
        ...fixture,
        pools: [
          { ...fixture.pools[0], limit: -1, used: Number.MAX_SAFE_INTEGER + 1, remaining: '0' },
        ],
      }).pools[0]
    ).toMatchObject({ limit: null, used: null, remaining: null });
    expect(normalizeGeminiEnterpriseQuota('<html>frontend</html>').status).toBe('unavailable');
  });

  test('uses the v8 quota endpoint and turns transport failure into a neutral optional state', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(fixture);
    try {
      expect((await geminiEnterpriseApi.quota('fixture')).pools[0].remaining).toBe(9994);
      expect(get).toHaveBeenLastCalledWith('/quota/gemini-enterprise', {
        params: { auth_index: 'fixture' },
      });
      get.mockRejectedValue(new Error('never-display-raw-error'));
      expect(await geminiEnterpriseApi.quota('fixture')).toEqual(
        normalizeGeminiEnterpriseQuota(null)
      );
    } finally {
      get.mockRestore();
    }
  });

  test('deduplicates an in-flight card read and discards it after credential invalidation', async () => {
    let resolve!: (value: unknown) => void;
    const get = spyOn(apiClient, 'get').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    try {
      const pending = loadGeminiEnterpriseQuota(file);
      await loadGeminiEnterpriseQuota(file);
      expect(get).toHaveBeenCalledTimes(1);
      useQuotaStore.getState().clearQuotaCache([file.name]);
      resolve(fixture);
      await pending;
      expect(useQuotaStore.getState().geminiEnterpriseQuota).toEqual({});
    } finally {
      get.mockRestore();
    }
  });

  test('isolates binding and connection identities, including same-name credentials', async () => {
    expect(enterpriseQuotaKey({ ...file, authIndex: 'other' })).not.toBe(enterpriseQuotaKey(file));
    expect(
      enterpriseQuotaKey({ ...file, geminiEnterprise: { projectId: 'rebound-project' } })
    ).not.toBe(enterpriseQuotaKey(file));
    const get = spyOn(apiClient, 'get').mockResolvedValue(fixture);
    try {
      await loadGeminiEnterpriseQuota(file);
      expect(
        useQuotaStore.getState().geminiEnterpriseQuota[enterpriseQuotaKey(file)].data?.pools[0].used
      ).toBe(6);
      useQuotaStore.getState().clearQuotaCache(['unrelated.json']);
      expect(
        useQuotaStore.getState().geminiEnterpriseQuota[enterpriseQuotaKey(file)]
      ).toBeDefined();
      useQuotaStore.getState().clearQuotaCache();
      expect(useQuotaStore.getState().geminiEnterpriseQuota).toEqual({});
    } finally {
      get.mockRestore();
    }
  });

  test('rejects a response when the management connection revision changes', async () => {
    let revision = 1;
    const connection = spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
    const get = spyOn(apiClient, 'get').mockImplementation(async () => {
      revision++;
      return fixture;
    });
    try {
      await expect(geminiEnterpriseApi.quota('fixture')).rejects.toMatchObject({
        name: 'AbortError',
      });
    } finally {
      connection.mockRestore();
      get.mockRestore();
    }
  });

  test('does not repopulate a new connection cache with an old pending response', async () => {
    let resolve!: (value: unknown) => void;
    let revision = 1;
    const connection = spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
    const get = spyOn(apiClient, 'get').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    try {
      const pending = loadGeminiEnterpriseQuota(file);
      revision++;
      useQuotaStore.getState().clearQuotaCache();
      resolve(fixture);
      await pending;
      expect(useQuotaStore.getState().geminiEnterpriseQuota).toEqual({});
    } finally {
      connection.mockRestore();
      get.mockRestore();
    }
  });

  test('refreshes at the observed reset even before the cache TTL and avoids refresh loops', () => {
    const reset = Date.parse(fixture.reset_at);
    const state = {
      loading: false,
      fetchedAtMs: reset - 10_000,
      data: normalizeGeminiEnterpriseQuota(fixture),
    };
    expect(shouldLoadGeminiEnterpriseQuota(undefined, reset)).toBe(true);
    expect(shouldLoadGeminiEnterpriseQuota(state, reset - 1)).toBe(false);
    expect(shouldLoadGeminiEnterpriseQuota(state, reset)).toBe(true);
    expect(shouldLoadGeminiEnterpriseQuota({ ...state, loading: true }, reset)).toBe(false);
    expect(shouldLoadGeminiEnterpriseQuota({ ...state, fetchedAtMs: reset }, reset + 1)).toBe(
      false
    );
    expect(shouldLoadGeminiEnterpriseQuota({ ...state, fetchedAtMs: reset }, reset + 120_001)).toBe(
      true
    );
  });

  test('does not send a request without a credential index', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(fixture);
    const withoutIndex = { ...file, authIndex: undefined };
    try {
      await loadGeminiEnterpriseQuota(withoutIndex);
      expect(get).not.toHaveBeenCalled();
      expect(
        useQuotaStore.getState().geminiEnterpriseQuota[enterpriseQuotaKey(withoutIndex)].data
          ?.status
      ).toBe('unavailable');
    } finally {
      get.mockRestore();
    }
  });

  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
    test(`renders amounts, unknown and role guidance without raw errors in ${locale}`, async () => {
      const translations = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      const i18n = createInstance();
      await i18n.init({ lng: locale, resources: { [locale]: { translation: translations } } });
      const render = (raw: unknown) =>
        renderToStaticMarkup(
          createElement(
            I18nextProvider,
            { i18n },
            createElement(GeminiEnterpriseQuotaBody, {
              state: {
                loading: false,
                fetchedAtMs: Date.now(),
                data: normalizeGeminiEnterpriseQuota(raw),
              },
            })
          )
        );
      const success = render(fixture);
      expect(success).toContain((9994).toLocaleString(locale));
      expect(success).toContain(translations.gemini_enterprise.collections.reported_usage);
      expect(success).toContain(translations.gemini_enterprise.collections.daily_limit);
      expect(success).not.toContain('progressbar');
      const denied = render({ status: 'no_permission', error: 'never-display-raw-error' });
      expect(denied).toContain('roles/viewer');
      expect(denied).not.toContain('never-display');
      expect(denied).not.toContain('progressbar');
      expect(render({ status: 'unavailable' })).toContain(
        translations.gemini_enterprise.quota.unavailable
      );
      const unknown = render({
        ...fixture,
        selected_pool: { ...fixture.pools[0], used: null, remaining: null },
      });
      const notProvided = translations.gemini_enterprise.quota.not_provided;
      expect(unknown).toContain(notProvided);
      expect(unknown).not.toContain('—');
      expect(unknown).not.toContain('progressbar');
      expect(unknown).not.toContain('gemini_enterprise.quota.');
      const allMissing = render({
        ...fixture,
        selected_pool: { ...fixture.pools[0], used: null, limit: null, remaining: null },
      });
      expect(allMissing.split(notProvided)).toHaveLength(4);
      expect(allMissing).not.toContain('<dd>0</dd>');
      const zero = render({
        ...fixture,
        selected_pool: { ...fixture.pools[0], used: 0, remaining: 10000 },
      });
      expect(zero).toContain('<dd>0</dd>');
      expect(zero).toContain((10000).toLocaleString(locale));
      expect(zero).not.toContain(translations.gemini_enterprise.quota.no_data);
      expect(zero).not.toContain(notProvided);
    });
  }
});
