import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { normalizeEnterpriseAccount } from '@/services/api/enterpriseAccounts';
import { EnterpriseCarbonAdmission } from '@/features/authFiles/components/EnterpriseCarbonAdmission';
import { EnterpriseCarbonOperationsModal } from '@/features/authFiles/components/EnterpriseCarbonOperationsModal';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import {
  enterpriseCarbonAvailabilityPresentation,
  enterpriseCarbonTestPresentation,
} from '@/features/authFiles/enterpriseCarbonPresentation';
import type { ModelTestResult, ModelTestState } from '@/features/authFiles/modelTesting';
import type { AuthFileItem } from '@/types';

const carbon = 'gemini-4-carbon';
const backendSuccess = 'Carbon completed its fixed-application verification';
const checkedAt = '2026-11-07T09:00:00Z';
const proof = {
  status: 'verified',
  test_id: 'current-server-proof',
  checked_at: checkedAt,
  upstream_model: carbon,
  http_status: 200,
};
const ready = {
  enabled: false,
  available: false,
  can_test: true,
  can_enable: true,
  reason: 'carbon_disabled',
  test: proof,
};

function target(admission: Record<string, unknown> = ready): AuthFileItem {
  return {
    name: 'presentation.json',
    type: 'gemini-enterprise',
    authIndex: 'application-index',
    geminiEnterprise: {
      ...normalizeEnterpriseAccount({
        account_id: 'account',
        binding_id: 'application-binding',
        revision: 3,
        project_id: '123',
        location: 'global',
        collection_id: 'default_collection',
        engine_id: 'app',
        assistant_id: 'default_assistant',
        carbon_admission_supported: true,
        carbon_admission: admission,
      }),
      bindingId: 'application-binding',
    },
  };
}

function result(change: Partial<ModelTestResult> = {}): ModelTestResult {
  return {
    status: 'ok',
    code: 'ok',
    message: backendSuccess,
    model: carbon,
    authIndex: 'application-index',
    bindingId: 'application-binding',
    checkedAt,
    elapsedMs: 12,
    httpStatus: 200,
    ...change,
  };
}

async function translations(locale: string) {
  const messages = JSON.parse(
    readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
  );
  const i18n = createInstance();
  await i18n.init({ lng: locale, resources: { [locale]: { translation: messages } } });
  return { i18n, messages: messages.gemini_enterprise.carbon };
}

async function render(
  view: 'panel' | 'models' | 'batch',
  file: AuthFileItem,
  state: ModelTestState,
  locale = 'en'
) {
  const { i18n } = await translations(locale);
  const component =
    view === 'panel'
      ? createElement(EnterpriseCarbonAdmission, {
          file,
          test: state,
          testCandidateAvailable: true,
          onTest: () => {},
          onChange: () => {},
        })
      : view === 'models'
        ? createElement(AuthFileModelsModal, {
            open: true,
            fileName: file.name,
            fileType: 'gemini-enterprise',
            file,
            loading: false,
            error: null,
            models: [{ id: carbon, upstream_model: carbon }],
            testCandidates: [{ id: carbon, test_candidate: true }],
            excluded: {},
            testsEnabled: true,
            testResults: { [carbon]: state },
            onClose: () => {},
            onCopyText: () => {},
            onTestModels: () => {},
            onCarbonChange: () => {},
          })
        : createElement(EnterpriseCarbonOperationsModal, {
            mode: 'test',
            rows: [
              {
                file,
                state:
                  state.state === 'running' || state.state === 'cancelled' ? state.state : 'done',
                test: state.result,
                reason: state.result?.code,
              },
            ],
            busy: state.state === 'running',
            error: false,
            completed: 1,
            total: 1,
            onCancel: () => {},
            onClose: () => {},
            onShowModels: () => {},
            onChange: () => {},
          });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, component));
}

describe('Carbon verification presentation', () => {
  test('uses structured success and current manual state without the backend English message', () => {
    const file = target();
    const state: ModelTestState = { state: 'ok', result: result() };
    expect(enterpriseCarbonAvailabilityPresentation(file)).toEqual({
      tone: 'success',
      labelKey: 'gemini_enterprise.carbon.pending_enable',
      reasonKey: 'gemini_enterprise.carbon.pending_enable_hint',
    });
    expect(enterpriseCarbonTestPresentation(file, state)).toEqual({
      tone: 'success',
      labelKey: 'gemini_enterprise.carbon.test_success_pending',
    });
    const enabled = target({ ...ready, enabled: true, available: true, reason: '' });
    expect(enterpriseCarbonAvailabilityPresentation(enabled).labelKey).toEndWith('.available');
    expect(enterpriseCarbonTestPresentation(enabled, state)?.tone).toBe('success');
    expect(enterpriseCarbonTestPresentation(enabled, state)?.labelKey).toEndWith('.test_success');
    const omittedReason = target({ ...ready, reason: undefined });
    expect(enterpriseCarbonAvailabilityPresentation(omittedReason).labelKey).toEndWith(
      '.unavailable'
    );
    expect(enterpriseCarbonTestPresentation(omittedReason, state)?.tone).toBe('success');
  });

  test('pending enablement requires a complete current proof and only fixed manual-off reasons', () => {
    for (const reason of ['carbon_disabled', 'manual_disabled', 'not_enabled', 'disabled'])
      expect(
        enterpriseCarbonAvailabilityPresentation(target({ ...ready, reason })).labelKey
      ).toEndWith('.pending_enable');
    for (const admission of [
      { ...ready, can_enable: false },
      { ...ready, reason: '' },
      { ...ready, reason: 'Carbon is disabled' },
      { ...ready, test: { ...proof, test_id: '' } },
      { ...ready, test: { ...proof, http_status: 500 } },
      { ...ready, test: { ...proof, upstream_model: 'gemini-4-argon' } },
      { ...ready, test: { ...proof, reason: 'needs_review' } },
    ])
      expect(enterpriseCarbonAvailabilityPresentation(target(admission)).labelKey).toEndWith(
        '.unavailable'
      );
  });

  test('historical verification cannot override current authorization, subscription or policy reasons', () => {
    for (const reason of [
      'authorization_changed',
      'subscription_unverified',
      'model_excluded',
      'binding_changed',
      'needs_review',
    ]) {
      const file = target({ ...ready, can_enable: false, reason });
      const current = enterpriseCarbonAvailabilityPresentation(file);
      expect(current.labelKey).toEndWith('.unavailable');
      expect(current.reasonKey).not.toEndWith('reason_disabled');
      expect(enterpriseCarbonTestPresentation(file, { state: 'ok', result: result() })).toEqual(
        current
      );
    }
  });

  test('failure, cooldown, cancellation and manual-off remain separate structured states', () => {
    const file = target();
    const failed = result({ status: 'failed', code: 'model_excluded', message: 'private default' });
    expect(enterpriseCarbonTestPresentation(file, { state: 'failed', result: failed })).toEqual({
      tone: 'failure',
      labelKey: 'auth_files.model_test_state_failed',
      reasonKey: 'gemini_enterprise.carbon.reason_policy_denied',
      detail: undefined,
    });
    for (const state of ['running', 'cancelled'] as const) {
      const current = enterpriseCarbonTestPresentation(file, { state, result: failed });
      expect(current?.tone).toBe('neutral');
      expect(current?.labelKey).toEndWith('_' + state);
      expect(current?.detail).toBeUndefined();
    }
    expect(
      enterpriseCarbonTestPresentation(file, {
        state: 'cooling',
        result: result({ status: 'cooling', code: 'rate_limited' }),
      })?.tone
    ).toBe('neutral');
    expect(
      enterpriseCarbonTestPresentation(file, {
        state: 'unavailable',
        result: result({ status: 'unavailable', code: 'carbon_disabled' }),
      })?.labelKey
    ).toEndWith('.disabled');
    expect(
      enterpriseCarbonTestPresentation(file, {
        state: 'failed',
        result: result({ status: 'failed', code: 'ok' }),
      })?.tone
    ).toBe('failure');
  });

  test('a stale failure or a different application cannot cover a newly verified result', () => {
    const old = result({
      status: 'failed',
      code: 'old_failure',
      checkedAt: '2026-11-07T08:59:00Z',
    });
    expect(
      enterpriseCarbonTestPresentation(target(), { state: 'failed', result: old })
    ).toBeUndefined();
    for (const change of [{ authIndex: 'other-index' }, { bindingId: 'other-binding' }])
      expect(
        enterpriseCarbonTestPresentation(target(), { state: 'ok', result: result(change) })
      ).toBeUndefined();
    const newerFailure = { ...old, checkedAt: '2026-11-07T09:01:00Z' };
    expect(
      enterpriseCarbonTestPresentation(target(), { state: 'failed', result: newerFailure })?.tone
    ).toBe('failure');
  });

  test('unknown failure details are bounded and sanitized without guessing from English', async () => {
    const failure = result({
      status: 'failed',
      code: 'future_error',
      message: 'Bearer sensitive-value access_token=secret-value <script>unsafe</script>\u0000',
    });
    const feedback = enterpriseCarbonTestPresentation(target(), {
      state: 'failed',
      result: failure,
    });
    expect(feedback?.tone).toBe('failure');
    expect(feedback?.detail).toContain('[redacted]');
    expect(feedback?.detail).not.toContain('sensitive-value');
    expect(feedback?.detail).not.toContain('secret-value');
    expect(feedback?.detail).not.toContain('\u0000');
    for (const view of ['panel', 'models', 'batch'] as const) {
      const html = await render(view, target(), { state: 'failed', result: failure });
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('sensitive-value');
      expect(html).not.toContain('secret-value');
    }
  });

  test('single and batch success use localized feedback and retain accessible native controls', async () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'ko', 'vi']) {
      const { messages } = await translations(locale);
      for (const view of ['panel', 'models', 'batch'] as const) {
        const html = await render(view, target(), { state: 'ok', result: result() }, locale);
        expect(html).toContain(messages.pending_enable);
        expect(html).toContain(messages.test_success);
        expect(html).not.toContain(backendSuccess);
        expect(html).not.toContain('ok:');
        expect(html).not.toContain('gemini_enterprise.carbon.');
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-label=');
        expect(html).toContain('type="checkbox"');
        expect(html).toContain('aria-hidden="true"');
      }
    }
  });
});

describe('Carbon manual admission presentation', () => {
  test('separates business availability from missing or rejected diagnostic history', () => {
    for (const diagnostic of [
      undefined,
      { ...proof, status: 'failed', reason: 'model_not_enabled' },
    ]) {
      const file = target({
        ...ready,
        verification_required: false,
        test: diagnostic,
        enabled: true,
        available: true,
        reason: undefined,
      });
      expect(enterpriseCarbonAvailabilityPresentation(file)).toEqual({
        tone: 'success',
        labelKey: 'gemini_enterprise.carbon.available',
      });
    }
  });

  test('renders availability independently of a failed optional test in single and batch views', async () => {
    const file = target({
      ...ready,
      verification_required: false,
      enabled: true,
      available: true,
      reason: undefined,
      test: { ...proof, status: 'failed', reason: 'model_not_enabled' },
    });
    const state: ModelTestState = {
      state: 'failed',
      result: result({
        status: 'failed',
        code: 'model_not_enabled',
        message: 'rejected diagnostic',
      }),
    };
    for (const view of ['panel', 'models', 'batch'] as const) {
      const { messages } = await translations('en');
      const html = await render(view, file, state);
      expect(html).toContain(messages.available);
      expect(html).toContain(messages.enabled);
      expect(html).not.toContain(messages.enable_requires_test);
    }
  });
});
