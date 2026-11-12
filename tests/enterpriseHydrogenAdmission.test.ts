import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { authFilesApi, normalizeAuthFileModelsSnapshot } from '@/services/api/authFiles';
import { authFileModelTestsApi } from '@/services/api/authFileModelTests';
import { geminiEnterpriseApi } from '@/services/api/geminiEnterprise';
import {
  normalizeEnterpriseAccount,
  normalizeEnterpriseHydrogenAdmission,
  normalizeEnterpriseModelPolicy,
} from '@/services/api/enterpriseAccounts';
import { InvalidManagementResponseError } from '@/services/api/managementResponse';
import { EnterpriseHydrogenAdmission } from '@/features/authFiles/components/EnterpriseHydrogenAdmission';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import {
  canEnableEnterpriseHydrogen,
  canTestEnterpriseHydrogen,
  enterpriseHydrogenEvidenceStatus,
  enterpriseHydrogenReasonKey,
  enterpriseHydrogenSummary,
  enterpriseHydrogenTargetIdentity,
  sameEnterpriseNonHydrogenState,
} from '@/features/authFiles/enterpriseHydrogen';
import {
  enterprisePolicyPreview,
  readEnterprisePolicy,
} from '@/features/authFiles/enterpriseModelPolicy';
import {
  enterpriseResources,
  serializeEnterpriseResources,
} from '@/features/authFiles/enterpriseResources';
import type { AuthFileItem } from '@/types';

afterEach(() => mock.restore());
const hydrogen = 'gemini-4-hydrogen';
const proof = {
  test_id: 'server-generated-proof',
  status: 'verified',
  checked_at: '2026-11-07T08:00:00Z',
  upstream_model: hydrogen,
  http_status: 200,
};
const closed = {
  enabled: false,
  available: false,
  can_test: true,
  can_enable: false,
  reason: 'hydrogen_disabled',
};
const verified = { ...closed, can_enable: true, test: proof };

const manualAdmission = {
  ...closed,
  verification_required: false,
  can_enable: true,
};
function file(raw: Record<string, unknown> = closed): AuthFileItem {
  return {
    name: 'fixture.json',
    type: 'gemini-enterprise',
    authIndex: 'app-index',
    email: 'fixture@example.test',
    geminiEnterprise: {
      accountId: 'account',
      bindingId: 'binding',
      revision: 3,
      projectId: '123',
      location: 'global',
      collectionId: 'default_collection',
      engineId: 'app',
      assistantId: 'default_assistant',
      hydrogenAdmissionSupported: true,
      hydrogenAdmission: normalizeEnterpriseHydrogenAdmission(raw),
    },
  };
}
async function translations(locale = 'en') {
  const resource = JSON.parse(
    readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
  );
  const i18n = createInstance();
  await i18n.init({ lng: locale, resources: { [locale]: { translation: resource } } });
  return { i18n, messages: resource.gemini_enterprise.hydrogen };
}
async function renderPanel(
  raw: Record<string, unknown> = closed,
  options: Record<string, unknown> = {},
  locale = 'en'
) {
  const { i18n } = await translations(locale);
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(EnterpriseHydrogenAdmission, {
        file: file(raw),
        testCandidateAvailable: true,
        onChange: () => {},
        onTest: () => {},
        ...options,
      })
    )
  );
}

describe('Hydrogen application admission frontend', () => {
  test('fails closed on malformed, incomplete, wrong-model or contradictory evidence', () => {
    expect(normalizeEnterpriseHydrogenAdmission(null)).toBeUndefined();
    expect(
      normalizeEnterpriseHydrogenAdmission({ ...verified, enabled: 'true', available: 'true' })
    ).toMatchObject({ enabled: false, available: false });
    for (const rawProof of [
      { ...proof, status: 'failed' },
      { ...proof, test_id: '' },
      { ...proof, checked_at: 'invalid' },
      { ...proof, upstream_model: 'gemini-4-argon' },
      { ...proof, http_status: 500 },
    ]) {
      expect(
        normalizeEnterpriseHydrogenAdmission({
          ...verified,
          enabled: true,
          available: true,
          test: rawProof,
        })
      ).toMatchObject({ available: false, canEnable: false });
    }
    const value = normalizeEnterpriseHydrogenAdmission({
      ...verified,
      token: 'never-return',
      test: { ...proof, secret: 'never-return' },
    });
    expect(JSON.stringify(value)).not.toContain('never-return');
    expect(value?.enabled).toBe(false);
    expect(value?.canEnable).toBe(true);
    expect(
      normalizeEnterpriseHydrogenAdmission({
        ...verified,
        enabled: true,
        available: true,
        can_enable: false,
      })
    ).toMatchObject({ enabled: true, available: false, canEnable: false });
  });

  test('keeps closed test candidates separate from business models and leaves older backends usable', async () => {
    const data = {
      models: [
        { id: 'gemini-4-argon' },
        { id: hydrogen, upstream_model: hydrogen },
        { id: 'hydrogen-alias', upstream_model: hydrogen },
      ],
      model_policy_supported: true,
      hydrogen_admission_supported: true,
      hydrogen_admission: closed,
      catalog_models: [{ id: hydrogen, allowed: false }],
      test_candidates: [{ id: hydrogen, test_candidate: true, business_registered: false }],
    };
    const snapshot = normalizeAuthFileModelsSnapshot(data);
    expect(snapshot.models.map((model) => model.id)).toEqual(['gemini-4-argon']);
    expect(snapshot.testCandidates).toEqual([
      {
        id: hydrogen,
        type: 'gemini',
        upstream_model: hydrogen,
        test_candidate: true,
        business_registered: false,
      },
    ]);
    expect(
      normalizeAuthFileModelsSnapshot({ ...data, hydrogen_admission_supported: undefined })
        .testCandidates
    ).toEqual([]);
    const get = spyOn(apiClient, 'get').mockResolvedValue(data);
    expect(
      (await authFilesApi.getModelsForAuthFile('fixture.json')).map((model) => model.id)
    ).toEqual(['gemini-4-argon']);
    expect(get).toHaveBeenCalledTimes(1);
    const active = normalizeAuthFileModelsSnapshot({
      ...data,
      hydrogen_admission: { ...verified, enabled: true, available: true },
      test_candidates: [
        { id: hydrogen, test_candidate: true, business_registered: true },
        { id: hydrogen, test_candidate: true, business_registered: true },
      ],
    });
    expect(active.models.map((model) => model.id)).toEqual([
      'gemini-4-argon',
      hydrogen,
      'hydrogen-alias',
    ]);
    expect(active.models.every((model) => !model.test_candidate)).toBe(true);
    expect(active.testCandidates).toHaveLength(1);
    expect(active.testCandidates[0].business_registered).toBe(true);
    expect(normalizeAuthFileModelsSnapshot({ ...data, models: [] }).models).toEqual([]);
  });

  test('normalizes per-application state and counts enabled separately from available', () => {
    const account = normalizeEnterpriseAccount({
      hydrogen_admission_supported: true,
      collections: [
        { binding_id: 'one', hydrogen_admission: verified },
        { binding_id: 'two', hydrogen_admission: { ...verified, enabled: true, available: true } },
        {
          binding_id: 'three',
          hydrogen_admission: { ...verified, enabled: true, reason: 'needs_review' },
        },
      ],
    });
    expect(account?.collections?.[0].hydrogenAdmissionSupported).toBe(true);
    expect(
      enterpriseHydrogenSummary([
        file(verified),
        file({ ...verified, enabled: true, available: true }),
        file({ ...verified, enabled: true }),
      ])
    ).toEqual({ enabled: 2, available: 1, supported: true });
  });

  test('allows fixed testing while business is closed but never enables on test success', () => {
    expect(canTestEnterpriseHydrogen(file())).toBe(true);
    expect(canEnableEnterpriseHydrogen(file())).toBe(false);
    expect(canEnableEnterpriseHydrogen(file(verified))).toBe(true);
    expect(canTestEnterpriseHydrogen(file({ ...verified, can_test: false }))).toBe(false);
    expect(canEnableEnterpriseHydrogen(file({ ...verified, can_test: false }))).toBe(true);
    expect(file(verified).geminiEnterprise?.hydrogenAdmission?.enabled).toBe(false);
    for (const item of [
      null,
      { ...file(), disabled: true },
      { ...file(), type: 'gemini-enterprise-web' },
      { ...file(), authIndex: '' },
      {
        ...file(),
        geminiEnterprise: { ...file().geminiEnterprise, hydrogenAdmissionSupported: undefined },
      },
    ]) {
      expect(canTestEnterpriseHydrogen(item)).toBe(false);
    }
  });

  test('distinguishes stored verification from evidence that is valid for the current application', async () => {
    const stale = { ...verified, can_enable: false };
    expect(enterpriseHydrogenEvidenceStatus(normalizeEnterpriseHydrogenAdmission(stale))).toBe('stale');
    expect(await renderPanel(stale)).toContain('Verification no longer applies');
    expect(enterpriseHydrogenReasonKey('authorization_unverified')).toEndWith(
      'reason_authorization_unverified'
    );
    expect(enterpriseHydrogenReasonKey('invalid_hydrogen_settings')).toEndWith(
      'reason_invalid_settings'
    );
    expect(enterpriseHydrogenReasonKey('model_verification_mismatch')).toEndWith('reason_incomplete');
    expect(
      enterpriseHydrogenEvidenceStatus(
        normalizeEnterpriseHydrogenAdmission({
          ...verified,
          can_test: false,
          can_enable: false,
          reason: 'subscription_unverified',
        })
      )
    ).toBe('verified');
    expect(
      enterpriseHydrogenEvidenceStatus(
        normalizeEnterpriseHydrogenAdmission({
          ...verified,
          can_test: false,
          can_enable: false,
          reason: 'binding_changed',
        })
      )
    ).toBe('stale');
  });

  test('Hydrogen remains independent from Argon modes and intersects exact custom rules', () => {
    const state = normalizeEnterpriseModelPolicy({
      mode: 'catalog',
      effective_mode: 'catalog',
      status: 'ok',
      catalog_known: true,
      enforced_allowed_models: ['gemini-4-argon', hydrogen],
      allowed_models: null,
      excluded_models: [],
      catalog_models: [
        { id: 'gemini-4-argon', allowed: true },
        { id: hydrogen, allowed: true },
      ],
      effective_models: ['gemini-4-argon', hydrogen],
      subscription: { status: 'ok', free_trial: false },
      hydrogen_admission_supported: true,
      hydrogen_admission: { ...verified, enabled: true, available: true },
    })!;
    expect(
      enterprisePolicyPreview(readEnterprisePolicy({ model_policy: 'argon_only' }), state, [])
    ).toEqual(['gemini-4-argon', hydrogen]);
    expect(
      enterprisePolicyPreview(readEnterprisePolicy({ model_policy: 'exclude_argon' }), state, [])
    ).toEqual([hydrogen]);
    expect(
      enterprisePolicyPreview(
        readEnterprisePolicy({ model_policy: 'custom', allowed_models: ['gemini-4-argon'] }),
        state,
        []
      )
    ).toEqual(['gemini-4-argon']);
    expect(enterprisePolicyPreview(readEnterprisePolicy({}), state, ['gemini-4-h*'])).not.toContain(
      hydrogen
    );
    expect(
      enterprisePolicyPreview(
        readEnterprisePolicy({}),
        { ...state, hydrogenAdmission: normalizeEnterpriseHydrogenAdmission(verified) },
        []
      )
    ).not.toContain(hydrogen);
  });

  test('posts only the fixed application identity and accepts only explicit Hydrogen revision ownership', async () => {
    const target = file();
    const raw = {
      status: 'ok',
      model: hydrogen,
      auth_index: 'app-index',
      binding_id: 'binding',
      expected_revision: 3,
      revision: 3,
      resources: serializeEnterpriseResources(enterpriseResources(target.geminiEnterprise)),
      checked_at: proof.checked_at,
      elapsed_ms: 5,
      http_status: 200,
      hydrogen_admission_supported: true,
      hydrogen_admission: verified,
      hydrogen_test_id: proof.test_id,
    };
    const post = spyOn(apiClient, 'post').mockResolvedValue(raw);
    const signal = new AbortController().signal;
    expect((await authFileModelTestsApi.test(target, hydrogen, signal)).hydrogenTestId).toBe(
      proof.test_id
    );
    expect(post).toHaveBeenLastCalledWith(
      '/credentials/models/test',
      {
        name: 'fixture.json',
        auth_index: 'app-index',
        model: hydrogen,
        binding_id: 'binding',
        expected_revision: 3,
        expected: raw.resources,
      },
      { signal, timeout: 0 }
    );
    for (const change of [
      { expected_revision: undefined },
      { expected_revision: 2 },
      { revision: 99 },
      { revision: 4 },
      { revision: 2 },
      { hydrogen_test_id: 'forged' },
      { hydrogen_admission_supported: false },
      { resources: { ...raw.resources, engine_id: 'other' } },
    ]) {
      post.mockResolvedValue({ ...raw, ...change });
      await expect(authFileModelTestsApi.test(target, hydrogen, signal)).rejects.toBeInstanceOf(
        InvalidManagementResponseError
      );
    }
    post.mockResolvedValue(raw);
    expect((await authFileModelTestsApi.test(target, hydrogen, signal)).revision).toBe(3);
  });

  test('runs a registered Carbon alias as a direct generation without requiring saved proof', async () => {
    const target = file({ ...manualAdmission, enabled: true, available: true, can_test: false });
    const alias = 'carbon-alias';
    const carbon = 'gemini-4-carbon';
    const raw = {
      status: 'ok',
      model: alias,
      upstream_model: carbon,
      auth_index: 'app-index',
      binding_id: 'binding',
      revision: 3,
      resources: serializeEnterpriseResources(enterpriseResources(target.geminiEnterprise)),
      checked_at: proof.checked_at,
      elapsed_ms: 5,
      http_status: 200,
    };
    const post = spyOn(apiClient, 'post').mockResolvedValue(raw);
    const signal = new AbortController().signal;
    const testDirect = (selected = target) =>
      authFileModelTestsApi.test(selected, alias, signal, carbon);
    expect(await testDirect()).toMatchObject({ status: 'ok', model: alias, upstreamModel: carbon });
    expect(post).toHaveBeenLastCalledWith(
      '/credentials/models/test',
      {
        name: 'fixture.json',
        auth_index: 'app-index',
        model: alias,
        carbon_direct: true,
        binding_id: 'binding',
        expected_revision: 3,
        expected: raw.resources,
      },
      { signal, timeout: 0 }
    );
  });

  test('rejects late Hydrogen test and switch responses after cancellation or connection changes', async () => {
    let connection = 10;
    spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => connection);
    const target = file(verified);
    const raw = {
      status: 'ok',
      model: hydrogen,
      auth_index: 'app-index',
      binding_id: 'binding',
      expected_revision: 3,
      revision: 3,
      resources: serializeEnterpriseResources(enterpriseResources(target.geminiEnterprise)),
      checked_at: proof.checked_at,
      elapsed_ms: 5,
      http_status: 200,
      hydrogen_admission_supported: true,
      hydrogen_admission: verified,
      hydrogen_test_id: proof.test_id,
    };
    let finishTest!: (value: Record<string, unknown>) => void;
    let finishSwitch!: (value: Record<string, unknown>) => void;
    spyOn(apiClient, 'post').mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          finishTest = resolve;
        })
    );
    spyOn(apiClient, 'patch').mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          finishSwitch = resolve;
        })
    );
    for (const changeConnection of [false, true]) {
      const testController = new AbortController();
      const pendingTest = authFileModelTestsApi.test(target, hydrogen, testController.signal);
      if (changeConnection) connection += 2;
      else testController.abort();
      finishTest(raw);
      await expect(pendingTest).rejects.toMatchObject({ name: 'AbortError' });

      const switchController = new AbortController();
      const pendingSwitch = geminiEnterpriseApi.updateCollection(
        target,
        { fields: { hydrogen_enabled: true }, hydrogenTestId: proof.test_id },
        switchController.signal
      );
      if (changeConnection) connection += 2;
      else switchController.abort();
      finishSwitch({ status: 'ok', gemini_enterprise: { collections: [] } });
      await expect(pendingSwitch).rejects.toMatchObject({ name: 'AbortError' });
    }
    expect(target.geminiEnterprise?.hydrogenAdmission?.enabled).toBe(false);
  });

  test('uses application CAS and the server proof ID to enable, while disabling requires no proof', async () => {
    const target = file(verified);
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({
      status: 'ok',
      gemini_enterprise: {
        account_id: 'account',
        hydrogen_admission_supported: true,
        collections: [],
      },
    });
    const signal = new AbortController().signal;
    await geminiEnterpriseApi.updateCollection(
      target,
      { fields: { hydrogen_enabled: true }, hydrogenTestId: proof.test_id },
      signal
    );
    expect(patch).toHaveBeenLastCalledWith(
      '/credentials/gemini-enterprise/collections',
      {
        name: 'fixture.json',
        auth_index: 'app-index',
        binding_id: 'binding',
        expected_revision: 3,
        fields: { hydrogen_enabled: true },
        hydrogen_test_id: proof.test_id,
      },
      { signal, timeout: 0 }
    );
    await geminiEnterpriseApi.updateCollection(
      target,
      { fields: { hydrogen_enabled: false } },
      signal
    );
    expect(patch.mock.calls[1][1]).not.toHaveProperty('hydrogen_test_id');
    patch.mockRejectedValue({ status: 409, apiCode: 'credential_changed' });
    await expect(
      geminiEnterpriseApi.updateCollection(target, { fields: { hydrogen_enabled: false } }, signal)
    ).rejects.toMatchObject({ status: 409 });
    expect(enterpriseHydrogenSummary([target]).enabled).toBe(0);
  });

  test('isolates bindings, revisions and disabled states while allowing Hydrogen-only refresh', () => {
    const initial = file();
    const tested = file(verified);
    expect(sameEnterpriseNonHydrogenState(initial, tested)).toBe(true);
    for (const change of [
      { ...initial, disabled: true },
      { ...initial, authIndex: 'other' },
      { ...initial, geminiEnterprise: { ...initial.geminiEnterprise, revision: 4 } },
      { ...initial, geminiEnterprise: { ...initial.geminiEnterprise, engineId: 'other' } },
    ]) {
      expect(enterpriseHydrogenTargetIdentity(initial)).not.toBe(
        enterpriseHydrogenTargetIdentity(change)
      );
      expect(sameEnterpriseNonHydrogenState(initial, change)).toBe(false);
    }
    const source = readFileSync(
      new URL('../src/features/authFiles/hooks/useAuthFilesModels.ts', import.meta.url),
      'utf8'
    );
    expect(source).toContain('connection === apiClient.getConnectionRevision()');
    expect(source).toContain('hydrogenRequest.current?.abort()');
    expect(source).toContain('enterpriseMutationVersion');
    const tests = readFileSync(
      new URL('../src/features/authFiles/hooks/useAuthFileModelTests.ts', import.meta.url),
      'utf8'
    );
    expect(tests).not.toContain('hydrogen_enabled: true');
  });

  test('renders old-backend degradation, manual off/on, incomplete proofs and failed saves without optimistic success', async () => {
    const unverified = await renderPanel();
    expect(unverified).toContain('Not verified');
    expect(unverified).toMatch(/<input[^>]*disabled=""/);
    expect(unverified).not.toMatch(/<input[^>]*checked=""/);
    const ready = await renderPanel(verified);
    expect(ready).toContain('Verification passed');
    expect(ready).not.toMatch(/<input[^>]*disabled=""/);
    expect(ready).not.toMatch(/<input[^>]*checked=""/);
    const failed = await renderPanel(
      { ...verified, enabled: true },
      { error: 'Save failed; last state retained' }
    );
    expect(failed).toMatch(/<input[^>]*checked=""/);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Currently unavailable');
    expect(await renderPanel(verified, { saving: true })).toContain(
      'waiting for the backend to confirm'
    );
    const { i18n } = await translations();
    const legacy = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(EnterpriseHydrogenAdmission, {
          file: {
            ...file(),
            geminiEnterprise: { ...file().geminiEnterprise, hydrogenAdmissionSupported: undefined },
          },
        })
      )
    );
    expect(legacy).toContain('does not support application-level Hydrogen');
  });

  test('the model dialog keeps the closed candidate and its test action even with no business models', async () => {
    const { i18n } = await translations();
    const content = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(AuthFileModelsModal, {
          open: true,
          fileName: 'fixture.json',
          fileType: 'gemini-enterprise',
          file: file(),
          loading: false,
          error: null,
          models: [],
          testCandidates: [{ id: hydrogen, test_candidate: true, business_registered: false }],
          excluded: {},
          testsEnabled: true,
          onClose: () => {},
          onCopyText: () => {},
          onTestModels: () => {},
          onVerifyHydrogen: () => {},
          onHydrogenChange: () => {},
        })
      )
    );
    expect(content).toContain('Separate test candidate');
    expect(content).toContain('Test Hydrogen');
    expect(content).toContain('not a business model');
  });

  test('the model dialog lists admitted Hydrogen and aliases, hides closed or blocked candidates, and counts only displayed models', async () => {
    const { i18n } = await translations();
    for (const admission of [
      { ...verified, enabled: true, available: true },
      verified,
      { ...verified, enabled: true, available: false },
    ]) {
      const active = admission.available === true;
      const content = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(AuthFileModelsModal, {
            open: true,
            fileName: 'fixture.json',
            fileType: 'gemini-enterprise',
            file: file(admission),
            loading: false,
            error: null,
            models: [
              { id: 'gemini-4-argon', display_name: 'Existing Argon row' },
              { id: hydrogen, display_name: 'Admitted Hydrogen row', upstream_model: hydrogen },
              { id: 'hydrogen-alias', display_name: 'Admitted Hydrogen alias', upstream_model: hydrogen },
            ],
            testCandidates: [{ id: hydrogen, test_candidate: true, business_registered: active }],
            excluded: {},
            testsEnabled: true,
            onClose: () => {},
            onCopyText: () => {},
            onTestModels: () => {},
            onVerifyHydrogen: () => {},
            onHydrogenChange: () => {},
          })
        )
      );
      expect(content.includes('Admitted Hydrogen row')).toBe(active);
      expect(content.includes('Admitted Hydrogen alias')).toBe(active);
      for (const model of [hydrogen, 'hydrogen-alias']) {
        const button = content.match(new RegExp(`<button[^>]*aria-label="Test ${model}"[^>]*>`));
        expect(Boolean(button)).toBe(active);
        if (button) expect(button[0]).not.toContain('disabled');
      }
      expect(content.includes('Admitted business model')).toBe(active);
      expect(content.includes('not a business model')).toBe(!active);
      expect(content).toContain(`Supported models · ${active ? 3 : 1}`);
      expect(content).toContain(`${active ? 3 : 1} text models`);
    }
  });

  test('all six languages distinguish an admitted Hydrogen model from a separate test candidate', async () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'ko', 'vi']) {
      const { messages } = await translations(locale);
      const content = await renderPanel(
        { ...verified, enabled: true, available: true },
        {},
        locale
      );
      expect(content).toContain(messages.business_model);
      expect(content).not.toContain(messages.candidate);
    }
  });

  test('all six languages expose matching messages and accessible native controls', async () => {
    let keys: string[] | undefined;
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'ko', 'vi']) {
      const { messages } = await translations(locale);
      keys ??= Object.keys(messages).sort();
      expect(Object.keys(messages).sort()).toEqual(keys);
      const content = await renderPanel(verified, {}, locale);
      expect(content).toContain('type="checkbox"');
      expect(content).toContain('aria-describedby=');
      expect(content).toContain('aria-label=');
      expect(content).not.toContain('gemini_enterprise.hydrogen.');
    }
  });
});

describe('Hydrogen manual admission without a mandatory model test', () => {
  test('accepts backend eligibility independently of absent, failed or malformed diagnostic evidence', () => {
    for (const diagnostic of [
      undefined,
      { ...proof, status: 'failed', http_status: 500, reason: 'upstream_unavailable' },
      { ...proof, status: 'incomplete' },
      { ...proof, status: 'needs_review', reason: 'model_not_enabled' },
      { ...proof, checked_at: 'invalid' },
      { ...proof, upstream_model: 'gemini-4-argon' },
    ]) {
      const raw = {
        ...manualAdmission,
        enabled: true,
        available: true,
        reason: undefined,
        ...(diagnostic ? { test: diagnostic } : {}),
      };
      const admission = normalizeEnterpriseHydrogenAdmission(raw);
      expect(admission).toMatchObject({
        enabled: true,
        available: true,
        canEnable: true,
        verificationRequired: false,
      });
      expect(canEnableEnterpriseHydrogen(file(raw))).toBe(true);
    }
  });

  test('preserves backend subscription and policy refusals and local credential disablement', () => {
    for (const reason of ['subscription_unverified', 'credential_disabled', 'model_excluded']) {
      const raw = { ...manualAdmission, can_enable: false, reason };
      expect(canEnableEnterpriseHydrogen(file(raw))).toBe(false);
      expect(file(raw).geminiEnterprise?.hydrogenAdmission?.available).toBe(false);
    }
    expect(canEnableEnterpriseHydrogen({ ...file(manualAdmission), disabled: true })).toBe(false);
  });

  test('keeps the previous backend contract when the capability field is absent or not boolean', () => {
    for (const flag of [undefined, 'false', 0]) {
      const raw = { ...closed, can_enable: true, verification_required: flag };
      expect(normalizeEnterpriseHydrogenAdmission(raw)?.canEnable).toBe(false);
      expect(canEnableEnterpriseHydrogen(file(raw))).toBe(false);
    }
    expect(canEnableEnterpriseHydrogen(file(verified))).toBe(true);
  });

  test('keeps diagnostics historical when a current subscription becomes unavailable', () => {
    const admission = normalizeEnterpriseHydrogenAdmission({
      ...manualAdmission,
      test: proof,
      can_enable: false,
      can_test: false,
      reason: 'subscription_unverified',
    });
    expect(enterpriseHydrogenEvidenceStatus(admission)).toBe('verified');
    expect(admission?.available).toBe(false);
  });

  test('renders an enabled untested application as available and explains optional testing in all locales', async () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const { messages } = await translations(locale);
      const raw = { ...manualAdmission, enabled: true, available: true, reason: undefined };
      const html = await renderPanel(raw, {}, locale);
      expect(html).toContain(messages.available);
      expect(html).toContain(messages.manual_hint);
      expect(html).not.toContain(messages.enable_requires_test);
    }
  });

  test('renders the manual switch while no diagnostic test exists', async () => {
    const { messages } = await translations();
    const html = await renderPanel(manualAdmission);
    expect(canEnableEnterpriseHydrogen(file(manualAdmission))).toBe(true);
    expect(html).toContain(messages.disabled);
    expect(html).toContain(messages.manual_hint);
    expect(html).not.toContain(messages.enable_requires_test);
  });

  test('serializes an enable operation without any test identifier and keeps the application revision', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({
      status: 'ok',
      gemini_enterprise: {
        account_id: 'account',
        hydrogen_admission_supported: true,
        collections: [],
      },
    });
    const target = file(manualAdmission);
    const signal = new AbortController().signal;
    await geminiEnterpriseApi.updateCollection(
      target,
      { fields: { hydrogen_enabled: true } },
      signal
    );
    expect(patch.mock.calls[0][1]).toMatchObject({
      binding_id: 'binding',
      expected_revision: 3,
      fields: { hydrogen_enabled: true },
    });
    expect(patch.mock.calls[0][1]).not.toHaveProperty('hydrogen_test_id');
    expect(target.geminiEnterprise?.hydrogenAdmission?.enabled).toBe(false);
  });
});
