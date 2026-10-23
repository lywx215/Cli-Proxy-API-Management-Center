import { describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { oauthApi, type BuiltInOAuthProvider } from '@/services/api/oauth';
import {
  GEMINI_ENTERPRISE_CALLBACK_URL,
  geminiEnterpriseApi,
  GeminiEnterpriseConfigConflict,
  normalizeGeminiEnterpriseConfig,
  readGeminiEnterpriseConfig,
  serializeGeminiEnterpriseConfig,
} from '@/services/api/geminiEnterprise';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import {
  GEMINI_ENTERPRISE_APPLICATION,
  validateGeminiEnterpriseConfig,
  validateGeminiEnterpriseCallback,
  withGeminiEnterpriseApplication,
} from '@/features/oauth/geminiEnterprise';
import { OAUTH_PROVIDERS, supportsManualCallback } from '@/features/oauth/providers';
import { GeminiEnterpriseSettings } from '@/features/oauth/components/GeminiEnterpriseSettings';
import { GeminiEnterpriseBinding } from '@/features/authFiles/components/GeminiEnterpriseBinding';
import {
  QUOTA_PROVIDER_TYPES,
  getTypeLabel,
  supportsAuthFileManualRefresh,
} from '@/features/authFiles/constants';
import { matchesAuthFileSearch, resolveAuthFileQuotaType } from '@/features/authFiles/logic';
import { providerLabel } from '@/features/dashboard/utils';
import { runVisualConfig } from './helpers/visualConfig';
import type { useGeminiEnterpriseConfig } from '@/features/oauth/hooks/useGeminiEnterpriseConfig';
import en from '@/i18n/locales/en.json';

const binding = normalizeGeminiEnterpriseConfig({
  'client-id': 'synthetic.apps.googleusercontent.com',
  'project-id': 'test-project',
  'engine-id': 'test-engine',
});
const raw = (value = binding) => ({
  oauth: { providers: { 'gemini-enterprise': serializeGeminiEnterpriseConfig(value) } },
});
const snapshot = (data: unknown, etag = '"fixture-revision"') =>
  ({ data, headers: { etag } }) as Awaited<ReturnType<typeof apiClient.getRaw>>;

describe('Gemini Enterprise OAuth and configuration', () => {
  test('uses the v8 provider with manual callbacks and never sends a Gemini CLI project override', async () => {
    const provider: BuiltInOAuthProvider = 'gemini-enterprise';
    const card = OAUTH_PROVIDERS.find((entry) => entry.id === provider)!;
    expect(card).toMatchObject({ label: 'Gemini Enterprise', flow: 'browser' });
    expect(supportsManualCallback(card)).toBe(true);
    const get = spyOn(apiClient, 'get').mockResolvedValue({
      state: 'fixture-state',
      url: 'https://accounts.google.com/',
    });
    const post = spyOn(apiClient, 'post').mockResolvedValue({ status: 'ok' });
    const signal = new AbortController().signal;
    try {
      await oauthApi.startAuth(provider, signal, { projectId: 'ALL' });
      expect(get).toHaveBeenLastCalledWith('/oauth/auth-url', {
        params: { provider, is_webui: true },
        signal,
      });
      await oauthApi.submitCallback(provider, GEMINI_ENTERPRISE_CALLBACK_URL, signal);
      expect(post).toHaveBeenLastCalledWith(
        '/oauth/callback',
        { provider, redirect_url: GEMINI_ENTERPRISE_CALLBACK_URL },
        { signal }
      );
    } finally {
      get.mockRestore();
      post.mockRestore();
    }
  });

  test('normalizes defaults and writes only documented nonsecret fields', () => {
    expect(readGeminiEnterpriseConfig(raw())).toEqual(binding);
    expect(binding).toMatchObject({
      location: 'global',
      collectionId: 'default_collection',
      assistantId: 'default_assistant',
      clientSecretEnv: '',
    });
    const payload = serializeGeminiEnterpriseConfig({
      ...binding,
      clientSecretEnv: 'ENTERPRISE_SECRET',
      clientSecret: 'do-not-write',
    } as typeof binding);
    expect(payload['client-secret-env']).toBe('ENTERPRISE_SECRET');
    expect(JSON.stringify(payload)).not.toContain('do-not-write');
    expect(validateGeminiEnterpriseConfig(binding)).toEqual({});
    expect(
      validateGeminiEnterpriseConfig({
        ...binding,
        clientSecretEnv: 'GOCSPX-not-an-environment-name',
      }).clientSecretEnv
    ).toBe('environment');
    expect(validateGeminiEnterpriseConfig({ ...binding, engineId: '../escape' }).engineId).toBe(
      'resource'
    );
    expect(validateGeminiEnterpriseConfig({ ...binding, projectId: '' }).projectId).toBe(
      'resource'
    );
  });

  test('preserves siblings and protects saving with the latest revision', async () => {
    const get = spyOn(apiClient, 'getRaw').mockResolvedValue(
      snapshot({ ...raw(), server: { port: 8317 } })
    );
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
    const next = withGeminiEnterpriseApplication({ ...binding, engineId: 'new-engine' });
    try {
      await geminiEnterpriseApi.save(next, binding);
      expect(patch).toHaveBeenLastCalledWith(
        '/config/oauth/providers/gemini-enterprise',
        serializeGeminiEnterpriseConfig(next),
        { signal: undefined, headers: { 'If-Match': '"fixture-revision"' } }
      );
      expect(serializeGeminiEnterpriseConfig(next)).toMatchObject({
        'client-id': GEMINI_ENTERPRISE_APPLICATION.clientId,
        'client-secret-env': GEMINI_ENTERPRISE_APPLICATION.clientSecretEnv,
      });
      get.mockResolvedValue(snapshot(raw({ ...binding, engineId: 'changed-elsewhere' })));
      await expect(geminiEnterpriseApi.save(next, binding)).rejects.toBeInstanceOf(
        GeminiEnterpriseConfigConflict
      );
      get.mockResolvedValue(snapshot(raw({ ...binding, clientId: 'changed-client' })));
      await expect(geminiEnterpriseApi.save(next, binding)).rejects.toBeInstanceOf(
        GeminiEnterpriseConfigConflict
      );
      expect(patch).toHaveBeenCalledTimes(1);
    } finally {
      get.mockRestore();
      patch.mockRestore();
    }
  });

  test('revalidates an unchanged binding before authorization without rewriting it', async () => {
    const get = spyOn(apiClient, 'getRaw').mockResolvedValue(snapshot(raw()));
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
    try {
      await geminiEnterpriseApi.save(binding, binding);
      expect(get).toHaveBeenCalledWith('/config', { signal: undefined });
      expect(patch).not.toHaveBeenCalled();
      get.mockResolvedValue(snapshot(raw({ ...binding, engineId: 'changed-elsewhere' })));
      await expect(geminiEnterpriseApi.save(binding, binding)).rejects.toBeInstanceOf(
        GeminiEnterpriseConfigConflict
      );
      expect(patch).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      patch.mockRestore();
    }
  });

  test('does not write after connection ABA changes, cancellation or a missing revision', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({});
    const revision = spyOn(apiClient, 'getConnectionRevision').mockReturnValue(5);
    const get = spyOn(apiClient, 'getRaw').mockImplementation(async () => {
      revision.mockReturnValue(7);
      return snapshot(raw());
    });
    try {
      await expect(geminiEnterpriseApi.save(binding, binding)).rejects.toMatchObject({
        name: 'AbortError',
      });
      revision.mockReturnValue(8);
      get.mockResolvedValue(snapshot(raw()));
      const controller = new AbortController();
      controller.abort();
      await expect(
        geminiEnterpriseApi.save(binding, binding, controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' });
      get.mockResolvedValue(snapshot(raw(), ''));
      await expect(geminiEnterpriseApi.save(binding, binding)).rejects.toBeInstanceOf(
        GeminiEnterpriseConfigConflict
      );
      expect(patch).not.toHaveBeenCalled();
    } finally {
      patch.mockRestore();
      revision.mockRestore();
      get.mockRestore();
    }
  });

  test('validates callback origin, attempt state, duplicate state and authorization result', () => {
    const valid = `${GEMINI_ENTERPRISE_CALLBACK_URL}?state=current&code=synthetic-code`;
    expect(validateGeminiEnterpriseCallback(valid, 'current')).toBeNull();
    expect(
      validateGeminiEnterpriseCallback(
        `${GEMINI_ENTERPRISE_CALLBACK_URL}?state=current&error=access_denied`,
        'current'
      )
    ).toBeNull();
    expect(validateGeminiEnterpriseCallback(valid, 'old')).toBe('state');
    expect(validateGeminiEnterpriseCallback(valid + '&state=current', 'current')).toBe('state');
    expect(validateGeminiEnterpriseCallback(valid + '&code=other', 'current')).toBe('code');
    for (const input of [
      'raw-code',
      valid.replace('localhost:8788', 'evil.example'),
      valid.replace('8788', '8789'),
      valid.replace('/oauth-callback', '/wrong'),
      valid.replace('localhost', 'user@localhost'),
      valid + '#fragment',
    ]) {
      expect(validateGeminiEnterpriseCallback(input, 'current')).toBe('url');
    }
    expect(
      validateGeminiEnterpriseCallback(`${GEMINI_ENTERPRISE_CALLBACK_URL}?state=current`, 'current')
    ).toBe('code');
  });

  test('visual edits preserve the entire Enterprise binding and unrelated unknown fields', () => {
    // Use a real YAML document with a sibling edited by the visual codec.
    const source =
      'config-version: 8\nrequests: {proxy-url: ""}\noauth:\n  providers:\n    gemini-enterprise: ' +
      JSON.stringify({ ...serializeGeminiEnterpriseConfig(binding), 'future-option': 'keep' }) +
      '\n';
    const visual = runVisualConfig(source, [{ proxyUrl: 'http://proxy.example' }]);
    const result = parse(visual.applyVisualChangesToYaml(source));
    expect(result.oauth.providers['gemini-enterprise']).toEqual({
      ...serializeGeminiEnterpriseConfig(binding),
      'future-option': 'keep',
    });
  });
});

describe('Gemini Enterprise account presentation and localization', () => {
  test('uses the provider identity and resource summary without inventing quota support', async () => {
    const files = normalizeAuthFilesResponse({
      files: [
        {
          name: 'enterprise.json',
          type: 'gemini-enterprise',
          email: 'fixture@example.com',
          gemini_enterprise: {
            client_id: 'synthetic-client',
            project_id: 'test-project',
            engine_id: 'test-engine',
            has_refresh_token: true,
            access_token: 'do-not-display',
            refresh_token: 'do-not-display',
          },
        },
      ],
    }).files;
    const file = files[0];
    expect(file.geminiEnterprise).toMatchObject({ engineId: 'test-engine', hasRefreshToken: true });
    expect(matchesAuthFileSearch(file, 'test-engine', null)).toBe(true);
    expect(supportsAuthFileManualRefresh('gemini-enterprise')).toBe(true);
    expect([...QUOTA_PROVIDER_TYPES]).not.toContain('gemini-enterprise');
    expect(resolveAuthFileQuotaType(file, 'all')).toBeNull();
    expect(providerLabel('gemini-enterprise', 'Unknown')).toBe('Gemini Enterprise');
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    expect(getTypeLabel(i18n.t, 'gemini-enterprise')).toBe('Gemini Enterprise');
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(GeminiEnterpriseBinding, { binding: file.geminiEnterprise })
      )
    );
    expect(markup).toContain('test-engine');
    expect(markup).toContain(en.gemini_enterprise.renewal_ready);
    expect(markup).not.toContain('do-not-display');
    expect(markup).not.toContain('gemini_enterprise.');
  });

  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
    test(`renders configuration and renewal guidance in ${locale}`, async () => {
      const translations = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      const i18n = createInstance();
      await i18n.init({ lng: locale, resources: { [locale]: { translation: translations } } });
      const config: ReturnType<typeof useGeminiEnterpriseConfig> = {
        value: withGeminiEnterpriseApplication(binding),
        errors: {},
        dirty: false,
        loading: false,
        saving: false,
        error: '',
        configured: true,
        startDisabled: false,
        setField: () => {},
        retry: () => {},
        save: async () => true,
      };
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(GeminiEnterpriseSettings, { config, locked: false })
        )
      );
      expect(markup).toContain(GEMINI_ENTERPRISE_CALLBACK_URL);
      expect(markup).toContain('test-project');
      expect(markup).toContain('test-engine');
      expect(markup).not.toContain(GEMINI_ENTERPRISE_APPLICATION.clientId);
      expect(markup).not.toContain(GEMINI_ENTERPRISE_APPLICATION.clientSecretEnv);
      expect(markup).not.toContain(translations.gemini_enterprise.fields.clientId);
      expect(markup).not.toContain(translations.gemini_enterprise.fields.clientSecretEnv);
      expect(markup).not.toContain('gemini_enterprise.');
      expect(markup).not.toContain('type="password"');
      for (const key of Object.keys(en.auth_login).filter((key) =>
        key.startsWith('gemini_enterprise_')
      ))
        expect(translations.auth_login[key]).toBeTruthy();
      for (const key of Object.keys(en.gemini_enterprise))
        expect(translations.gemini_enterprise[key]).toBeTruthy();
    });
  }
});
