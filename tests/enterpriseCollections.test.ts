import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { authFilesApi, normalizeAuthFilesResponse } from '@/services/api/authFiles';
import {
  geminiEnterpriseApi,
  normalizeGeminiEnterpriseQuota,
} from '@/services/api/geminiEnterprise';
import { authFileModelTestsApi } from '@/services/api/authFileModelTests';
import { InvalidManagementResponseError } from '@/services/api/managementResponse';
import {
  enterpriseCollectionFiles,
  enterpriseCollectionIdentity,
  enterpriseCollectionName,
} from '@/features/authFiles/enterpriseAccounts';
import {
  enterpriseQuotaKey,
  loadGeminiEnterpriseQuota,
  isEnterpriseQuotaCurrent,
} from '@/features/authFiles/geminiEnterpriseQuota';
import {
  canTestEnterpriseFile,
  cancelModelTest,
  enterpriseModelCooldown,
  isEnterpriseModelExcluded,
  modelTestIdentity,
  runSerialModelTests,
  sanitizeModelTestMessage,
  type ModelTestResult,
} from '@/features/authFiles/modelTesting';
import {
  enterpriseResources,
  serializeEnterpriseResources,
} from '@/features/authFiles/enterpriseResources';
import { matchesAuthFileSearch } from '@/features/authFiles/logic';
import { GeminiEnterpriseAccount } from '@/features/authFiles/components/GeminiEnterpriseAccount';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { GeminiEnterpriseQuotaBody } from '@/features/authFiles/components/GeminiEnterpriseQuota';
import { useQuotaStore } from '@/stores/useQuotaStore';

const rawCollection = {
  binding_id: 'binding-global',
  revision: 3,
  auth_index: 'child-global',
  project_id: '123456',
  project_name: 'Fixture project',
  location: 'global',
  collection_id: 'default_collection',
  engine_id: 'fixture-engine',
  assistant_id: 'default_assistant',
  disabled: false,
  effective_disabled: false,
  status: 'active',
  success: 120,
  failed: 9,
  recent_requests: [{ success: 3, failed: 1 }],
  settings: {
    prefix: 'global',
    excluded_models: ['blocked-*'],
    refresh_token: 'never-render-child-secret',
  },
};
const rawAccount = {
  account_id: 'fixture-account',
  revision: 5,
  account_management_supported: true,
  client_id: 'fixture-client',
  has_refresh_token: true,
  collections: [
    rawCollection,
    {
      ...rawCollection,
      binding_id: 'binding-custom',
      auth_index: 'child-custom',
      collection_id: 'custom_collection',
      engine_id: 'custom-engine',
      disabled: true,
      settings: { prefix: 'custom' },
    },
  ],
};
const parent = () =>
  normalizeAuthFilesResponse({
    files: [
      {
        name: 'collections.json',
        type: 'gemini-enterprise',
        email: 'fixture@example.invalid',
        auth_index: 'parent-index',
        gemini_enterprise: rawAccount,
      },
    ],
  }).files[0];
const children = () => enterpriseCollectionFiles(parent());
const childResponse = (used = 7) => ({
  status: 'ok',
  account_id: rawAccount.account_id,
  binding_id: rawCollection.binding_id,
  revision: 3,
  observed_at: new Date().toISOString(),
  period_start: new Date(Date.now() - 1000).toISOString(),
  reset_at: new Date(Date.now() + 86400000).toISOString(),
  pools: [{ tier: 'enterprise_plus', status: 'ok', used, limit: 100, remaining: 999 }],
  selected_pool: { tier: 'enterprise_plus', status: 'ok', used, limit: 100, remaining: 999 },
});
const modelResult = (patch: Partial<ModelTestResult> = {}): ModelTestResult => ({
  status: 'ok',
  model: 'gemini-text',
  authIndex: 'child-global',
  bindingId: rawCollection.binding_id,
  revision: 3,
  resources: enterpriseResources(children()[0].geminiEnterprise),
  checkedAt: new Date().toISOString(),
  elapsedMs: 20,
  httpStatus: 200,
  code: '',
  message: '',
  ...patch,
});

describe('Enterprise account and collection identities', () => {
  beforeEach(() => useQuotaStore.getState().clearQuotaCache());

  test('normalizes one parent with multiple children and never deduplicates them by filename', () => {
    const account = parent();
    expect(account.authIndex).toBe('parent-index');
    expect(account.geminiEnterprise?.collections).toHaveLength(2);
    const [first, second] = enterpriseCollectionFiles(account);
    expect(first.name).toBe(second.name);
    expect(first.authIndex).toBe('child-global');
    expect(second.authIndex).toBe('child-custom');
    expect(first.geminiEnterprise?.accountAuthIndex).toBe('parent-index');
    expect(first.geminiEnterprise?.revision).toBe(3);
    expect(first.geminiEnterprise?.accountRevision).toBe(5);
    expect(first.geminiEnterprise?.settings).toEqual({
      prefix: 'global',
      excluded_models: ['blocked-*'],
    });
    expect(JSON.stringify([first, second])).not.toContain('never-render');
    expect(enterpriseCollectionIdentity(first)).not.toBe(enterpriseCollectionIdentity(second));
    expect(enterpriseQuotaKey(first)).not.toBe(enterpriseQuotaKey(second));
    expect(enterpriseCollectionName(first)).toBe('Fixture project');
    expect(enterpriseCollectionName(second)).toContain('custom_collection');
    expect(matchesAuthFileSearch(account, 'custom-engine', null)).toBe(true);
    expect(matchesAuthFileSearch(account, 'custom_collection', null)).toBe(true);
    const rebound = { ...first, geminiEnterprise: { ...first.geminiEnterprise, revision: 4 } };
    expect(modelTestIdentity(first)).not.toBe(modelTestIdentity(rebound));
    expect(enterpriseQuotaKey(first)).not.toBe(enterpriseQuotaKey(rebound));
  });

  test('parent off/on preserves child switches and blocks generation while effectively disabled', () => {
    const account = parent();
    expect(canTestEnterpriseFile(account)).toBe(false);
    const disabled = enterpriseCollectionFiles({ ...account, disabled: true });
    expect(disabled.map((child) => child.disabled)).toEqual([false, true]);
    expect(disabled.every((child) => child.geminiEnterprise?.effectiveDisabled)).toBe(true);
    expect(disabled.every((child) => !canTestEnterpriseFile(child))).toBe(true);
    expect(
      enterpriseCollectionFiles({ ...account, disabled: false }).map((child) => child.disabled)
    ).toEqual([false, true]);
    expect(canTestEnterpriseFile(children()[0])).toBe(true);
  });

  test('patches only the selected child for switch, resources and settings with its revision', async () => {
    const file = children()[1];
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({
      status: 'ok',
      gemini_enterprise: rawAccount,
    });
    const signal = new AbortController().signal;
    try {
      await geminiEnterpriseApi.updateCollection(
        file,
        {
          disabled: false,
          fields: {
            prefix: 'changed',
            excluded_models: ['one'],
            model_aliases: [{ name: 'a', alias: 'b' }],
          },
        },
        signal
      );
      expect(patch).toHaveBeenLastCalledWith(
        '/credentials/gemini-enterprise/collections',
        {
          name: 'collections.json',
          auth_index: 'child-custom',
          binding_id: 'binding-custom',
          expected_revision: 3,
          disabled: false,
          fields: {
            prefix: 'changed',
            excluded_models: ['one'],
            model_aliases: [{ name: 'a', alias: 'b' }],
          },
        },
        { signal, timeout: 0 }
      );
      const resources = {
        ...enterpriseResources(file.geminiEnterprise),
        location: 'eu',
        engineId: 'europe-app',
      };
      await geminiEnterpriseApi.updateResources(
        file,
        resources,
        enterpriseResources(file.geminiEnterprise),
        signal
      );
      expect(patch.mock.calls[1][1]).toMatchObject({
        binding_id: 'binding-custom',
        expected_revision: 3,
        resources: serializeEnterpriseResources(resources),
      });
      patch.mockRejectedValue({ status: 409, apiCode: 'credential_changed' });
      await expect(
        geminiEnterpriseApi.updateCollection(file, { disabled: true })
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      patch.mockRestore();
    }
  });

  test('discovers using the parent and returns exact added counts without a generation timeout', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      status: 'partial',
      gemini_enterprise: rawAccount,
      added_project_count: 2,
      added_collection_count: 4,
      added_binding_ids: ['new'],
    });
    const signal = new AbortController().signal;
    try {
      expect(await geminiEnterpriseApi.discover(parent(), signal)).toMatchObject({
        status: 'partial',
        addedProjectCount: 2,
        addedCollectionCount: 4,
        addedBindingIds: ['new'],
      });
      expect(post).toHaveBeenLastCalledWith(
        '/credentials/gemini-enterprise/discover',
        {
          name: 'collections.json',
          auth_index: 'parent-index',
          account_id: 'fixture-account',
          expected_revision: 5,
        },
        { signal, timeout: 0 }
      );
      post.mockResolvedValue({ status: 'ok', gemini_enterprise: rawAccount });
      await expect(geminiEnterpriseApi.discover(parent())).rejects.toBeInstanceOf(
        InvalidManagementResponseError
      );
      post.mockResolvedValue({
        status: 'ok',
        gemini_enterprise: { ...rawAccount, account_id: 'other-account' },
        added_project_count: 0,
        added_collection_count: 0,
      });
      await expect(geminiEnterpriseApi.discover(parent())).rejects.toBeInstanceOf(
        InvalidManagementResponseError
      );
    } finally {
      post.mockRestore();
    }
  });

  test('lists and tests models using exact child identity and drops wrong-binding responses', async () => {
    const file = children()[0];
    const get = spyOn(apiClient, 'get').mockResolvedValue({ models: [{ id: 'gemini-text' }] });
    const response = {
      status: 'ok',
      model: 'gemini-text',
      auth_index: file.authIndex,
      binding_id: rawCollection.binding_id,
      revision: 3,
      resources: serializeEnterpriseResources(enterpriseResources(file.geminiEnterprise)),
      checked_at: new Date().toISOString(),
      elapsed_ms: 15,
      http_status: 200,
    };
    const post = spyOn(apiClient, 'post').mockResolvedValue(response);
    const signal = new AbortController().signal;
    try {
      await authFilesApi.getModelsForAuthFile(file.name, {
        authIndex: String(file.authIndex),
        bindingId: file.geminiEnterprise?.bindingId,
        signal,
      });
      expect(get).toHaveBeenLastCalledWith('/credentials/models?name=collections.json', {
        params: { auth_index: 'child-global', binding_id: 'binding-global' },
        signal,
      });
      await authFileModelTestsApi.test(file, 'gemini-text', signal);
      expect(post.mock.calls[0][1]).toMatchObject({
        binding_id: 'binding-global',
        expected_revision: 3,
        auth_index: 'child-global',
      });
      for (const changes of [
        { binding_id: 'binding-custom' },
        { revision: 4 },
        { binding_id: undefined },
        { auth_index: 'child-custom' },
      ]) {
        post.mockResolvedValue({ ...response, ...changes });
        await expect(
          authFileModelTestsApi.test(file, 'gemini-text', signal)
        ).rejects.toBeInstanceOf(InvalidManagementResponseError);
      }
    } finally {
      get.mockRestore();
      post.mockRestore();
    }
  });

  test('uses the selected quota edition, distinguishes missing and zero, and does not sum pools', () => {
    const response = childResponse();
    const ambiguous = {
      ...response,
      selected_pool: null,
      pools: [response.selected_pool, { ...response.selected_pool, tier: 'enterprise_standard' }],
    };
    expect(normalizeGeminiEnterpriseQuota(ambiguous).selectedPool).toBeNull();
    const legacy = { ...ambiguous, selected_pool: undefined };
    delete legacy.selected_pool;
    expect(normalizeGeminiEnterpriseQuota(legacy).selectedPool).toBeNull();
    expect(
      normalizeGeminiEnterpriseQuota({ ...response, selected_pool: undefined }).selectedPool
    ).toBeNull();
    expect(normalizeGeminiEnterpriseQuota(response).selectedPool?.remaining).toBe(93);
    expect(
      normalizeGeminiEnterpriseQuota({
        ...response,
        selected_pool: { ...response.selected_pool, used: 0, remaining: 0 },
      }).selectedPool?.remaining
    ).toBe(100);
    expect(
      normalizeGeminiEnterpriseQuota({
        ...response,
        selected_pool: { ...response.selected_pool, used: null, remaining: 100 },
      }).selectedPool?.remaining
    ).toBeNull();
    expect(
      normalizeGeminiEnterpriseQuota({
        ...response,
        selected_pool: { ...response.selected_pool, used: 110 },
      }).selectedPool?.remaining
    ).toBe(0);
  });

  test('partial and stale readings preserve known current-day values with explicit states', () => {
    for (const status of ['partial', 'stale']) {
      const response = childResponse();
      const data = normalizeGeminiEnterpriseQuota({
        ...response,
        status,
        selected_pool: { ...response.selected_pool, status, used: null, limit: 100 },
      });
      expect(data.status).toBe(status);
      expect(data.selectedPool).toMatchObject({ status, used: null, limit: 100, remaining: null });
      expect(isEnterpriseQuotaCurrent(data, Date.now())).toBe(true);
      expect(
        isEnterpriseQuotaCurrent({ ...data, resetAt: '2000-01-01T00:00:00Z' }, Date.now())
      ).toBe(false);
      expect(
        isEnterpriseQuotaCurrent(
          { ...data, resetAt: null, observedAt: '2000-01-01T00:00:00Z' },
          Date.now()
        )
      ).toBe(false);
    }
  });

  test('manual quota refresh is pinned, updates a shared pool sibling and leaves health untouched', async () => {
    const [first, second] = children();
    const response = childResponse();
    const get = spyOn(apiClient, 'get').mockResolvedValue(response);
    const health = JSON.stringify([first, second]);
    try {
      await loadGeminiEnterpriseQuota(first);
      const scope =
        useQuotaStore.getState().geminiEnterpriseQuota[enterpriseQuotaKey(first)].poolScope;
      useQuotaStore.getState().setGeminiEnterpriseQuota((previous) => ({
        ...previous,
        [enterpriseQuotaKey(second)]: {
          loading: false,
          fetchedAtMs: 0,
          poolScope: scope,
          data: { ...normalizeGeminiEnterpriseQuota(response), bindingId: 'binding-custom' },
        },
      }));
      get.mockResolvedValue({
        ...response,
        selected_pool: { ...response.selected_pool, used: 11 },
      });
      await loadGeminiEnterpriseQuota(first, true);
      expect(get).toHaveBeenLastCalledWith('/quota/gemini-enterprise', {
        params: { auth_index: 'child-global', binding_id: 'binding-global', refresh: true },
      });
      expect(
        useQuotaStore.getState().geminiEnterpriseQuota[enterpriseQuotaKey(second)].data
          ?.selectedPool?.remaining
      ).toBe(89);
      expect(
        useQuotaStore.getState().geminiEnterpriseQuota[enterpriseQuotaKey(second)].data?.bindingId
      ).toBe('binding-custom');
      expect(JSON.stringify([first, second])).toBe(health);
      get.mockResolvedValue({ ...response, revision: 4 });
      await expect(
        geminiEnterpriseApi.quota('child-global', {
          accountId: rawAccount.account_id,
          bindingId: 'binding-global',
          revision: 3,
        })
      ).rejects.toBeInstanceOf(InvalidManagementResponseError);
    } finally {
      get.mockRestore();
    }
  });
});

describe('Enterprise model cancellation and cooldown preflight', () => {
  test('cancelled retests restore the previous final result while first attempts remain cancelled', () => {
    const result = modelResult();
    expect(cancelModelTest({ state: 'running', result })).toEqual({ state: 'ok', result });
    expect(cancelModelTest({ state: 'running' })).toEqual({ state: 'cancelled' });
  });

  test('skips cooling and excluded models before generation and keeps model failures serial', async () => {
    const file = children()[0];
    file.cooldownSnapshot = {
      receivedAtMs: 1000,
      records: [
        {
          scope: 'model',
          modelKey: 'cooling',
          remainingSeconds: 60,
          retryAt: '2099-01-01T00:00:00Z',
          reason: 'quota',
        },
      ],
    };
    expect(enterpriseModelCooldown(file, 'cooling', undefined, 31000)).toBe(30);
    expect(enterpriseModelCooldown(file, 'cooling', undefined, 61000)).toBe(0);
    expect(isEnterpriseModelExcluded(file, 'blocked-model')).toBe(true);
    const called: string[] = [];
    await runSerialModelTests(
      ['cooling', 'blocked-model', 'a', 'b'],
      new AbortController().signal,
      async (model) => {
        called.push(model);
        return modelResult({
          model,
          status: model === 'a' ? 'failed' : 'ok',
          httpStatus: model === 'a' ? 400 : 200,
        });
      },
      () => {},
      () => {},
      (model) =>
        isEnterpriseModelExcluded(file, model) ||
        enterpriseModelCooldown(file, model, undefined, 31000) > 0
    );
    expect(called).toEqual(['a', 'b']);
  });

  test('sanitizes secrets and bounds expandable error text', () => {
    const safe = sanitizeModelTestMessage(
      'Authorization: Bearer synthetic-token access_token="synthetic-access" refresh_token=synthetic-refresh client_secret: synthetic-secret'
    );
    for (const value of [
      'synthetic-token',
      'synthetic-access',
      'synthetic-refresh',
      'synthetic-secret',
    ])
      expect(safe).not.toContain(value);
    expect(sanitizeModelTestMessage('x'.repeat(10000))).toHaveLength(4096);
  });
});

describe('Enterprise grouped UI in six languages', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko'])
    test(locale, async () => {
      const translations = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      const i18n = createInstance();
      await i18n.init({ lng: locale, resources: { [locale]: { translation: translations } } });
      const render = (element: ReturnType<typeof createElement>) =>
        renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
      const file = parent();
      const noOp = () => {};
      const markup = render(
        createElement(GeminiEnterpriseAccount, {
          file,
          selected: false,
          disableControls: true,
          deleting: null,
          statusUpdating: {},
          manualRefreshing: {},
          onShowModels: noOp,
          onDownload: noOp,
          onManualRefresh: noOp,
          onOpenPrefixProxyEditor: noOp,
          onDelete: noOp,
          onToggleStatus: noOp,
          onToggleSelect: noOp,
        })
      );
      expect(markup).toContain('custom_collection');
      expect(markup).not.toContain('default_collection');
      expect(markup).not.toContain('never-render');
      expect(markup).toContain('75.0%');
      expect(markup).toContain(translations.gemini_enterprise.collections.recent_rate);
      expect(markup).toContain(translations.gemini_enterprise.collections.requests);
      expect(markup).not.toContain('gemini_enterprise.');
      const child = children()[0];
      const modal = render(
        createElement(AuthFileModelsModal, {
          open: true,
          fileName: child.name,
          fileType: 'gemini-enterprise',
          file: child,
          loading: false,
          error: null,
          models: [{ id: 'gemini-text', display_name: 'Text model' }],
          excluded: {},
          testsEnabled: true,
          onClose: noOp,
          onCopyText: noOp,
        })
      );
      expect(modal).toContain(translations.gemini_enterprise.models.untested);
      expect(modal).toContain(translations.gemini_enterprise.models.pinned);
      expect(modal).toContain('fixture-engine');
      expect(modal).toContain('Text model');
      expect(modal).not.toContain(translations.auth_files.model_test_state_ok);
      const stale = render(
        createElement(GeminiEnterpriseQuotaBody, {
          state: {
            loading: false,
            fetchedAtMs: 0,
            data: normalizeGeminiEnterpriseQuota({
              ...childResponse(),
              reset_at: '2000-01-01T00:00:00Z',
            }),
          },
        })
      );
      expect(stale).toContain(translations.gemini_enterprise.quota.not_provided);
      expect(stale).not.toContain('<strong>93</strong>');
      for (const status of ['partial', 'stale']) {
        const response = childResponse();
        const observed = render(
          createElement(GeminiEnterpriseQuotaBody, {
            state: {
              loading: false,
              fetchedAtMs: Date.now(),
              data: normalizeGeminiEnterpriseQuota({
                ...response,
                status,
                selected_pool: { ...response.selected_pool, status, used: null },
              }),
            },
          })
        );
        expect(observed).toContain(translations.gemini_enterprise.quota[status]);
        expect(observed).toContain('<dd>100</dd>');
        expect(observed).toContain(translations.gemini_enterprise.quota.not_provided);
      }
    });
});
