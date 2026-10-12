import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import {
  geminiBudgetApi,
  isGeminiBudgetConflict,
  isGeminiBudgetUnsupported,
  normalizeGeminiBudget,
} from '@/services/api/geminiBudget';
import {
  canInitializeGeminiBudget,
  formatGeminiBudgetTime,
  geminiBudgetStateKey,
} from '@/features/quota/geminiBudgetView';
import { GeminiBudgetContent } from '@/features/quota/components/GeminiBudgetSection';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';
import ko from '@/i18n/locales/ko.json';

const originalGet = apiClient.get;
const originalPost = apiClient.post;
const originalRevision = apiClient.getConnectionRevision;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
  apiClient.getConnectionRevision = originalRevision;
});

const fixture = () => ({
  revision: 'config-revision-1',
  enabled: true,
  engine_state: 'ready',
  initialized: true,
  can_initialize: false,
  pacific_date: '2026-10-12',
  next_reset: '2026-10-13T07:00:00Z',
  estimated: true,
  backup_enabled: true,
  projects: [
    {
      project_id: 'fingerprint-123',
      key_count: 2,
      models: [
        {
          model: 'flash-real',
          limit: 20,
          used: 20,
          remaining: 0,
          inflight: 0,
          state: 'exhausted',
          retry_at: '2026-10-13T07:00:00Z',
          estimated: true,
        },
        {
          model: 'lite-real',
          limit: 500,
          used: 7,
          remaining: 493,
          inflight: 1,
          state: 'available',
          retry_at: null,
          estimated: false,
        },
      ],
    },
  ],
  last_backup: {
    state: 'failed',
    date: '2026-10-12',
    attempted_at: '2026-10-12T07:10:00Z',
    completed_at: null,
  },
});

describe('Gemini budget v8 API', () => {
  test('normalizes real models, independent counts and a failed backup attempt', () => {
    const result = normalizeGeminiBudget(fixture());
    expect(result.projects[0].models.map((row) => row.remaining)).toEqual([0, 493]);
    expect(result.projects[0].keyCount).toBe(2);
    expect(result.projects[0].models[1].inflight).toBe(1);
    expect(result.lastBackup.attemptedAt).toBe('2026-10-12T07:10:00Z');
    expect(result.lastBackup.completedAt).toBeNull();
    expect(result.estimated).toBe(true);
    expect(result.canInitialize).toBe(false);
  });
  test.each([
    null,
    {},
    { ...fixture(), projects: null },
    { ...fixture(), revision: '' },
    { ...fixture(), enabled: 'true' },
    { ...fixture(), projects: [{ project_id: 'id', key_count: 1, models: [{}] }] },
  ])('refuses malformed snapshots instead of inventing remaining quota %#', (value) => {
    expect(() => normalizeGeminiBudget(value)).toThrow('Invalid Gemini budget snapshot.');
  });
  test.each(['limit', 'used', 'remaining', 'inflight'] as const)(
    'requires a nonnegative integer %s',
    (field) => {
      for (const invalid of [undefined, '0', -1, 0.5, NaN, Infinity]) {
        const raw = fixture();
        Object.assign(raw.projects[0].models[0], { [field]: invalid });
        expect(() => normalizeGeminiBudget(raw)).toThrow();
      }
    }
  );
  test('GET is the management snapshot endpoint and does not initialize', async () => {
    let calls = 0;
    apiClient.get = (async (url: string) => {
      expect(url).toBe('/quota/gemini-budget');
      calls += 1;
      return fixture();
    }) as typeof apiClient.get;
    expect((await geminiBudgetApi.snapshot()).pacificDate).toBe('2026-10-12');
    expect(calls).toBe(1);
  });
  test('initialization posts acknowledgement with a quoted If-Match, without enabling policy', async () => {
    const calls: unknown[][] = [];
    apiClient.post = (async (...args: unknown[]) => {
      calls.push(args);
      return { status: 'ok' };
    }) as typeof apiClient.post;
    await geminiBudgetApi.initialize('config-revision-1');
    expect(calls).toEqual([
      [
        '/quota/gemini-budget/init',
        { revision: 'config-revision-1', acknowledge_unknown_usage: true },
        expect.objectContaining({
          headers: { 'If-Match': '"config-revision-1"' },
          transformRequest: [expect.any(Function)],
        }),
      ],
    ]);
  });
  test('checks the preview connection at Axios dispatch before the physical POST', async () => {
    let revision = 3;
    let dispatched = 0;
    apiClient.getConnectionRevision = () => revision;
    apiClient.post = (async (
      _url: string,
      data: unknown,
      config: {
        transformRequest: [(body: unknown) => unknown];
      }
    ) => {
      revision += 1;
      config.transformRequest[0](data);
      dispatched += 1;
      return {};
    }) as typeof apiClient.post;
    await expect(geminiBudgetApi.initialize('config-revision-1')).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(dispatched).toBe(0);
  });
  test.each(['', ' ', '"injected"', 'rev\r\nHeader:value'])(
    'rejects an invalid initialization revision before POST: %#',
    async (revision) => {
      let calls = 0;
      apiClient.post = (async () => {
        calls += 1;
      }) as typeof apiClient.post;
      await expect(geminiBudgetApi.initialize(revision)).rejects.toThrow();
      expect(calls).toBe(0);
    }
  );
  test('does not retry a revision conflict', async () => {
    const conflict = { status: 409, apiCode: 'config_conflict' };
    let calls = 0;
    apiClient.post = (async () => {
      calls += 1;
      throw conflict;
    }) as typeof apiClient.post;
    try {
      await geminiBudgetApi.initialize('stale');
      throw new Error('Expected conflict');
    } catch (error) {
      expect(error).toBe(conflict);
    }
    expect(calls).toBe(1);
  });
  test.each(['snapshot', 'initialize', 'rejected-snapshot'] as const)(
    'rejects a stale %s response after a connection switch',
    async (operation) => {
      let revision = 2;
      apiClient.getConnectionRevision = () => revision;
      const request = async () => {
        revision += 1;
        if (operation === 'rejected-snapshot') throw { status: 404 };
        return fixture();
      };
      apiClient.get = request as typeof apiClient.get;
      apiClient.post = request as typeof apiClient.post;
      const result =
        operation === 'initialize'
          ? geminiBudgetApi.initialize('config-revision-1')
          : geminiBudgetApi.snapshot();
      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    }
  );
  test('treats only actual HTTP 404 as unsupported and only 409 as conflict', () => {
    expect(isGeminiBudgetUnsupported({ status: 404 })).toBe(true);
    expect(isGeminiBudgetConflict({ status: 409 })).toBe(true);
    for (const error of [null, {}, { status: 500 }, { status: '404' }]) {
      expect(isGeminiBudgetUnsupported(error)).toBe(false);
      expect(isGeminiBudgetConflict(error)).toBe(false);
    }
  });
});

describe('Gemini budget monitor', () => {
  test('initialization requires explicit backend permission and a disabled new ledger', () => {
    const value = normalizeGeminiBudget(fixture());
    expect(canInitializeGeminiBudget(null)).toBe(false);
    const fresh = {
      ...value,
      enabled: false,
      initialized: false,
      canInitialize: true,
      engineState: 'disabled',
    };
    expect(canInitializeGeminiBudget(fresh)).toBe(true);
    for (const changed of [
      { canInitialize: false },
      { enabled: true },
      { initialized: true },
      { engineState: 'disaster' },
      { engineState: 'locked' },
      { engineState: 'storage_error' },
    ]) {
      expect(canInitializeGeminiBudget({ ...fresh, ...changed })).toBe(false);
    }
  });
  test('cannot trust contradictory can_initialize on an enabled or existing ledger', () => {
    expect(normalizeGeminiBudget({ ...fixture(), can_initialize: true }).canInitialize).toBe(false);
  });
  test('unknown future status is displayed as unknown, never as available', () => {
    expect(geminiBudgetStateKey('future-error')).toBe('gemini_budget.state_unknown');
    expect(geminiBudgetStateKey('exhausted')).toBe('gemini_budget.state_exhausted');
    expect(geminiBudgetStateKey('daily_exhausted')).toBe('gemini_budget.state_exhausted');
    expect(geminiBudgetStateKey('never')).toBe('gemini_budget.state_idle');
    expect(geminiBudgetStateKey('busy')).toBe('gemini_budget.state_inflight');
    expect(geminiBudgetStateKey('circuit_open')).toBe('gemini_budget.state_circuit_open');
    expect(geminiBudgetStateKey('not_routable')).toBe('gemini_budget.state_not_routable');
  });
  test('does not fabricate dates when server timestamps are absent or invalid', () => {
    expect(formatGeminiBudgetTime(null, 'en')).toBeNull();
    expect(formatGeminiBudgetTime('not-a-date', 'en')).toBeNull();
    expect(formatGeminiBudgetTime('2026-10-13T07:00:00Z', 'en')).not.toBeNull();
  });
  test('renders Flash exhausted alongside Lite available and the failed backup attempt', () => {
    const html = renderToStaticMarkup(
      createElement(GeminiBudgetContent, {
        snapshot: normalizeGeminiBudget(fixture()),
      })
    );
    expect(html).toContain('flash-real');
    expect(html).toContain('lite-real');
    expect(html).toContain('493');
    expect(html).toContain('20 / 20');
    expect(html).toContain(i18n.t('gemini_budget.state_exhausted'));
    expect(html).toContain(i18n.t('gemini_budget.state_available'));
    expect(html).toContain(i18n.t('gemini_budget.state_failed'));
    expect(html).toContain(i18n.t('gemini_budget.backup_note'));
    expect(html).not.toContain('api-key');
  });
  test.each(['disaster', 'locked', 'storage_error'] as const)(
    'shows the %s safety explanation without a reset action',
    (state) => {
      const snapshot = normalizeGeminiBudget({ ...fixture(), engine_state: state });
      const html = renderToStaticMarkup(createElement(GeminiBudgetContent, { snapshot }));
      expect(html).toContain('role="alert"');
      expect(html).toContain(i18n.t(`gemini_budget.notice_${state}`));
      expect(html).not.toContain('<button');
    }
  );
  test.each(['circuit_open', 'not_routable'] as const)(
    'renders the backend %s model state without advertising availability',
    (state) => {
      const raw = fixture();
      raw.projects[0].models = [{ ...raw.projects[0].models[0], state }];
      const html = renderToStaticMarkup(
        createElement(GeminiBudgetContent, {
          snapshot: normalizeGeminiBudget(raw),
        })
      );
      expect(html).toContain(i18n.t(`gemini_budget.state_${state}`));
      const modelRows = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? '';
      expect(modelRows).not.toContain(i18n.t('gemini_budget.state_available'));
    }
  );
  test('has complete matching translation keys in all six locales', () => {
    const keys = Object.keys(en.gemini_budget).sort();
    for (const locale of [zhCN, zhTW, ru, vi, ko]) {
      expect(Object.keys(locale.gemini_budget).sort()).toEqual(keys);
      expect(Object.values(locale.gemini_budget).every((value) => value.trim())).toBe(true);
    }
  });
});
