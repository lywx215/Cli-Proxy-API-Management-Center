import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { authFileModelTestsApi, normalizeModelTestResult } from '@/services/api/authFileModelTests';
import { InvalidManagementResponseError } from '@/services/api/managementResponse';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import {
  enterpriseResources,
  serializeEnterpriseResources,
} from '@/features/authFiles/enterpriseResources';
import {
  canTestEnterpriseFile,
  isEnterpriseTextModel,
  modelTestIdentity,
  runSerialModelTests,
  shouldStopModelTests,
  type ModelTestResult,
} from '@/features/authFiles/modelTesting';
import type { AuthFileItem } from '@/types';
import { cooldownReasonKey } from '@/features/authFiles/cooldowns';
import { normalizeAuthFileCooldowns } from '@/services/api/authFileCooldowns';
import { AuthFileCooldownSection } from '@/features/authFiles/components/AuthFileCooldownSection';

const file: AuthFileItem = {
  name: 'enterprise-fixture.json',
  type: 'gemini-enterprise',
  authIndex: 'fixture-auth',
  geminiEnterprise: { projectId: '123', location: 'global', engineId: 'fixture-app' },
  access_token: 'never-send-or-render-this',
};
const raw = {
  status: 'ok',
  model: 'gemini-3.8-flash',
  auth_index: 'fixture-auth',
  resources: serializeEnterpriseResources(enterpriseResources(file.geminiEnterprise)),
  checked_at: '2026-10-25T08:00:00Z',
  elapsed_ms: 1234,
  http_status: 200,
  code: '',
  message: '',
};
const result = (patch: Partial<ModelTestResult> = {}): ModelTestResult => ({
  ...normalizeModelTestResult(raw),
  ...patch,
});

describe('Enterprise model availability test client', () => {
  test('retains the application model cooldown and its dedicated display reason', () => {
    const snapshot = normalizeAuthFileCooldowns(
      [
        {
          scope: 'model',
          model_key: raw.model,
          reason: 'model_not_enabled',
          retry_at: '2026-10-25T08:01:00Z',
          remaining_seconds: 60,
          http_status: 400,
        },
      ],
      undefined,
      0
    );
    expect(snapshot?.records?.[0]).toMatchObject({
      scope: 'model',
      modelKey: raw.model,
      reason: 'model_not_enabled',
      remainingSeconds: 60,
      httpStatus: 400,
    });
    expect(cooldownReasonKey('model_not_enabled')).toBe(
      'auth_files.cooldown_reason_model_not_enabled'
    );
  });
  test('requires enabled Enterprise credentials with an exact auth index and valid binding', () => {
    expect(canTestEnterpriseFile(file)).toBe(true);
    for (const other of [
      null,
      { ...file, disabled: true },
      { ...file, type: 'gemini' },
      { ...file, authIndex: undefined },
      { ...file, geminiEnterprise: { projectId: '123' } },
    ]) {
      expect(canTestEnterpriseFile(other)).toBe(false);
    }
  });

  test('keeps text models and excludes media, audio and embeddings', () => {
    for (const id of [
      'gemini-4-argon',
      'gemini-3.8-flash',
      'gemini-3.1-pro-preview',
      'gemini-2.5-pro',
    ]) {
      expect(isEnterpriseTextModel({ id, type: 'GEMINI' })).toBe(true);
    }
    for (const id of [
      'imagen-4',
      'veo-3',
      'gemini-flash-image',
      'gemini-native-audio',
      'text-embedding-004',
    ]) {
      expect(isEnterpriseTextModel({ id })).toBe(false);
    }
  });

  test('scopes results to credential, application, region and disabled state without tokens', () => {
    const identity = modelTestIdentity(file);
    expect(identity).not.toContain('never-send-or-render-this');
    expect(modelTestIdentity({ ...file, access_token: 'refreshed' })).toBe(identity);
    for (const other of [
      { ...file, authIndex: 'other' },
      { ...file, disabled: true },
      { ...file, geminiEnterprise: { ...file.geminiEnterprise, location: 'us' } },
      { ...file, geminiEnterprise: { ...file.geminiEnterprise, engineId: 'other-app' } },
    ]) {
      expect(modelTestIdentity(other)).not.toBe(identity);
    }
  });

  test('normalizes zero duration and distinguishes local cooling from upstream failure', () => {
    expect(normalizeModelTestResult({ ...raw, elapsed_ms: 0 }).elapsedMs).toBe(0);
    expect(
      normalizeModelTestResult({
        ...raw,
        status: 'cooling',
        http_status: 429,
        retry_after_seconds: 60,
      })
    ).toMatchObject({ status: 'cooling', httpStatus: 429, retryAfterSeconds: 60 });
    expect(
      normalizeModelTestResult({
        ...raw,
        status: 'failed',
        http_status: 400,
        code: 'MODEL_NOT_ENABLED',
      })
    ).toMatchObject({ status: 'failed', code: 'MODEL_NOT_ENABLED' });
  });

  test('rejects incomplete or misleading success envelopes', () => {
    for (const value of [
      '<html>wrong origin</html>',
      {},
      { ...raw, status: 'success' },
      { ...raw, auth_index: '' },
      { ...raw, resources: {} },
      { ...raw, elapsed_ms: -1 },
      { ...raw, checked_at: 'invalid' },
      { ...raw, http_status: 400 },
    ]) {
      expect(() => normalizeModelTestResult(value)).toThrow(InvalidManagementResponseError);
    }
  });

  test('posts only the pinned identity, expected resource binding and model with cancellation and no timeout', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue(raw);
    const signal = new AbortController().signal;
    try {
      await authFileModelTestsApi.test(file, raw.model, signal);
      expect(post).toHaveBeenCalledWith(
        '/credentials/models/test',
        {
          name: file.name,
          auth_index: file.authIndex,
          model: raw.model,
          expected: raw.resources,
        },
        { signal, timeout: 0 }
      );
      expect(JSON.stringify(post.mock.calls)).not.toContain('never-send-or-render-this');
    } finally {
      post.mockRestore();
    }
  });

  test('rejects an answer from another credential, application, or model', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue(raw);
    try {
      for (const patch of [
        { auth_index: 'other' },
        { model: 'gemini-2.5-pro' },
        { resources: { ...raw.resources, engine_id: 'other-app' } },
      ]) {
        post.mockResolvedValue({ ...raw, ...patch });
        await expect(
          authFileModelTestsApi.test(file, raw.model, new AbortController().signal)
        ).rejects.toBeInstanceOf(InvalidManagementResponseError);
      }
    } finally {
      post.mockRestore();
    }
  });

  test('discards an aborted response and an ABA connection switch', async () => {
    const controller = new AbortController();
    const post = spyOn(apiClient, 'post').mockImplementation(async () => {
      controller.abort();
      return raw;
    });
    try {
      await expect(
        authFileModelTestsApi.test(file, raw.model, controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' });
      apiClient.setConfig({ apiBase: 'http://127.0.0.1:19990', managementKey: 'synthetic-a' });
      post.mockImplementation(async () => {
        apiClient.setConfig({ apiBase: 'http://127.0.0.1:19991', managementKey: 'synthetic-b' });
        apiClient.setConfig({ apiBase: 'http://127.0.0.1:19990', managementKey: 'synthetic-a' });
        return raw;
      });
      await expect(
        authFileModelTestsApi.test(file, raw.model, new AbortController().signal)
      ).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      post.mockRestore();
      apiClient.setConfig({ apiBase: '', managementKey: '' });
    }
  });
});

describe('serial model test batches', () => {
  test('starts one request at a time, retains order and continues after a single model rejection', async () => {
    const calls: string[] = [];
    const completed: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const batch = runSerialModelTests(
      ['a', 'b', 'b', 'c'],
      new AbortController().signal,
      async (model) => {
        calls.push(model);
        if (model === 'a') await first;
        return result({
          model,
          status: model === 'b' ? 'failed' : 'ok',
          httpStatus: model === 'b' ? 400 : 200,
        });
      },
      () => {},
      (model) => completed.push(model)
    );
    expect(calls).toEqual(['a']);
    release();
    await batch;
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(completed).toEqual(calls);
  });

  test('does not publish or start another request after cancellation', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const completed: string[] = [];
    await runSerialModelTests(
      ['a', 'b'],
      controller.signal,
      async (model) => {
        calls.push(model);
        controller.abort();
        return result();
      },
      () => {},
      (model) => completed.push(model)
    );
    expect(calls).toEqual(['a']);
    expect(completed).toEqual([]);
  });

  test('stops on invalid credentials, limit errors and binding conflicts but allows local cooldown skips', async () => {
    for (const httpStatus of [401, 409, 429]) {
      const calls: string[] = [];
      await runSerialModelTests(
        ['a', 'b'],
        new AbortController().signal,
        async (model) => {
          calls.push(model);
          return result({ status: 'failed', httpStatus });
        },
        () => {},
        () => {}
      );
      expect(calls).toEqual(['a']);
    }
    expect(shouldStopModelTests(result({ status: 'cooling', httpStatus: 429 }))).toBe(false);
    expect(shouldStopModelTests(result({ status: 'failed', httpStatus: 403 }))).toBe(false);
    expect(shouldStopModelTests(result({ status: 'unavailable', httpStatus: 404 }))).toBe(true);
  });
});

describe('model test dialog translations and display', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
    test(`renders results, test controls and accessible copy labels in ${locale}`, async () => {
      const translations = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      const i18n = createInstance();
      await i18n.init({ lng: locale, resources: { [locale]: { translation: translations } } });
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(AuthFileModelsModal, {
            open: true,
            fileName: file.name,
            fileType: 'gemini-enterprise',
            loading: false,
            error: null,
            models: [{ id: raw.model }],
            excluded: {},
            onClose: () => {},
            onCopyText: () => {},
            testsEnabled: true,
            testResults: { [raw.model]: { state: 'ok', result: result() } },
            onTestModels: () => {},
          })
        )
      );
      expect(markup).toContain(translations.auth_files.model_test_all);
      expect(markup).toContain(translations.auth_files.model_test_state_ok);
      expect(markup).toContain('1.23');
      expect(markup).toContain('HTTP 200');
      expect(markup).toContain('aria-label=');
      expect(markup).not.toContain('auth_files.model_test_');
      expect(markup).not.toContain('never-send-or-render-this');
      expect(typeof translations.auth_files.cooldown_reason_model_not_enabled).toBe('string');
      const cooldown = normalizeAuthFileCooldowns(
        [
          {
            scope: 'model',
            model_key: raw.model,
            reason: 'model_not_enabled',
            retry_at: '2026-10-25T08:01:00Z',
            remaining_seconds: 60,
            http_status: 400,
          },
        ],
        undefined,
        Date.now()
      );
      const cooldownMarkup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(AuthFileCooldownSection, { snapshot: cooldown, onReset: () => {} })
        )
      );
      expect(cooldownMarkup).toContain(translations.auth_files.cooldown_reason_model_not_enabled);
      expect(cooldownMarkup).toContain(translations.auth_files.model_test_cooldown_note);
      expect(cooldownMarkup).not.toContain(translations.auth_files.cooldown_reset_button);
    });
  }
});
