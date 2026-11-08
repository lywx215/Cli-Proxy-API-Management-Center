import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { apiClient } from '@/services/api/client';
import {
  enterpriseWebApi,
  normalizeEnterpriseWebSummary,
} from '@/services/api/geminiEnterpriseWeb';
import {
  authFileModelTestsApi,
  normalizeWebModelTestResult,
} from '@/services/api/authFileModelTests';
import { canTestEnterpriseFile, modelTestIdentity } from '@/features/authFiles/modelTesting';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import type { AuthFileItem } from '@/types';
import en from '@/i18n/locales/en.json';

const summary = normalizeEnterpriseWebSummary({
  model_policy: 'exclude_argon',
  effective_model_ids: ['gemini-3.5-flash'],
  revision: 4,
  cookie_present: true,
  page_url: 'https://vertexaisearch.cloud.google.com/ca/home/cid/test',
  available_models: [{ id: 'gemini-3.5-flash', display_name: 'Gemini Flash' }],
  catalog_updated_at: '2026-11-03T12:00:00Z',
})!;
const file: AuthFileItem = {
  name: 'web.json',
  type: 'gemini-enterprise-web',
  authIndex: 'web-index',
  geminiEnterpriseWeb: summary,
};
const response = {
  status: 'ok',
  model: 'shared-alias',
  upstream_model: 'gemini-3.5-flash',
  auth_index: 'web-index',
  revision: 4,
  checked_at: '2026-11-03T12:01:00Z',
  elapsed_ms: 100,
  http_status: 200,
  provider: 'gemini-enterprise-web',
  test_kind: 'inline_media',
  message: 'Media verified',
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('Enterprise Web available models and shared aliases', () => {
  test('credential forms and serialization cannot save model mappings', async () => {
    const source = readFileSync(
      new URL(
        '../src/features/authFiles/enterpriseWeb/EnterpriseWebCredentialDialog.tsx',
        import.meta.url
      ),
      'utf8'
    );
    expect(source).not.toContain('edit.models');
    expect(source).not.toContain('add_mapping');
    expect(source).toContain('enterprise_web.alias_hint');
    const post = spyOn(apiClient, 'post').mockResolvedValue({});
    cleanups.push(() => post.mockRestore());
    const edit = {
      label: 'Web',
      pageUrl: summary.pageUrl,
      userAgent: '',
      proxyUrl: '',
      priority: 0,
      modelPolicy: 'exclude_argon' as const,
      cookies: 'SID=synthetic; SAPISID=synthetic',
      models: [{ name: 'legacy', id: 'legacy-id' }],
    };
    await enterpriseWebApi.saveCredential(edit);
    expect(post.mock.calls[0][1]).not.toHaveProperty('models');
    expect(normalizeEnterpriseWebSummary({ models: edit.models })).toMatchObject({
      availableModels: [],
    });
  });

  test('media testing requires a current enabled credential and an observed catalog', () => {
    expect(canTestEnterpriseFile(file)).toBe(true);
    expect(canTestEnterpriseFile({ ...file, disabled: true })).toBe(false);
    expect(
      canTestEnterpriseFile({
        ...file,
        geminiEnterpriseWeb: { ...summary, availableModels: [], effectiveModelIds: [] },
      })
    ).toBe(false);
    expect(
      canTestEnterpriseFile({ ...file, geminiEnterpriseWeb: { ...summary, revision: 0 } })
    ).toBe(false);
    expect(modelTestIdentity(file)).not.toBe(
      modelTestIdentity({ ...file, geminiEnterpriseWeb: { ...summary, revision: 5 } })
    );
  });

  test('test results require media verification and no fabricated OAuth resource binding', () => {
    expect(normalizeWebModelTestResult(response)).toMatchObject({
      status: 'ok',
      upstreamModel: 'gemini-3.5-flash',
      testKind: 'inline_media',
    });
    expect(normalizeWebModelTestResult(response).resources).toBeUndefined();
    for (const invalid of [
      { ...response, test_kind: 'text' },
      { ...response, revision: 0 },
      { ...response, provider: 'gemini-enterprise' },
      { ...response, http_status: 502 },
    ])
      expect(() => normalizeWebModelTestResult(invalid)).toThrow();
  });

  test('pins the credential, revision and upstream ID when testing an OAuth alias', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue(response);
    cleanups.push(() => post.mockRestore());
    const signal = new AbortController().signal;
    expect(
      (await authFileModelTestsApi.test(file, 'shared-alias', signal, 'gemini-3.5-flash')).status
    ).toBe('ok');
    expect(post).toHaveBeenCalledWith(
      '/credentials/gemini-enterprise-web/models/test',
      {
        name: 'web.json',
        auth_index: 'web-index',
        model: 'shared-alias',
        expected_upstream_model: 'gemini-3.5-flash',
        expected_revision: 4,
      },
      { signal, timeout: 0 }
    );
    post.mockResolvedValue({ ...response, upstream_model: 'other-model' });
    await expect(
      authFileModelTestsApi.test(file, 'shared-alias', signal, 'gemini-3.5-flash')
    ).rejects.toThrow();
    post.mockResolvedValue({ ...response, revision: 5 });
    await expect(
      authFileModelTestsApi.test(file, 'shared-alias', signal, 'gemini-3.5-flash')
    ).rejects.toThrow();
  });

  test('model dialog shows available models and media tests with a shared alias editor link', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(AuthFileModelsModal, {
          open: true,
          fileName: file.name,
          fileType: 'gemini-enterprise-web',
          file,
          loading: false,
          error: null,
          models: [{ id: 'shared-alias', upstream_model: 'gemini-3.5-flash' }],
          excluded: {},
          testsEnabled: true,
          onClose: () => {},
          onCopyText: () => {},
        })
      )
    );
    expect(html).toContain('shared-alias');
    expect(html).toContain('gemini-3.5-flash');
    expect(html).toContain('oauth-model-alias?provider=gemini-enterprise-web');
    expect(html).toContain('generated image');
    expect(html).toContain(i18n.t('auth_files.model_test_all'));
    expect(html).not.toContain(i18n.t('gemini_enterprise.fields.engineId'));
  });
});
