import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { parse } from 'yaml';
import { apiClient } from '@/services/api/client';
import {
  enterpriseWebApi,
  getEnterpriseWebEditError,
  normalizeEnterpriseWebStatus,
  normalizeEnterpriseWebSummary,
  parseEnterpriseWebPage,
  validEnterpriseWebSettings,
} from '@/services/api/geminiEnterpriseWeb';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import {
  getTypeLabel,
  supportsAuthFileManualRefresh,
  QUOTA_PROVIDER_TYPES,
} from '@/features/authFiles/constants';
import { canTestEnterpriseFile } from '@/features/authFiles/modelTesting';
import { collectUsageDetails, getApiStats, getModelStats } from '@/utils/usage';
import { ModelStatsCard } from '@/components/usage/ModelStatsCard';
import { ApiDetailsCard } from '@/components/usage/ApiDetailsCard';
import { normalizeRequestTokenCounts } from '@/utils/usage/tokenAvailability';
import { EnterpriseWebStatus } from '@/features/authFiles/enterpriseWeb/EnterpriseWebStatus';
import { providerLabel } from '@/features/dashboard/utils';
import { runVisualConfig } from './helpers/visualConfig';
import en from '@/i18n/locales/en.json';

const rawStatus = {
  enabled: false,
  max_concurrent: 2,
  max_inflight_bytes: 268435456,
  active_requests: 1,
  inflight_bytes: 33554432,
  rejected_concurrency: 3,
  rejected_memory: 1,
  draining: true,
};
const settings = { enabled: false, maxConcurrent: 2, maxInflightBytes: 268435456 };
const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});
function mockGet(value: unknown) {
  const mock = spyOn(apiClient, 'get').mockResolvedValue(value);
  restores.push(() => mock.mockRestore());
  return mock;
}

describe('Enterprise Web management boundary', () => {
  test('accepts Plus Google cookies, preserves them on edit, and rejects Business', () => {
    const edit = {
      label: 'synthetic',
      pageUrl: 'https://vertexaisearch.cloud.google.com/ca/home/cid/synthetic?hl=zh_CN',
      cookies: 'SID=synthetic; SAPISID=synthetic',
      userAgent: '',
      proxyUrl: '',
      priority: 0,
      modelPolicy: 'exclude_argon' as const,
    };
    expect(getEnterpriseWebEditError(edit)).toBeNull();
    expect(
      getEnterpriseWebEditError({
        ...edit,
        pageUrl: 'https://business.gemini.google/cid/test?csesidx=1',
      })
    ).toBe('invalid_url');
    expect(getEnterpriseWebEditError({ ...edit, cookies: '__Secure-C_SES=synthetic' })).toBe(
      'missing_cookie'
    );
    expect(getEnterpriseWebEditError({ ...edit, name: 'saved.json', cookies: '' })).toBeNull();
    expect(getEnterpriseWebEditError({ ...edit, priority: 1000001 })).toBe('invalid_priority');
  });
  test('creation belongs to OAuth and the only Web settings controls belong to Configuration', () => {
    const authPage = readFileSync(
      new URL('../src/features/authFiles/AuthFilesPage.tsx', import.meta.url),
      'utf8'
    );
    const dialog = readFileSync(
      new URL(
        '../src/features/authFiles/enterpriseWeb/EnterpriseWebCredentialDialog.tsx',
        import.meta.url
      ),
      'utf8'
    );
    const oauthPage = readFileSync(
      new URL('../src/features/oauth/OAuthPage.tsx', import.meta.url),
      'utf8'
    );
    const network = readFileSync(
      new URL('../src/features/config/components/sections/SectionNetwork.tsx', import.meta.url),
      'utf8'
    );
    expect(authPage).not.toContain('EnterpriseWebPanel');
    expect(authPage).toContain('{webEditing &&');
    expect(dialog).not.toContain('saveSettings');
    expect(dialog).not.toContain('ToggleSwitch');
    expect(oauthPage).toContain('GeminiEnterpriseWebImport');
    expect(network).toContain('fieldId="geminiEnterpriseWebEnabled"');
    expect(network).toContain('fieldId="geminiEnterpriseWebMaxConcurrent"');
    expect(network).toContain('fieldId="geminiEnterpriseWebMaxInflightBytes"');
  });
  test('normalizes false, drain state, and rejects unknown/invalid backend replies', () => {
    expect(normalizeEnterpriseWebStatus(rawStatus)).toMatchObject({
      ...settings,
      activeRequests: 1,
      draining: true,
    });
    for (const invalid of [
      '<html/>',
      {},
      { ...rawStatus, enabled: 'false' },
      { ...rawStatus, active_requests: -1 },
    ]) {
      expect(() => normalizeEnterpriseWebStatus(invalid)).toThrow();
    }
    expect(validEnterpriseWebSettings({ ...settings, maxConcurrent: 0 })).toBe(false);
    expect(validEnterpriseWebSettings({ ...settings, maxInflightBytes: 50 * 1048576 })).toBe(false);
  });
  test('shows fallback reasons only when both counters are available', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const counters = { web_disabled: 0, no_web_credential: 7, 'unknown-reason': 9 };
    const status = normalizeEnterpriseWebStatus({ ...rawStatus, media_fallback_requests: counters });
    expect(status.mediaFallbackRequests).toEqual({ webDisabled: 0, noWebCredential: 7 });

    const render = (value: typeof status, error = false) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(EnterpriseWebStatus, { status: value, error })
        )
      );
    expect(render(status)).toContain(
      'Text fallbacks · Web disabled 0 · No eligible Web credential 7'
    );
    expect(render(status, true)).not.toContain('Text fallbacks');
    for (const media_fallback_requests of [
      undefined,
      { web_disabled: 0 },
      { ...counters, no_web_credential: -1 },
      { ...counters, no_web_credential: '7' },
    ]) {
      const legacy = normalizeEnterpriseWebStatus({ ...rawStatus, media_fallback_requests });
      expect(legacy.mediaFallbackRequests).toBeUndefined();
      expect(render(legacy)).not.toContain('Text fallbacks');
    }
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const locale = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8')
      );
      expect(locale.enterprise_web.scope_with_media_fallback.length).toBeGreaterThan(0);
      expect(locale.enterprise_web.media_fallback_counts).toContain('{{webDisabled}}');
      expect(locale.enterprise_web.media_fallback_counts).toContain('{{noWebCredential}}');
    }
  });
  test('parses the Plus origin, region and account index without guessing global', () => {
    expect(
      parseEnterpriseWebPage('https://vertexaisearch.cloud.google.com/ca/home/cid/config?hl=zh_CN')
    ).toEqual({ location: 'ca', authUser: '0', configId: 'config' });
    expect(
      parseEnterpriseWebPage('https://vertexaisearch.cloud.google.com/home/cid/config')
    ).toEqual({ location: 'global', authUser: '0', configId: 'config' });
    expect(
      parseEnterpriseWebPage(
        'https://vertexaisearch.cloud.google.com/u/1/eu/home/cid/config/r/session/example'
      )
    ).toEqual({ location: 'eu', authUser: '1', configId: 'config' });
    for (const invalid of [
      'http://vertexaisearch.cloud.google.com/home/cid/config',
      'https://evil.example/home/cid/config',
      'https://vertexaisearch.cloud.google.com/home/cid/config?authuser=1&authuser=2',
      'https://user@vertexaisearch.cloud.google.com/home/cid/config',
      'https://vertexaisearch.cloud.google.com/ca/home/cid/config/cid/other',
    ])
      expect(parseEnterpriseWebPage(invalid)).toBeNull();
  });
  test('keeps only safe summaries and upstream available models in frontend records', () => {
    const summary = {
      page_url: 'https://vertexaisearch.cloud.google.com/ca/home/cid/config',
      revision: 3,
      cookie_present: true,
      user_agent: 'Synthetic Enterprise Web Agent/1.0',
      available_models: [{ id: 'real-id', display_name: 'Actual model' }],
      cookies: 'synthetic-secret',
      jwt: 'synthetic-jwt',
      tested_model_ids: [],
    };
    expect(normalizeEnterpriseWebSummary(summary)).toMatchObject({
      revision: 3,
      cookiePresent: true,
      userAgent: 'Synthetic Enterprise Web Agent/1.0',
      availableModels: [{ id: 'real-id', displayName: 'Actual model' }],
      testedModelIds: [],
    });
    const files = normalizeAuthFilesResponse({
      files: [{ name: 'web.json', type: 'gemini-enterprise-web', gemini_enterprise_web: summary }],
    });
    expect(JSON.stringify(files)).not.toContain('synthetic-secret');
    expect(JSON.stringify(files)).not.toContain('synthetic-jwt');
  });
  test('uses the v8 settings path, writes false, and confirms actual state', async () => {
    const get = mockGet(rawStatus);
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
    restores.push(() => patch.mockRestore());
    expect((await enterpriseWebApi.saveSettings(settings)).enabled).toBe(false);
    expect(patch).toHaveBeenCalledWith('/config/upstream/gemini-enterprise-web', {
      enabled: false,
      'max-concurrent': 2,
      'max-inflight-bytes': 268435456,
    });
    expect(get).toHaveBeenCalledWith('/credentials/gemini-enterprise-web/status');
    get.mockResolvedValue({ ...rawStatus, enabled: true });
    await expect(enterpriseWebApi.saveSettings(settings)).rejects.toMatchObject({
      code: 'settings_not_effective',
    });
    get.mockRejectedValue({ status: 404 });
    await expect(enterpriseWebApi.status()).rejects.toMatchObject({ status: 404 });
    expect(get.mock.calls.every(([path]) => String(path).startsWith('/credentials/'))).toBe(true);
  });
  test('reads renewal status and timestamps while dropping unknown reasons', () => {
    const at = '2026-11-04T12:00:00Z';
    expect(
      normalizeEnterpriseWebSummary({
        cookie_check_status: 'renewal_degraded',
        cookie_check_reason: 'candidate_rejected',
        cookie_checked_at: at,
        cookie_last_verified_at: at,
        cookie_last_renewed_at: at,
        cookie_next_check_at: at,
      })
    ).toMatchObject({
      cookieCheckStatus: 'renewal_degraded',
      cookieCheckReason: 'candidate_rejected',
      cookieCheckedAt: at,
      cookieLastVerifiedAt: at,
      cookieLastRenewedAt: at,
      cookieNextCheckAt: at,
    });
    expect(
      normalizeEnterpriseWebSummary({ cookie_check_reason: 'arbitrary' })?.cookieCheckReason
    ).toBeUndefined();
    expect(normalizeEnterpriseWebSummary({})?.cookieNextCheckAt).toBeUndefined();
    expect(normalizeEnterpriseWebSummary({})?.userAgent).toBeUndefined();
  });
  test('omits unchanged cookies and never sends credential-local mappings', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ ok: true });
    restores.push(() => patch.mockRestore());
    const edit = {
      name: 'web.json',
      expectedRevision: 2,
      label: 'fixture',
      pageUrl: 'page',
      userAgent: '',
      proxyUrl: '',
      priority: 0,
      modelPolicy: 'exclude_argon' as const,
    };
    await enterpriseWebApi.saveCredential(edit);
    expect(JSON.stringify(patch.mock.calls[0][1])).not.toContain('cookies');
    await enterpriseWebApi.saveCredential({ ...edit, cookies: 'SID=synthetic; SAPISID=synthetic' });
    expect(patch.mock.calls[1]).toEqual([
      '/credentials/gemini-enterprise-web',
      expect.objectContaining({
        expected_revision: 2,
        cookies: 'SID=synthetic; SAPISID=synthetic',
      }),
    ]);
    await enterpriseWebApi.saveCredential({ ...edit, userAgent: undefined });
    expect(patch.mock.calls[2][1]).not.toHaveProperty('user_agent');
    await enterpriseWebApi.saveCredential({ ...edit, userAgent: '' });
    expect(patch.mock.calls[3][1]).toHaveProperty('user_agent', '');
  });
  test('connection changes invalidate dependent writes/results', async () => {
    const revision = spyOn(apiClient, 'getConnectionRevision');
    restores.push(() => revision.mockRestore());
    let current = 1;
    revision.mockImplementation(() => current);
    const patch = spyOn(apiClient, 'patch').mockImplementation(async () => {
      current = 2;
      return {};
    });
    restores.push(() => patch.mockRestore());
    const get = mockGet(rawStatus);
    await expect(enterpriseWebApi.saveSettings(settings)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('Enterprise Web frontend correspondence', () => {
  test('visual YAML round trip preserves false and unrelated edits', () => {
    const yaml =
      'config-version: 8\nupstream:\n  gemini-enterprise-web:\n    enabled: false\n    max-concurrent: 2\n    max-inflight-bytes: 268435456\n  codex: {response-steering: true}\n';
    const result = runVisualConfig(yaml, [{ debug: true }]);
    const saved = parse(result.applyVisualChangesToYaml(yaml));
    expect(saved.upstream['gemini-enterprise-web']).toEqual({
      enabled: false,
      'max-concurrent': 2,
      'max-inflight-bytes': 268435456,
    });
    const changed = runVisualConfig(yaml, [
      { geminiEnterpriseWebEnabled: true, geminiEnterpriseWebMaxConcurrent: '3' },
    ]);
    expect(parse(changed.applyVisualChangesToYaml(yaml)).upstream.codex['response-steering']).toBe(
      true
    );
    expect(
      parse(changed.applyVisualChangesToYaml(yaml)).upstream['gemini-enterprise-web'].enabled
    ).toBe(true);
  });
  test('Web has independent labels and requires an observed catalog before media testing', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    expect(getTypeLabel(i18n.t, 'gemini-enterprise-web')).toBe('Gemini Enterprise Web');
    expect(providerLabel('gemini-enterprise-web')).toBe('Gemini Enterprise Web');
    expect(supportsAuthFileManualRefresh('gemini-enterprise-web')).toBe(true);
    expect(QUOTA_PROVIDER_TYPES.has('gemini-enterprise-web' as never)).toBe(false);
    expect(canTestEnterpriseFile({ name: 'web.json', type: 'gemini-enterprise-web' })).toBe(false);
  });
  test('unknown Web tokens remain unknown and effective shutdown does not hide draining work', async () => {
    const tokens = normalizeRequestTokenCounts(
      { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      'gemini-enterprise-web'
    );
    expect(tokens.input_tokens).toBeNull();
    expect(tokens.total_tokens).toBeNull();
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const render = (error: boolean) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(EnterpriseWebStatus, {
            status: normalizeEnterpriseWebStatus(rawStatus),
            error,
          })
        )
      );
    expect(render(false)).toContain('Draining accepted requests');
    expect(render(true)).toContain('Unknown');
    expect(render(true)).not.toContain('Disabled');
  });
  test('Web unknown tokens stay unknown in aggregate model and API cards', async () => {
    const detail = {
      provider: 'gemini-enterprise-web',
      timestamp: '2026-11-03T10:00:00Z',
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
    const usage = {
      total_requests: 1,
      total_tokens: 0,
      apis: {
        synthetic: {
          total_requests: 1,
          total_tokens: 0,
          models: { 'observed-web-id': { total_requests: 1, total_tokens: 0, details: [detail] } },
        },
      },
    };
    expect(collectUsageDetails(usage)[0].tokens.total_tokens).toBeNull();
    const models = getModelStats(usage, {});
    const apis = getApiStats(usage, {});
    expect(models[0].tokensIncomplete).toBe(true);
    expect(apis[0].tokensIncomplete).toBe(true);
    expect(apis[0].models['observed-web-id'].tokensIncomplete).toBe(true);
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    for (const view of [
      createElement(ModelStatsCard, { modelStats: models, loading: false, hasPrices: false }),
      createElement(ApiDetailsCard, { apiStats: apis, loading: false, hasPrices: false }),
    ]) {
      const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, view));
      expect(html).toContain(en.usage_stats.tokens_unavailable);
    }
  });
  test('all six languages cover every new message and keyboard action name', () => {
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const locale = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8')
      );
      expect(Object.keys(locale.enterprise_web).sort()).toEqual(
        Object.keys(en.enterprise_web).sort()
      );
      expect(
        Object.values(locale.enterprise_web)
          .flatMap((value) =>
            typeof value === 'object' && value !== null ? Object.values(value) : [value]
          )
          .every((text) => typeof text === 'string' && text.length > 0)
      ).toBe(true);
    }
  });
});
