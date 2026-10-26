import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import {
  normalizeEnterpriseAccount,
  normalizeEnterpriseModelPolicy,
} from '@/services/api/enterpriseAccounts';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import {
  buildEnterprisePolicyPatch,
  enterprisePolicyError,
  enterprisePolicyHasChanges,
  enterprisePolicyPreview,
  enterprisePolicyRoutingPaused,
  readEnterprisePolicy,
} from '@/features/authFiles/enterpriseModelPolicy';
import { EnterpriseModelPolicyFields } from '@/features/authFiles/components/EnterpriseModelPolicyFields';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import {
  canTestEnterpriseFile,
  isEnterpriseModelExcluded,
  isEnterpriseTextModel,
  modelTestIdentity,
} from '@/features/authFiles/modelTesting';
import type { AuthFileItem } from '@/types';

afterEach(() => mock.restore());

function snapshot(overrides: Record<string, unknown> = {}) {
  return normalizeEnterpriseModelPolicy({
    mode: 'auto',
    effective_mode: 'exclude_argon',
    status: 'ok',
    catalog_known: true,
    allowed_models: null,
    excluded_models: ['gemini-4-argon'],
    global_excluded_models: [],
    effective_models: ['gemini-3.8-flash'],
    catalog_models: [
      { id: 'gemini-4-argon', display_name: 'Argon', allowed: false },
      { id: 'gemini-3.8-flash', display_name: 'Flash', allowed: true },
      { id: 'auto', display_name: 'Auto', allowed: false },
    ],
    subscription: {
      status: 'ok',
      edition: 'enterprise_plus',
      free_trial: true,
      last_success_at: '2026-10-26T08:00:00Z',
    },
    ...overrides,
  })!;
}

function policyFile(policy = snapshot()): AuthFileItem {
  return {
    name: 'policy-fixture.json',
    type: 'gemini-enterprise',
    authIndex: 'fixture-auth',
    geminiEnterprise: {
      projectId: '123',
      location: 'global',
      engineId: 'fixture-app',
      modelPolicyState: policy,
    },
  };
}

describe('Enterprise model policy settings and API normalization', () => {
  test('preserves unknown, real false, empty and absent values', () => {
    expect(snapshot().allowedModels).toBeNull();
    expect(snapshot({ allowed_models: [] }).allowedModels).toEqual([]);
    expect(
      snapshot({ subscription: { status: 'ok', free_trial: false } }).subscription.freeTrial
    ).toBe(false);
    expect(snapshot({ subscription: { status: 'unknown' } }).subscription.freeTrial).toBeNull();
    const account = normalizeEnterpriseAccount({
      model_policy_supported: true,
      collections: [
        {
          binding_id: 'one',
          settings: { model_policy: 'custom', allowed_models: [], excluded_models: ['blocked'] },
          model_policy_state: { mode: 'custom', status: 'ok' },
        },
      ],
    });
    expect(account?.modelPolicySupported).toBe(true);
    expect(account?.collections?.[0].settings.allowed_models).toEqual([]);
    expect(account?.collections?.[0].modelPolicyState?.mode).toBe('custom');
    expect(normalizeEnterpriseAccount({})?.modelPolicySupported).toBeUndefined();
    expect(normalizeEnterpriseModelPolicy(null)).toBeUndefined();
    expect(snapshot({ allowed_models: undefined }).allowedModels).toBeNull();
  });

  test('distinguishes an absent or null whitelist from an explicitly empty whitelist', () => {
    for (const original of [{}, { allowed_models: null }]) {
      const draft = readEnterprisePolicy(original);
      expect(draft.whitelistEnabled).toBe(false);
      expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({});
      draft.whitelistEnabled = true;
      draft.touched.allowed = true;
      expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({ allowed_models: [] });
      expect(buildEnterprisePolicyPatch(original, draft, false)).toEqual({});
    }
    const original = { allowed_models: [] };
    const draft = readEnterprisePolicy(original);
    expect(draft.whitelistEnabled).toBe(true);
    draft.touched.allowed = true;
    expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({});
    draft.whitelistEnabled = false;
    expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({ allowed_models: null });
  });

  test('saving a mode preserves existing exclusions and a dormant whitelist', () => {
    const original = {
      model_policy: 'custom',
      allowed_models: ['gemini-4-argon'],
      excluded_models: ['veo-*'],
    };
    const draft = readEnterprisePolicy(original);
    draft.mode = 'auto';
    draft.touched.mode = true;
    expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({ model_policy: 'auto' });
    expect(buildEnterprisePolicyPatch(original, draft, false)).toEqual({});
    expect(draft.allowedText).toBe('gemini-4-argon');
    draft.mode = 'custom';
    expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({});
    expect(original.excluded_models).toEqual(['veo-*']);
    draft.touched.allowed = true;
    draft.allowedText = '';
    expect(buildEnterprisePolicyPatch(original, draft, true).allowed_models).toEqual([]);
    draft.whitelistEnabled = false;
    expect(buildEnterprisePolicyPatch(original, draft, true).allowed_models).toBeNull();
  });

  test('previews automatic, manual, global exclusions and empty intersections', () => {
    const automatic = readEnterprisePolicy({});
    expect(enterprisePolicyPreview(automatic, snapshot(), [])).toEqual(['gemini-3.8-flash']);
    expect(
      enterprisePolicyPreview(
        automatic,
        snapshot({ status: 'blocked', subscription: { status: 'unknown' } }),
        []
      )
    ).toEqual([]);
    automatic.mode = 'argon_only';
    expect(enterprisePolicyPreview(automatic, snapshot(), [])).toEqual(['gemini-4-argon']);
    expect(
      enterprisePolicyPreview(automatic, snapshot({ global_excluded_models: ['gemini-4-*'] }), [])
    ).toEqual([]);
    expect(enterprisePolicyPreview(automatic, snapshot(), ['gemini-4-*'])).toEqual([]);
    const custom = readEnterprisePolicy({ model_policy: 'custom', allowed_models: [] });
    expect(enterprisePolicyPreview(custom, snapshot(), [])).toEqual([]);
    expect(enterprisePolicyPreview(custom, undefined, [])).toEqual([]);
  });

  test('an explicitly empty custom whitelist pauses routing before the catalog is known', () => {
    const policy = snapshot({
      mode: 'custom',
      effective_mode: 'custom',
      allowed_models: [],
      catalog_known: false,
      catalog_models: [],
      effective_models: [],
    });
    const draft = readEnterprisePolicy({ model_policy: 'custom', allowed_models: [] });
    expect(enterprisePolicyPreview(draft, policy, [])).toEqual([]);
    expect(enterprisePolicyPreview(draft, undefined, [])).toEqual([]);
    expect(enterprisePolicyRoutingPaused(policy)).toBe(true);
    expect(canTestEnterpriseFile(policyFile(policy))).toBe(false);

    draft.allowedText = 'gemini-4-argon';
    expect(enterprisePolicyPreview(draft, policy, [])).toBeNull();
    expect(enterprisePolicyPreview(draft, undefined, [])).toBeNull();
    expect(enterprisePolicyRoutingPaused({ ...policy, allowedModels: ['gemini-4-argon'] })).toBe(
      false
    );

    draft.whitelistEnabled = false;
    expect(enterprisePolicyPreview(draft, policy, [])).toBeNull();
    expect(enterprisePolicyRoutingPaused({ ...policy, allowedModels: null })).toBe(false);
    draft.whitelistEnabled = true;
    draft.allowedText = '';
    draft.mode = 'catalog';
    expect(enterprisePolicyPreview(draft, policy, [])).toBeNull();
    expect(enterprisePolicyRoutingPaused({ ...policy, mode: 'catalog' })).toBe(false);
  });

  test('recomputes automatic previews from subscription observations after changing modes', () => {
    const draft = readEnterprisePolicy({ model_policy: 'custom', allowed_models: [] });
    draft.mode = 'auto';
    draft.touched.mode = true;
    const savedCustom = {
      mode: 'custom',
      effective_mode: 'custom',
      allowed_models: [],
      effective_models: [],
    };
    for (const status of ['ok', 'stale']) {
      expect(
        enterprisePolicyPreview(
          draft,
          snapshot({
            ...savedCustom,
            subscription: { status, edition: 'business_standard', free_trial: true },
          }),
          []
        )
      ).toEqual(['gemini-4-argon']);
      expect(
        enterprisePolicyPreview(
          draft,
          snapshot({
            ...savedCustom,
            subscription: { status, edition: 'enterprise_plus', free_trial: true },
          }),
          []
        )
      ).toEqual(['gemini-3.8-flash']);
    }
    for (const freeTrial of [false, null]) {
      expect(
        enterprisePolicyPreview(
          draft,
          snapshot({
            ...savedCustom,
            subscription: { status: 'ok', edition: 'business_standard', free_trial: freeTrial },
          }),
          []
        )
      ).toEqual(['gemini-4-argon', 'gemini-3.8-flash', 'auto']);
    }
    expect(draft.allowedText).toBe('');
    expect(draft.whitelistEnabled).toBe(true);
  });

  test('automatic previews pause for unknown subscriptions even after a manual catalog policy', () => {
    const draft = readEnterprisePolicy({ model_policy: 'catalog' });
    draft.mode = 'auto';
    for (const status of ['unknown', 'inactive', 'conflict', 'unassigned']) {
      const policy = snapshot({
        mode: 'catalog',
        effective_mode: 'catalog',
        status: 'ok',
        subscription: { status },
      });
      expect(enterprisePolicyPreview(draft, policy, [])).toEqual([]);
      expect(enterprisePolicyPreview(draft, { ...policy, catalogKnown: false }, [])).toEqual([]);
      draft.mode = 'catalog';
      expect(enterprisePolicyPreview(draft, policy, [])).toEqual([
        'gemini-4-argon',
        'gemini-3.8-flash',
        'auto',
      ]);
      draft.mode = 'auto';
    }
  });

  test('validates exact model IDs without accepting wildcard policies', () => {
    const draft = readEnterprisePolicy({ model_policy: 'custom', allowed_models: [] });
    draft.touched.allowed = true;
    for (const text of [
      'gemini-*',
      'models/gemini-4-argon',
      'gemini-4-argon(high)',
      'model with spaces',
    ]) {
      draft.allowedText = text;
      expect(enterprisePolicyError(draft)).not.toBeNull();
      expect(
        enterprisePolicyHasChanges({ model_policy: 'custom', allowed_models: [] }, draft, true)
      ).toBe(true);
      expect(enterprisePolicyHasChanges({}, draft, false)).toBe(false);
    }
    draft.allowedText = 'gemini-4-argon\ngemini-3.8-flash';
    expect(enterprisePolicyError(draft)).toBeNull();
  });

  test('keeps invalid whitelist drafts dirty when a valid patch cannot be shown', () => {
    const original = { model_policy: 'custom', allowed_models: ['gemini-4-argon'] };
    const draft = readEnterprisePolicy(original);
    expect(enterprisePolicyHasChanges(original, draft, true)).toBe(false);
    draft.allowedText = 'gemini-*';
    draft.touched.allowed = true;
    expect(enterprisePolicyError(draft)).toBe('gemini_enterprise.policy.invalid_allowed');
    expect(enterprisePolicyHasChanges(original, draft, true)).toBe(true);
    draft.allowedText = 'gemini-4-argon';
    expect(enterprisePolicyHasChanges(original, draft, true)).toBe(false);
  });

  test('pauses known empty routing and changes request identity as the policy changes', () => {
    const baseline = snapshot();
    const file = policyFile(baseline);
    const identity = modelTestIdentity(file);
    expect(canTestEnterpriseFile(file)).toBe(true);
    expect(enterprisePolicyRoutingPaused(undefined)).toBe(false);
    for (const policy of [
      { ...baseline, status: 'blocked' },
      { ...baseline, effectiveModels: [] },
    ]) {
      expect(enterprisePolicyRoutingPaused(policy)).toBe(true);
      expect(canTestEnterpriseFile(policyFile(policy))).toBe(false);
      expect(modelTestIdentity(policyFile(policy))).not.toBe(identity);
    }
    const pending = { ...baseline, catalogKnown: false, effectiveModels: [] };
    expect(enterprisePolicyRoutingPaused(pending)).toBe(false);
    expect(modelTestIdentity(policyFile({ ...pending, catalogKnown: true }))).not.toBe(
      modelTestIdentity(policyFile(pending))
    );
    expect(modelTestIdentity(policyFile({ ...baseline, effectiveMode: 'argon_only' }))).not.toBe(
      identity
    );
    expect(isEnterpriseModelExcluded(file, 'gemini-4-argon')).toBe(true);
    expect(isEnterpriseModelExcluded(policyFile({ ...baseline, status: 'blocked' }), 'alias')).toBe(
      true
    );
    expect(isEnterpriseTextModel({ id: 'friendly-alias', upstream_model: 'veo-3' })).toBe(false);
  });

  test('model API retains blocked upstream entries and supports older backends', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({
      models: [{ id: 'flash-alias', upstream_model: 'gemini-3.8-flash' }],
      model_policy_supported: true,
      catalog_models: [
        { id: 'gemini-4-argon', allowed: false },
        { id: 'gemini-3.8-flash', allowed: true },
      ],
    });
    expect(await authFilesApi.getModelsForAuthFile('fixture.json')).toEqual([
      { id: 'flash-alias', upstream_model: 'gemini-3.8-flash' },
      { id: 'gemini-4-argon', type: 'gemini', policy_allowed: false, upstream_listed: true },
    ]);
    get.mockResolvedValue({ models: [{ id: 'legacy-model' }] });
    expect(await authFilesApi.getModelsForAuthFile('fixture.json')).toEqual([
      { id: 'legacy-model' },
    ]);
    get.mockResolvedValue({
      models: [{ id: 'legacy-model' }],
      catalog_models: [{ id: 'hidden-model', allowed: false }],
    });
    expect(await authFilesApi.getModelsForAuthFile('fixture.json')).toEqual([
      { id: 'legacy-model' },
    ]);
  });

  test('renders pause and empty-list feedback and keeps all six locales aligned', async () => {
    const english = JSON.parse(
      readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8')
    );
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } } });
    const content = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(EnterpriseModelPolicyFields, {
          draft: readEnterprisePolicy({ model_policy: 'custom', allowed_models: [] }),
          snapshot: snapshot({ status: 'blocked' }),
          excluded: [],
          disabled: false,
          onChange: () => {},
        })
      )
    );
    expect(content).toContain('No effective models');
    expect(content).toContain('not participating in model routing');
    expect(content).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    const stale = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(EnterpriseModelPolicyFields, {
          draft: readEnterprisePolicy({}),
          snapshot: snapshot({
            status: 'stale',
            subscription: { status: 'stale', free_trial: false },
          }),
          excluded: [],
          disabled: false,
          onChange: () => {},
        })
      )
    );
    expect(stale).toContain(english.gemini_enterprise.policy.stale);
    expect(stale).toContain(english.gemini_enterprise.policy.paid);
    const keys = Object.keys(english.gemini_enterprise.policy).sort();
    for (const locale of ['zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const resource = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      );
      expect(Object.keys(resource.gemini_enterprise.policy).sort()).toEqual(keys);
    }
  });

  test('renders actual upstream identities and policy badges for aliases', async () => {
    const english = JSON.parse(
      readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8')
    );
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } } });
    const content = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(AuthFileModelsModal, {
          open: true,
          fileName: 'fixture.json',
          fileType: 'gemini-enterprise',
          file: policyFile(),
          loading: false,
          error: null,
          models: [{ id: 'argon-alias', upstream_model: 'gemini-4-argon' }],
          excluded: {},
          testsEnabled: true,
          onClose: () => {},
          onCopyText: () => {},
        })
      )
    );
    expect(content).toContain('argon-alias');
    expect(content).toContain('gemini-4-argon');
    expect(content).toContain(english.gemini_enterprise.policy.listed_blocked);
    expect(content).toMatch(/<button[^>]*disabled=""[^>]*aria-label="[^"]*argon-alias/);
  });
});
