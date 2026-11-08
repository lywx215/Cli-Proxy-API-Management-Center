import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import {
  normalizeAuthFilesResponse,
  normalizeAuthFileModelsSnapshot,
} from '@/services/api/authFiles';
import {
  antigravityEnterpriseApi,
  antigravityEnterpriseBindingFiles,
  antigravityEnterpriseIdentity,
  normalizeAntigravityEnterpriseQuota,
} from '@/services/api/antigravityEnterprise';
import {
  authFileModelTestsApi,
  normalizeAntigravityEnterpriseModelTest,
} from '@/services/api/authFileModelTests';
import { apiClient } from '@/services/api/client';
import { canTestEnterpriseFile, modelTestIdentity } from '@/features/authFiles/modelTesting';
import { matchesAuthFileSearch } from '@/features/authFiles/logic';
import { OAUTH_PROVIDERS, supportsManualCallback } from '@/features/oauth/providers';
import { normalizeAuthFileCooldowns } from '@/services/api/authFileCooldowns';
import { canRetrySharedQuota, cooldownReasonKey } from '@/features/authFiles/cooldowns';
import { AuthFileCooldownSection } from '@/features/authFiles/components/AuthFileCooldownSection';
import {
  AntigravityEnterpriseAccount,
  AntigravityEnterpriseQuotaBody,
} from '@/features/authFiles/components/AntigravityEnterpriseAccount';

const rawBinding = {
  binding_id: 'binding-global',
  revision: 3,
  auth_index: 'child-global',
  license: {
    projectId: 'project-one',
    location: 'global',
    userTier: 'gcp-ge-plus-tier',
    tierDisplayName: 'Gemini Enterprise Plus',
  },
  disabled: false,
  effective_disabled: false,
  status: 'active',
  success: 12,
  failed: 2,
  settings: {
    prefix: 'team',
    refresh_token: 'never-copy-this-secret',
    access_token: 'never-copy-access',
    note: 'Fixture binding',
  },
};
const rawAccount = {
  account_id: 'account-one',
  revision: 9,
  account_management_supported: true,
  bindings: [
    rawBinding,
    {
      ...rawBinding,
      binding_id: 'binding-us',
      auth_index: 'child-us',
      license: { ...rawBinding.license, location: 'us' },
    },
  ],
  discovery: { status: 'complete', checked_at: '2026-11-08T08:00:00Z', unreachable: [] },
};
const file = () =>
  normalizeAuthFilesResponse({
    files: [
      {
        name: 'account.json',
        type: 'antigravity-enterprise',
        email: 'fixture@example.test',
        auth_index: 'parent',
        antigravity_enterprise: rawAccount,
      },
    ],
  }).files[0];
const quotaResponse = (bucket: Record<string, unknown> = { remainingFraction: 0 }) => ({
  provider: 'antigravity-enterprise',
  account_id: 'account-one',
  binding_id: 'binding-global',
  revision: 3,
  pool_id: 'pool-one',
  status: 'ok',
  stale: false,
  quota: {
    observed_at: '2026-11-08T08:00:00Z',
    overageInfo: {},
    groups: [{ buckets: [{ bucketId: 'gemini-enterprise-weekly', window: 'weekly', ...bucket }] }],
  },
});
const translate = async (node: ReturnType<typeof createElement>) => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) },
    },
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, node));
};
afterEach(() => {
  mock.restore();
});

describe('Antigravity Enterprise bindings', () => {
  test('retains same-project regional bindings and excludes OAuth material from child views', () => {
    const parent = file();
    const children = antigravityEnterpriseBindingFiles(parent);
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.antigravityEnterprise?.license?.location)).toEqual([
      'global',
      'us',
    ]);
    expect(children.every((child) => child.name === parent.name)).toBe(true);
    expect(children[0].antigravityEnterprise?.settings).toEqual({
      prefix: 'team',
      note: 'Fixture binding',
    });
    expect(JSON.stringify(children)).not.toContain('never-copy');
    expect(modelTestIdentity(children[0])).not.toBe(modelTestIdentity(children[1]));
    expect(canTestEnterpriseFile(parent)).toBe(false);
    expect(canTestEnterpriseFile(children[0])).toBe(true);
    expect(canTestEnterpriseFile({ ...children[0], disabled: true })).toBe(false);
    expect(matchesAuthFileSearch(parent, 'project-one', null)).toBe(true);
  });

  test('account disablement retains per-binding preferences and invalidates fixed-identity tests', () => {
    const parent = file();
    const before = antigravityEnterpriseBindingFiles(parent)[0];
    const after = antigravityEnterpriseBindingFiles({ ...parent, disabled: true })[0];
    expect(after.disabled).toBe(false);
    expect(after.antigravityEnterprise?.effectiveDisabled).toBe(true);
    expect(canTestEnterpriseFile(after)).toBe(false);
    expect(antigravityEnterpriseIdentity(after)).not.toBe(antigravityEnterpriseIdentity(before));
  });

  test('provides ordinary Antigravity browser OAuth without custom Enterprise app inputs', () => {
    const provider = OAUTH_PROVIDERS.find((row) => row.id === 'antigravity-enterprise');
    expect(provider).toBeDefined();
    expect(provider?.flow).toBe('browser');
    expect(supportsManualCallback(provider!)).toBe(true);
  });

  test('renders a grouped account without unrelated application or assistant editors', async () => {
    const noop = () => undefined;
    const html = await translate(
      createElement(AntigravityEnterpriseAccount, {
        file: file(),
        selected: false,
        disableControls: false,
        deleting: null,
        statusUpdating: {},
        manualRefreshing: {},
        onShowModels: noop,
        onDownload: noop,
        onManualRefresh: noop,
        onOpenPrefixProxyEditor: noop,
        onDelete: noop,
        onToggleStatus: noop,
        onToggleSelect: noop,
        onCooldownReset: noop,
      })
    );
    expect(html).toContain('Antigravity Enterprise');
    expect(html).toContain('2 subscription bindings');
    expect(html).toContain('global');
    expect(html).toContain('us');
    expect(html).not.toContain('assistantId');
    expect(html).not.toContain('engineId');
    expect(html).not.toContain('never-copy');
  });
});

describe('weekly quota observations', () => {
  test('preserves explicit zero, leaves missing reset unknown, and recognizes the proto3 overage default', async () => {
    const data = normalizeAntigravityEnterpriseQuota(quotaResponse());
    expect(data.weekly?.remainingFraction).toBe(0);
    expect(data.weekly?.resetAt).toBeNull();
    expect(data.overageEnabled).toBe(false);
    const html = await translate(createElement(AntigravityEnterpriseQuotaBody, { data }));
    expect(html).toContain('0%');
    expect(html).toContain('Reset time not provided');
    expect(html).not.toContain('100%');
  });

  test('unknown and contradictory observations cannot become available balances', () => {
    const missing = quotaResponse({});
    expect(normalizeAntigravityEnterpriseQuota(missing).weekly?.remainingFraction).toBeNull();
    expect(
      normalizeAntigravityEnterpriseQuota(
        quotaResponse({ remainingFraction: 0.5, remainingAmount: '5' })
      ).weekly?.remainingFraction
    ).toBeNull();
    expect(
      normalizeAntigravityEnterpriseQuota(quotaResponse({ remainingFraction: 2 })).weekly
        ?.remainingFraction
    ).toBeNull();
    const noOverage: Record<string, unknown> = { ...missing.quota };
    delete noOverage.overageInfo;
    expect(
      normalizeAntigravityEnterpriseQuota({ ...missing, quota: noOverage }).overageEnabled
    ).toBeNull();
    expect(
      normalizeAntigravityEnterpriseQuota(quotaResponse({ remainingAmount: '9223372036854775807' }))
        .weekly?.remainingAmount
    ).toBe('9223372036854775807');
  });

  test('renders stale observations and overage restrictions independently of the fraction', async () => {
    const response = quotaResponse({ remainingFraction: 0.25 });
    const data = normalizeAntigravityEnterpriseQuota({
      ...response,
      stale: true,
      quota: { ...response.quota, overageInfo: { enabled: true } },
    });
    const html = await translate(createElement(AntigravityEnterpriseQuotaBody, { data }));
    expect(html).toContain('25%');
    expect(html).toContain('Last known observation');
    expect(html).toContain('disabled overage billing');
  });

  test('recognizes weekly shared cooldowns and requires backend support for metadata rechecks', () => {
    const snapshot = normalizeAuthFileCooldowns(
      [
        {
          scope: 'credential',
          origin: 'shared_pool',
          reason: 'weekly_quota',
          feature: 'ai_developer_tools',
          pool_id: 'a'.repeat(64),
          pool_version: 2,
          related_auth_count: 2,
          phase: 'probe_pending',
          retry_at: '2026-11-08T08:00:00Z',
          remaining_seconds: 0,
          restriction_kind: 'weekly',
          restriction_scope: 'edition',
          shared_reset_supported: true,
        },
      ],
      undefined,
      0
    );
    expect(snapshot?.records).toHaveLength(1);
    expect(canRetrySharedQuota(snapshot!.records![0])).toBe(true);
    expect(canRetrySharedQuota({ ...snapshot!.records![0], sharedResetSupported: false })).toBe(
      false
    );
  });
});

test('binding updates and quota reads are pinned to the child index and revision', async () => {
  const child = antigravityEnterpriseBindingFiles(file())[0];
  const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
  await antigravityEnterpriseApi.updateBinding(child, { disabled: true });
  expect(patch).toHaveBeenCalledWith(
    '/credentials/antigravity-enterprise/bindings',
    {
      name: 'account.json',
      auth_index: 'child-global',
      binding_id: 'binding-global',
      revision: 3,
      fields: { disabled: true },
    },
    { signal: undefined }
  );
  patch.mockRestore();
  const get = spyOn(apiClient, 'get').mockResolvedValue(quotaResponse());
  expect((await antigravityEnterpriseApi.quota(child)).bindingId).toBe('binding-global');
  get.mockResolvedValue({ ...quotaResponse(), binding_id: 'binding-us' });
  await expect(antigravityEnterpriseApi.quota(child)).rejects.toThrow();
  get.mockRestore();
});

test('model tests reject stale revisions and another subscription binding', () => {
  const child = antigravityEnterpriseBindingFiles(file())[0];
  const result = {
    status: 'ok',
    model: 'gemini-4-argon-low',
    auth_index: 'child-global',
    binding_id: 'binding-global',
    revision: 3,
    checked_at: '2026-11-08T08:00:00Z',
    elapsed_ms: 1,
    http_status: 200,
    resources: { project_id: 'project-one', location: 'global' },
  };
  expect(normalizeAntigravityEnterpriseModelTest(result, child, result.model).status).toBe('ok');
  expect(() =>
    normalizeAntigravityEnterpriseModelTest({ ...result, revision: 2 }, child, result.model)
  ).toThrow();
  expect(() =>
    normalizeAntigravityEnterpriseModelTest(
      { ...result, binding_id: 'binding-us' },
      child,
      result.model
    )
  ).toThrow();
  expect(() =>
    normalizeAntigravityEnterpriseModelTest(
      { ...result, resources: { project_id: 'project-one', location: 'us' } },
      child,
      result.model
    )
  ).toThrow();
});

test('all six locales expose the same binding-view translation keys', () => {
  const locales = ['en', 'zh-CN', 'zh-TW', 'ko', 'ru', 'vi'].map(
    (lang) =>
      JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8')).antigravity_enterprise
  );
  for (const locale of locales)
    expect(Object.keys(locale).sort()).toEqual(Object.keys(locales[0]).sort());
});

test('weekly metadata recheck times stay distinct from quota reset deadlines', async () => {
  const nextCheck = '2026-11-08T08:01:00Z';
  const snapshot = normalizeAuthFileCooldowns(
    [
      {
        scope: 'credential',
        origin: 'shared_pool',
        reason: 'weekly_quota',
        feature: 'ai_developer_tools',
        pool_id: 'a'.repeat(64),
        pool_version: 2,
        related_auth_count: 2,
        phase: 'probe_pending',
        retry_at: '2026-11-08T08:00:00Z',
        next_check_at: nextCheck,
        remaining_seconds: 0,
        restriction_kind: 'weekly',
        restriction_scope: 'edition',
        shared_reset_supported: true,
      },
    ],
    undefined,
    Date.now()
  );
  expect(snapshot?.records?.[0].nextCheckAt).toBe('2026-11-08T08:01:00.000Z');
  const html = await translate(createElement(AuthFileCooldownSection, { snapshot }));
  expect(html).toContain('Next quota check');
  expect(html).not.toContain('Next quota reset');
  expect(cooldownReasonKey('permission_denied')).toBe('antigravity_enterprise.permission_denied');
});

test('catalog native IDs are preserved while model tests submit the public prefix and alias', async () => {
  const child = antigravityEnterpriseBindingFiles(file())[0];
  const snapshot = normalizeAuthFileModelsSnapshot({
    models: [
      {
        id: 'team/fast',
        native_model: 'gemini-3.8-flash-low',
        upstream_model: 'gemini-3.8-flash-low',
        catalog_source: 'official_default',
      },
    ],
  });
  expect(snapshot.models[0].id).toBe('team/fast');
  expect(snapshot.models[0].native_model).toBe('gemini-3.8-flash-low');
  const post = spyOn(apiClient, 'post').mockResolvedValue({
    status: 'ok',
    model: 'team/fast',
    upstream_model: 'gemini-3.8-flash-low',
    auth_index: 'child-global',
    binding_id: 'binding-global',
    revision: 3,
    checked_at: '2026-11-08T08:00:00Z',
    elapsed_ms: 1,
    http_status: 200,
    resources: { project_id: 'project-one', location: 'global' },
  });
  const signal = new AbortController().signal;
  await authFileModelTestsApi.test(
    child,
    snapshot.models[0].id,
    signal,
    snapshot.models[0].upstream_model
  );
  expect(post).toHaveBeenCalledWith(
    '/credentials/models/test',
    {
      name: 'account.json',
      auth_index: 'child-global',
      binding_id: 'binding-global',
      expected_revision: 3,
      model: 'team/fast',
    },
    { signal, timeout: 0 }
  );
});
