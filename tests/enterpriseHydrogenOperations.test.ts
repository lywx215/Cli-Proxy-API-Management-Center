import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import {
  enterpriseHydrogenApi,
  normalizeGoogleHydrogenConfigureResponse,
} from '@/services/api/enterpriseHydrogen';
import {
  normalizeEnterpriseAccount,
  normalizeEnterpriseModelPolicy,
} from '@/services/api/enterpriseAccounts';
import { enterpriseCollectionFiles } from '@/features/authFiles/enterpriseAccounts';
import {
  hydrogenApplicationBatches,
  hydrogenApplicationTestFailure,
  enterpriseHydrogenAccountIdentity,
  runHydrogenApplicationTests,
  validHydrogenConfigurationApplication,
  shouldStopHydrogenApplicationTests,
  googleHydrogenReasonKey,
} from '@/features/authFiles/enterpriseHydrogenOperations';
import {
  enterprisePolicyPreview,
  enterprisePolicyRoutingPaused,
  readEnterprisePolicy,
} from '@/features/authFiles/enterpriseModelPolicy';
import { EnterpriseHydrogenOperationsModal } from '@/features/authFiles/components/EnterpriseHydrogenOperationsModal';
import { GeminiEnterpriseAccount } from '@/features/authFiles/components/GeminiEnterpriseAccount';
import { InvalidManagementResponseError } from '@/services/api/managementResponse';
import type { AuthFileItem } from '@/types';
import type { ModelTestResult } from '@/features/authFiles/modelTesting';

afterEach(() => mock.restore());
const hydrogen = 'gemini-4-hydrogen';
const verified = {
  enabled: false,
  available: false,
  can_test: true,
  can_enable: true,
  reason: 'hydrogen_disabled',
  test: {
    test_id: 'saved-proof',
    status: 'verified',
    http_status: 200,
    checked_at: '2026-11-07T15:00:00Z',
    upstream_model: hydrogen,
  },
};
function account(count = 7): AuthFileItem {
  return {
    name: 'synthetic.json',
    type: 'gemini-enterprise',
    authIndex: 'root-index',
    geminiEnterprise: normalizeEnterpriseAccount({
      account_id: 'account',
      revision: 3,
      google_hydrogen_configure_supported: true,
      hydrogen_admission_supported: true,
      collections: Array.from({ length: count }, (_, index) => ({
        binding_id: `binding-${index}`,
        auth_index: `index-${index}`,
        revision: 2,
        project_id: '123',
        location: 'global',
        collection_id: 'default_collection',
        engine_id: `app-${index}`,
        assistant_id: 'default_assistant',
        hydrogen_admission: verified,
      })),
    }),
  };
}
const applicationResult = (file: AuthFileItem) => ({
  binding_id: file.geminiEnterprise?.bindingId,
  auth_index: String(file.authIndex),
  expected_revision: file.geminiEnterprise?.revision,
  revision: file.geminiEnterprise?.revision,
  status: 'configured',
});
const response = (files: AuthFileItem[]) => ({
  status: 'completed',
  snapshot_id: 'opaque-snapshot',
  snapshot_expires_at: '2026-11-07T15:15:00Z',
  google_hydrogen_configure_supported: true,
  applications: files.map(applicationResult),
});
async function render(mode: 'configure' | 'test', locale = 'en', implicitAssistant = false) {
  const messages = JSON.parse(
    readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
  );
  const i18n = createInstance();
  await i18n.init({ lng: locale, resources: { [locale]: { translation: messages } } });
  const file = enterpriseCollectionFiles(account(1))[0];
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(EnterpriseHydrogenOperationsModal, {
        mode,
        busy: false,
        error: false,
        completed: 1,
        total: 1,
        rows: [
          {
            file,
            state: 'done',
            reason: implicitAssistant ? 'assistant_defaults_preserved' : undefined,
            configure: {
              bindingId: 'binding-0',
              authIndex: 'index-0',
              expectedRevision: 2,
              revision: 2,
              status: implicitAssistant ? 'verification_required' : 'configured',
              reason: implicitAssistant ? 'assistant_defaults_preserved' : undefined,
            },
            test: {
              status: 'ok',
              model: hydrogen,
              authIndex: 'index-0',
              checkedAt: '2026-11-07T15:00:00Z',
              elapsedMs: 1,
              httpStatus: 200,
            },
          },
        ],
        onCancel: () => {},
        onClose: () => {},
        onShowModels: () => {},
        onChange: () => {},
      })
    )
  );
}

describe('credential Hydrogen operations', () => {
  test('batches only imported bindings, caps each configuration batch at five and isolates revisions', () => {
    const file = account(12);
    const children = enterpriseCollectionFiles(file);
    expect(
      hydrogenApplicationBatches([...children, children[0]], 999).map((batch) => batch.length)
    ).toEqual([5, 5, 2]);
    expect(enterpriseHydrogenAccountIdentity(file)).not.toBe(
      enterpriseHydrogenAccountIdentity({ ...file, disabled: true })
    );
    const changed = account(12);
    changed.geminiEnterprise!.collections![0].revision = 99;
    expect(enterpriseHydrogenAccountIdentity(file)).not.toBe(
      enterpriseHydrogenAccountIdentity(changed)
    );
    expect(normalizeEnterpriseAccount({})?.googleHydrogenConfigureSupported).toBe(false);
    expect(
      validHydrogenConfigurationApplication({
        ...children[0],
        geminiEnterprise: { ...children[0].geminiEnterprise, missing: true },
      })
    ).toBe(false);
    expect(validHydrogenConfigurationApplication({ ...children[0], authIndex: '' })).toBe(false);
    expect(children.every(validHydrogenConfigurationApplication)).toBe(true);
  });

  test('posts fixed account and application revisions and reuses only the returned opaque snapshot', async () => {
    const file = account();
    const children = enterpriseCollectionFiles(file);
    const post = spyOn(apiClient, 'post').mockResolvedValue(response(children.slice(0, 5)));
    const signal = new AbortController().signal;
    expect(
      (await enterpriseHydrogenApi.configureGoogle(file, children.slice(0, 5), signal)).results
    ).toHaveLength(5);
    expect(post.mock.calls[0][0]).toBe('/credentials/gemini-enterprise/hydrogen/configure-google');
    expect(post.mock.calls[0][1]).toMatchObject({
      name: 'synthetic.json',
      auth_index: 'root-index',
      account_id: 'account',
      expected_revision: 3,
      applications: [
        {
          binding_id: 'binding-0',
          auth_index: 'index-0',
          expected_revision: 2,
          expected: { project_id: '123', engine_id: 'app-0' },
        },
        {},
        {},
        {},
        {},
      ],
    });
    expect(post.mock.calls[0][1]).not.toHaveProperty('snapshot_id');
    post.mockResolvedValue(response(children.slice(5)));
    await enterpriseHydrogenApi.configureGoogle(file, children.slice(5), signal, 'opaque-snapshot');
    expect(post.mock.calls[1][1]).toHaveProperty('snapshot_id', 'opaque-snapshot');
    for (const malformed of [
      { ...response(children.slice(5)), snapshot_id: 'other' },
      { ...response(children.slice(5)), applications: [applicationResult(children[0])] },
    ]) {
      post.mockResolvedValue(malformed);
      await expect(
        enterpriseHydrogenApi.configureGoogle(file, children.slice(5), signal, 'opaque-snapshot')
      ).rejects.toBeInstanceOf(InvalidManagementResponseError);
    }
    expect(
      file.geminiEnterprise?.collections?.every((child) => child.hydrogenAdmission?.enabled === false)
    ).toBe(true);
  });

  test('fails closed on unsupported and malformed configuration responses without exposing arbitrary fields', () => {
    expect(() =>
      normalizeGoogleHydrogenConfigureResponse({
        ...response([]),
        google_hydrogen_configure_supported: false,
      })
    ).toThrow();
    expect(() =>
      normalizeGoogleHydrogenConfigureResponse({
        ...response([]),
        applications: [{ status: 'configured' }],
      })
    ).toThrow();
    const target = enterpriseCollectionFiles(account(1));
    expect(
      JSON.stringify(
        normalizeGoogleHydrogenConfigureResponse({
          ...response(target),
          secret: 'never-echo',
          applications: [{ ...applicationResult(target[0]), token: 'never-echo' }],
        })
      )
    ).not.toContain('never-echo');
  });

  test('keeps an implicit Assistant range pending actual verification without inventing model permission', () => {
    const targets = enterpriseCollectionFiles(account(1));
    const result = normalizeGoogleHydrogenConfigureResponse({
      ...response(targets),
      applications: [
        {
          ...applicationResult(targets[0]),
          status: 'verification_required',
          reason: 'assistant_defaults_preserved',
          http_status: 200,
        },
      ],
    });
    expect(result.results[0]).toMatchObject({
      status: 'verification_required',
      reason: 'assistant_defaults_preserved',
      httpStatus: 200,
    });
    expect(result.account).toBeUndefined();
    expect(targets[0].geminiEnterprise?.hydrogenAdmission?.enabled).toBe(false);
    expect(googleHydrogenReasonKey(result.results[0].reason)).toBe(
      'gemini_enterprise.hydrogen_batch.reason_assistant_defaults_preserved'
    );
  });

  test('rejects foreign applications and ignores late configuration responses after connection changes or cancellation', async () => {
    const file = account(1),
      applications = enterpriseCollectionFiles(file);
    let connection = 1;
    spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => connection);
    let finish!: (value: unknown) => void;
    const post = spyOn(apiClient, 'post').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await expect(
      enterpriseHydrogenApi.configureGoogle(
        file,
        [{ ...applications[0], authIndex: 'foreign' }],
        new AbortController().signal
      )
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
    for (const changeConnection of [false, true]) {
      const controller = new AbortController();
      const pending = enterpriseHydrogenApi.configureGoogle(file, applications, controller.signal);
      if (changeConnection) connection += 2;
      else controller.abort();
      finish(response(applications));
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    }
  });

  test('tests at most two applications concurrently, once each, without retrying', async () => {
    const targets = enterpriseCollectionFiles(account(7));
    const waiting: Array<() => void> = [];
    const started: string[] = [];
    const done: string[] = [];
    let active = 0,
      peak = 0;
    const run = runHydrogenApplicationTests(
      targets,
      new AbortController().signal,
      async (file) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => waiting.push(resolve));
        active--;
        return file.geminiEnterprise!.bindingId!;
      },
      (file) => started.push(file.geminiEnterprise!.bindingId!),
      (_, result) => done.push(result)
    );
    expect(started).toHaveLength(2);
    while (done.length < 7) {
      waiting.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    await run;
    expect(peak).toBe(2);
    expect(new Set(started).size).toBe(7);
    expect(done).toHaveLength(7);
  });

  test('cancellation suppresses late results and never starts remaining applications', async () => {
    const controller = new AbortController();
    const waiting: Array<() => void> = [];
    const started: string[] = [];
    const done: string[] = [];
    const run = runHydrogenApplicationTests(
      enterpriseCollectionFiles(account()),
      controller.signal,
      async () => {
        await new Promise<void>((resolve) => waiting.push(resolve));
        return 'ok';
      },
      (file) => started.push(file.geminiEnterprise!.bindingId!),
      (_, result) => done.push(result)
    );
    controller.abort();
    waiting.forEach((resolve) => resolve());
    await run;
    expect(started).toHaveLength(2);
    expect(done).toEqual([]);
  });

  test('an explicit scope invalidation stops new scheduling while started calls finish once', async () => {
    let calls = 0;
    await runHydrogenApplicationTests(
      enterpriseCollectionFiles(account()),
      new AbortController().signal,
      async () => {
        calls++;
        return 'credential_changed';
      },
      () => {},
      () => {},
      () => true
    );
    expect(calls).toBe(2);
  });

  test('only explicit request scope changes stop Hydrogen applications, not an HTTP status alone', () => {
    const result: ModelTestResult = {
      status: 'failed',
      model: hydrogen,
      authIndex: 'index-0',
      checkedAt: '2026-11-07T15:00:00Z',
      elapsedMs: 0,
      httpStatus: 409,
      code: 'subscription_unverified',
      message: '',
    };
    for (const httpStatus of [0, 400, 401, 403, 404, 408, 409, 429, 500, 502, 503]) {
      for (const status of ['failed', 'unavailable', 'cooling'] as const)
        expect(shouldStopHydrogenApplicationTests({ ...result, status, httpStatus })).toBe(false);
    }
    for (const code of [
      'credential_changed',
      'authorization_changed',
      'hydrogen_authorization_changed',
      'binding_changed',
      'hydrogen_binding_changed',
      'configuration_changed',
      'hydrogen_configuration_changed',
      'model_changed',
    ])
      expect(shouldStopHydrogenApplicationTests({ ...result, code })).toBe(true);
    expect(shouldStopHydrogenApplicationTests({ ...result, status: 'ok', httpStatus: 200 })).toBe(
      false
    );
  });

  test('all 18 applications finish after an early unavailable app and mixed upstream failures', async () => {
    const targets = enterpriseCollectionFiles(account(18));
    const starts: string[] = [];
    const results: Array<[string, ModelTestResult]> = [];
    const failures = [
      ['subscription_unverified', 0],
      ['MODEL_NOT_ENABLED', 400],
      ['permission_denied', 403],
      ['credential_not_found', 404],
      ['subscription_unverified', 409],
      ['rate_limited', 429],
      ['generation_failed', 502],
      ['request_failed', 0],
    ] as const;
    await runHydrogenApplicationTests(
      targets,
      new AbortController().signal,
      async (file) => {
        const index = targets.indexOf(file);
        const failure = failures[index - 1];
        return {
          ...hydrogenApplicationTestFailure(file, null),
          status: index === 0 || index > failures.length ? 'ok' : 'unavailable',
          code: failure?.[0] ?? 'ok',
          httpStatus: failure?.[1] ?? 200,
        } satisfies ModelTestResult;
      },
      (file) => starts.push(file.geminiEnterprise!.bindingId!),
      (file, result) => results.push([file.geminiEnterprise!.bindingId!, result]),
      shouldStopHydrogenApplicationTests
    );
    expect(starts).toHaveLength(18);
    expect(new Set(starts).size).toBe(18);
    expect(results).toHaveLength(18);
    expect(results.find(([id]) => id === 'binding-1')?.[1].code).toBe('subscription_unverified');
    expect(results.find(([id]) => id === 'binding-17')?.[1].status).toBe('ok');
    expect(targets.every((file) => file.geminiEnterprise?.hydrogenAdmission?.enabled === false)).toBe(
      true
    );
  });

  test('request rejections are isolated to their application and never replayed', async () => {
    const targets = enterpriseCollectionFiles(account(7));
    const calls = new Map<string, number>();
    const results: ModelTestResult[] = [];
    await runHydrogenApplicationTests(
      targets,
      new AbortController().signal,
      async (file) => {
        const id = file.geminiEnterprise!.bindingId!;
        calls.set(id, (calls.get(id) ?? 0) + 1);
        try {
          if (targets.indexOf(file) % 2)
            throw Object.assign(new Error('synthetic'), { status: 503 });
          return {
            ...hydrogenApplicationTestFailure(file, null),
            status: 'ok',
            httpStatus: 200,
            code: 'ok',
          } satisfies ModelTestResult;
        } catch (cause) {
          return hydrogenApplicationTestFailure(file, cause);
        }
      },
      () => {},
      (_, result) => results.push(result),
      shouldStopHydrogenApplicationTests
    );
    expect(calls.size).toBe(7);
    expect([...calls.values()]).toEqual(Array(7).fill(1));
    expect(results.filter((result) => result.httpStatus === 503)).toHaveLength(3);
    expect(results.filter((result) => result.status === 'ok')).toHaveLength(4);
  });

  test('a real scope conflict stops the queue without discarding an in-flight result', async () => {
    const targets = enterpriseCollectionFiles(account(18));
    const starts: string[] = [];
    const done: string[] = [];
    let finish!: () => void;
    const run = runHydrogenApplicationTests(
      targets,
      new AbortController().signal,
      async (file) => {
        if (file === targets[1])
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        return {
          ...hydrogenApplicationTestFailure(file, null),
          code: file === targets[0] ? 'credential_changed' : 'ok',
          status: file === targets[0] ? 'unavailable' : 'ok',
          httpStatus: file === targets[0] ? 409 : 200,
        } satisfies ModelTestResult;
      },
      (file) => starts.push(file.geminiEnterprise!.bindingId!),
      (file) => done.push(file.geminiEnterprise!.bindingId!),
      shouldStopHydrogenApplicationTests
    );
    await Promise.resolve();
    expect(starts).toEqual(['binding-0', 'binding-1']);
    expect(done).toEqual(['binding-0']);
    finish();
    await run;
    expect(done).toEqual(['binding-0', 'binding-1']);
    expect(starts).toHaveLength(2);
  });

  test('failure normalization accepts unknown rejections without copying secret error text', () => {
    const file = enterpriseCollectionFiles(account(1))[0];
    for (const cause of [null, undefined, 'private-token', { message: 'private-token' }]) {
      const result = hydrogenApplicationTestFailure(file, cause);
      expect(result).toMatchObject({
        status: 'unavailable',
        code: 'request_failed',
        httpStatus: 0,
        message: '',
      });
      expect(JSON.stringify(result)).not.toContain('private-token');
      expect(shouldStopHydrogenApplicationTests(result)).toBe(false);
    }
    expect(
      hydrogenApplicationTestFailure(file, { status: 409, apiCode: 'credential_changed' })
    ).toMatchObject({ httpStatus: 409, code: 'credential_changed' });
  });

  test('an independently admitted trial Hydrogen app stays routable when Argon is excluded', () => {
    const state = normalizeEnterpriseModelPolicy({
      mode: 'argon_only',
      effective_mode: 'argon_only',
      status: 'ok',
      enforced_allowed_models: null,
      catalog_known: true,
      excluded_models: ['gemini-4-argon', 'gemini-4-carbon'],
      effective_models: [hydrogen],
      catalog_models: [
        { id: hydrogen, allowed: true },
        { id: 'gemini-4-argon', allowed: false },
      ],
      subscription: { status: 'ok', free_trial: true, edition: 'business_standard' },
      hydrogen_admission_supported: true,
      hydrogen_admission: { ...verified, enabled: true, available: true },
    })!;
    expect(enterprisePolicyRoutingPaused(state)).toBe(false);
    expect(
      enterprisePolicyPreview(
        readEnterprisePolicy({ model_policy: 'argon_only' }),
        state,
        state.excludedModels
      )
    ).toEqual([hydrogen]);
    expect(
      enterprisePolicyRoutingPaused({
        ...state,
        hydrogenAdmission: { ...state.hydrogenAdmission!, available: false },
      })
    ).toBe(true);
    expect(enterprisePolicyRoutingPaused({ ...state, enforcedExcludedModels: [hydrogen] })).toBe(
      true
    );
    expect(
      enterprisePolicyPreview(
        readEnterprisePolicy({ model_policy: 'custom', allowed_models: ['gemini-4-argon'] }),
        state,
        state.excludedModels
      )
    ).toEqual([]);
  });

  test('configuration success is distinct from testing and never renders an automatic or batch enable action', async () => {
    const configured = await render('configure');
    expect(configured).toContain('Google settings configured');
    expect(configured).not.toContain('type="checkbox"');
    const tested = await render('test');
    expect(tested).toContain('Hydrogen verification succeeded');
    expect(tested).toContain('Verification passed; enable manually');
    expect(tested).toContain('Hydrogen disabled');
    expect(tested).toContain('Verification passed');
    expect(tested).not.toMatch(/<input[^>]*checked=""/);
    expect(tested).toContain('aria-describedby=');
    expect(tested).toContain('Open application models');
  });

  test('all six languages show preserved Assistant defaults as needing testing instead of configuration failure', async () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ).gemini_enterprise.hydrogen_batch;
      const html = await render('configure', locale, true);
      expect(html).toContain(messages.status_verification_required);
      expect(html).toContain(
        renderToStaticMarkup(
          createElement('p', { className: 'hint' }, messages.reason_assistant_defaults_preserved)
        )
      );
      expect(html).not.toContain(messages.status_failed);
      expect(html).not.toContain(messages.reason_allowed_models_review_required);
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain('hydrogen_batch.reason_');
      expect(html).toContain('role="status"');
    }
  });

  test('credential cards expose both scoped actions and the remote-change warning, with old backend configuration disabled', async () => {
    const messages = JSON.parse(
      readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8')
    );
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: messages } } });
    const noOp = () => {};
    const renderCard = (file: AuthFileItem) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(GeminiEnterpriseAccount, {
            file,
            selected: true,
            disableControls: false,
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
        )
      );
    const enabled = renderCard(account(1));
    expect(enabled).toContain('Configure Google Hydrogen');
    expect(enabled).toContain('Batch test Hydrogen');
    expect(enabled).toContain('changes remote Google model settings');
    expect(enabled).toContain('aria-describedby=');
    const legacy = account(1);
    legacy.geminiEnterprise!.googleHydrogenConfigureSupported = false;
    expect(renderCard(legacy)).toMatch(
      /<button[^>]*disabled=""[^>]*><span>Configure Google Hydrogen/
    );
    expect(renderCard(legacy)).toContain('does not support configuring Google Hydrogen');
  });

  test('all six languages expose matching messages and labelled native progress and switches', async () => {
    let keys: string[] | undefined;
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'ko', 'vi']) {
      const resource = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      );
      keys ??= Object.keys(resource.gemini_enterprise.hydrogen_batch).sort();
      expect(Object.keys(resource.gemini_enterprise.hydrogen_batch).sort()).toEqual(keys);
      const html = await render('test', locale);
      expect(html).toContain('<progress');
      expect(html).toContain('aria-label=');
      expect(html).not.toContain('gemini_enterprise.hydrogen_batch.');
    }
  });
});
