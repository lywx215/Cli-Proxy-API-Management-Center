import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { normalizeEnterpriseModelPolicy } from '@/services/api/enterpriseAccounts';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import {
  ENTERPRISE_MODEL_POLICIES,
  buildEnterprisePolicyPatch,
  enterpriseEnforcedModelAllowed,
  enterprisePolicyError,
  enterprisePolicyModelSelectable,
  enterprisePolicyPreview,
  enterprisePolicyRoutingPaused,
  readEnterprisePolicy,
} from '@/features/authFiles/enterpriseModelPolicy';
import {
  EnterpriseModelPolicyFields,
  EnterpriseModelPolicyStatus,
} from '@/features/authFiles/components/EnterpriseModelPolicyFields';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import {
  canTestEnterpriseFile,
  isEnterpriseModelExcluded,
  modelTestIdentity,
} from '@/features/authFiles/modelTesting';
import type { AuthFileItem } from '@/types';

afterEach(() => mock.restore());

const paidModels = ['gemini-4-argon', 'gemini-3-pro-image', 'veo-3.1'];
const catalog = [
  ...paidModels,
  'gemini-3.8-flash',
  'gemini-4-argon-future',
  'imagen-future',
  'auto',
];

function snapshot(overrides: Record<string, unknown> = {}) {
  return normalizeEnterpriseModelPolicy({
    mode: 'catalog',
    effective_mode: 'catalog',
    status: 'ok',
    allowed_models: null,
    excluded_models: [],
    global_excluded_models: [],
    enforced_allowed_models: paidModels,
    enforced_reason: 'paid_subscription_restricted',
    catalog_known: true,
    catalog_models: catalog.map((id) => ({ id, display_name: id, allowed: true })),
    effective_models: paidModels,
    subscription: { status: 'ok', edition: 'business_standard', free_trial: false },
    ...overrides,
  })!;
}

function policyFile(policy = snapshot()): AuthFileItem {
  return {
    name: 'paid-fixture.json',
    type: 'gemini-enterprise',
    authIndex: 'paid-fixture',
    geminiEnterprise: {
      projectId: '123',
      location: 'global',
      engineId: 'fixture-app',
      modelPolicyState: policy,
    },
  };
}

async function translations(locale = 'en') {
  const resource = JSON.parse(
    readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
  );
  const i18n = createInstance();
  await i18n.init({ lng: locale, resources: { [locale]: { translation: resource } } });
  return { i18n, policy: resource.gemini_enterprise.policy };
}

function checkbox(markup: string, model: string): string {
  const row = markup
    .match(/<label\b[^>]*>[\s\S]*?<\/label>/g)
    ?.find((label) => label.includes(` · ${model}</span>`));
  const input = row?.match(/<input\b[^>]*>/)?.[0];
  if (!input) throw new Error(`Missing model checkbox: ${model}`);
  return input;
}

describe('Enterprise mandatory subscription model limits', () => {
  test('normalizes missing, null and empty enforced limits independently and fails closed on malformed limits', () => {
    expect(snapshot({ enforced_allowed_models: undefined }).enforcedAllowedModels).toBeUndefined();
    expect(
      snapshot({ enforced_allowed_models: null, enforced_reason: '' }).enforcedAllowedModels
    ).toBeNull();
    expect(snapshot({ enforced_allowed_models: [] }).enforcedAllowedModels).toEqual([]);
    expect(snapshot().enforcedAllowedModels).toEqual(paidModels);
    expect(snapshot().enforcedReason).toBe('paid_subscription_restricted');
    expect(snapshot({ enforced_reason: '' }).enforcedReason).toBeUndefined();
    expect(snapshot({ enforced_allowed_models: false }).enforcedAllowedModels).toEqual([]);
    expect(
      snapshot({ enforced_allowed_models: ['gemini-4-argon', 123] }).enforcedAllowedModels
    ).toEqual(['gemini-4-argon']);
  });

  test('all five paid policies can only narrow the exact enforced set', () => {
    const policy = snapshot();
    for (const mode of ENTERPRISE_MODEL_POLICIES) {
      const draft = readEnterprisePolicy({ model_policy: mode });
      const expected =
        mode === 'argon_only'
          ? ['gemini-4-argon']
          : mode === 'exclude_argon'
            ? ['gemini-3-pro-image', 'veo-3.1']
            : paidModels;
      expect(enterprisePolicyPreview(draft, policy, [])).toEqual(expected);
    }
    const custom = readEnterprisePolicy({
      model_policy: 'custom',
      allowed_models: ['gemini-3.8-flash', 'gemini-3-pro-image'],
    });
    expect(enterprisePolicyPreview(custom, policy, [])).toEqual(['gemini-3-pro-image']);
    custom.allowedText = 'gemini-3.8-flash';
    expect(enterprisePolicyPreview(custom, policy, [])).toEqual([]);
    expect(enterpriseEnforcedModelAllowed(policy, 'gemini-4-argon-future')).toBe(false);
    expect(enterpriseEnforcedModelAllowed(policy, 'models/gemini-4-argon')).toBe(false);
    expect(enterpriseEnforcedModelAllowed(policy, 'imagen-future')).toBe(false);
  });

  test('intersects enforced models, draft settings, both exclusion scopes and the real catalog', () => {
    const draft = readEnterprisePolicy({ model_policy: 'catalog' });
    expect(
      enterprisePolicyPreview(draft, snapshot({ global_excluded_models: ['veo-*'] }), [
        'gemini-4-*',
      ])
    ).toEqual(['gemini-3-pro-image']);
    expect(
      enterprisePolicyPreview(draft, snapshot({ catalog_models: [{ id: 'gemini-4-argon' }] }), [])
    ).toEqual(['gemini-4-argon']);
    expect(enterprisePolicyPreview(draft, snapshot({ catalog_models: [] }), [])).toEqual([]);
  });

  test('shows known empty intersections before catalog discovery and waits for unresolved nonempty candidates', () => {
    const pending = snapshot({ catalog_known: false, catalog_models: [], effective_models: [] });
    const draft = readEnterprisePolicy({
      model_policy: 'custom',
      allowed_models: ['gemini-3.8-flash'],
    });
    expect(enterprisePolicyPreview(draft, pending, [])).toEqual([]);
    expect(enterprisePolicyPreview(draft, pending, ['*'])).toEqual([]);
    draft.allowedText = 'gemini-4-argon';
    expect(enterprisePolicyPreview(draft, pending, [])).toBeNull();
    expect(enterprisePolicyPreview(draft, pending, ['gemini-4-*'])).toEqual([]);
    draft.allowedText = '';
    expect(enterprisePolicyPreview(draft, pending, [])).toEqual([]);
    draft.mode = 'exclude_argon';
    expect(enterprisePolicyPreview(draft, pending, ['gemini-3-pro-image', 'veo-*'])).toEqual([]);
    expect(enterprisePolicyPreview(draft, pending, [])).toBeNull();
    const unrestrictedTrial = { ...pending, enforcedAllowedModels: null };
    draft.mode = 'argon_only';
    expect(enterprisePolicyPreview(draft, unrestrictedTrial, ['gemini-4-argon'])).toEqual([]);
    expect(
      enterprisePolicyPreview(draft, { ...unrestrictedTrial, enforcedAllowedModels: undefined }, [
        'gemini-4-argon',
      ])
    ).toBeNull();
  });

  test('unknown or inactive new subscriptions stop every manual mode as well as automatic mode', () => {
    for (const status of ['unknown', 'inactive', 'conflict', 'unassigned']) {
      const blocked = snapshot({
        enforced_allowed_models: [],
        enforced_reason: 'subscription_unverified',
        catalog_known: false,
        subscription: { status },
      });
      for (const mode of ENTERPRISE_MODEL_POLICIES) {
        expect(
          enterprisePolicyPreview(readEnterprisePolicy({ model_policy: mode }), blocked, [])
        ).toEqual([]);
      }
      expect(enterprisePolicyRoutingPaused(blocked)).toBe(true);
      expect(canTestEnterpriseFile(policyFile(blocked))).toBe(false);
      expect(isEnterpriseModelExcluded(policyFile(blocked), 'gemini-4-argon')).toBe(true);
    }
  });

  test('keeps legacy manual overrides and confirmed trial media behavior unchanged', () => {
    const legacy = snapshot({
      enforced_allowed_models: undefined,
      enforced_reason: undefined,
      subscription: { status: 'unknown' },
    });
    expect(
      enterprisePolicyPreview(readEnterprisePolicy({ model_policy: 'catalog' }), legacy, [])
    ).toEqual(catalog);
    expect(enterprisePolicyPreview(readEnterprisePolicy({}), legacy, [])).toEqual([]);
    const trial = snapshot({
      enforced_allowed_models: null,
      enforced_reason: '',
      subscription: { status: 'ok', edition: 'enterprise_plus', free_trial: true },
    });
    expect(enterprisePolicyPreview(readEnterprisePolicy({}), trial, [])).toEqual(
      catalog.filter((id) => id !== 'gemini-4-argon' && id !== 'auto')
    );
    expect(
      enterprisePolicyPreview(readEnterprisePolicy({ model_policy: 'catalog' }), trial, [])
    ).toEqual(catalog);
  });

  test('retains paid and trial restrictions while using a stale confirmed subscription', () => {
    const paid = snapshot({
      status: 'stale',
      subscription: { status: 'stale', edition: 'enterprise_plus', free_trial: false },
    });
    expect(enterprisePolicyPreview(readEnterprisePolicy({}), paid, [])).toEqual(paidModels);
    const trial = snapshot({
      status: 'stale',
      enforced_allowed_models: null,
      enforced_reason: '',
      subscription: { status: 'stale', edition: 'enterprise_plus', free_trial: true },
    });
    expect(enterprisePolicyPreview(readEnterprisePolicy({}), trial, [])).toContain('imagen-future');
    expect(enterprisePolicyPreview(readEnterprisePolicy({}), trial, [])).toContain('veo-3.1');
    expect(enterprisePolicyPreview(readEnterprisePolicy({}), trial, [])).not.toContain(
      'gemini-4-argon'
    );
  });

  test('preserves historical model settings and never writes backend enforcement into a patch', () => {
    const original = {
      model_policy: 'custom',
      allowed_models: ['gemini-3.8-flash', 'gemini-4-argon'],
      excluded_models: ['veo-*'],
    };
    const draft = readEnterprisePolicy(original);
    expect(enterprisePolicyPreview(draft, snapshot(), original.excluded_models)).toEqual([
      'gemini-4-argon',
    ]);
    expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({});
    draft.mode = 'catalog';
    draft.touched.mode = true;
    expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({ model_policy: 'catalog' });
    expect(draft.allowedText).toBe('gemini-3.8-flash\ngemini-4-argon');
    draft.mode = 'custom';
    draft.allowedText += '\nimagen-future';
    draft.touched.allowed = true;
    expect(enterprisePolicyError(draft)).toBeNull();
    expect(buildEnterprisePolicyPatch(original, draft, true)).toEqual({
      allowed_models: [...original.allowed_models, 'imagen-future'],
    });
    expect(original.excluded_models).toEqual(['veo-*']);
    expect(buildEnterprisePolicyPatch(original, draft, false)).toEqual({});
  });

  test('invalidates cached lists and tests when the enforced range changes independently of the effective models', () => {
    const state = snapshot({ catalog_known: false, effective_models: [] });
    const identity = modelTestIdentity(policyFile(state));
    for (const enforced of [undefined, null, [], ['gemini-4-argon']]) {
      expect(modelTestIdentity(policyFile({ ...state, enforcedAllowedModels: enforced }))).not.toBe(
        identity
      );
    }
    expect(modelTestIdentity(policyFile({ ...state, enforcedAllowedModels: undefined }))).not.toBe(
      modelTestIdentity(policyFile({ ...state, enforcedAllowedModels: null }))
    );
    expect(
      enterprisePolicyRoutingPaused({
        ...state,
        mode: 'custom',
        effectiveMode: 'custom',
        allowedModels: ['gemini-3.8-flash'],
      })
    ).toBe(true);
  });

  test('blocks adding prohibited choices but allows removing retained prohibited selections', async () => {
    const { i18n } = await translations();
    const state = snapshot({ global_excluded_models: ['gemini-3-pro-image'] });
    const content = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(EnterpriseModelPolicyFields, {
          draft: readEnterprisePolicy({
            model_policy: 'custom',
            allowed_models: ['gemini-3.8-flash', 'auto'],
          }),
          snapshot: state,
          excluded: ['veo-*'],
          disabled: false,
          onChange: () => {},
        })
      )
    );
    expect(checkbox(content, 'gemini-3.8-flash')).toContain('checked=""');
    expect(checkbox(content, 'gemini-3.8-flash')).not.toContain('disabled=""');
    expect(checkbox(content, 'auto')).not.toContain('disabled=""');
    expect(checkbox(content, 'gemini-4-argon')).not.toContain('disabled=""');
    for (const id of ['gemini-4-argon-future', 'gemini-3-pro-image', 'veo-3.1']) {
      expect(checkbox(content, id)).toContain('disabled=""');
    }
    expect(enterprisePolicyModelSelectable('gemini-3.8-flash', snapshot(), [])).toBe(false);
    expect(
      enterprisePolicyModelSelectable(
        'gemini-3.8-flash',
        snapshot({ enforced_allowed_models: null }),
        []
      )
    ).toBe(true);
  });

  test('keeps prohibited upstream rows visible and prevents aliases from bypassing the enforced limit', async () => {
    spyOn(apiClient, 'get').mockResolvedValue({
      models: [{ id: 'flash-alias', upstream_model: 'gemini-3.8-flash' }],
      model_policy_supported: true,
      catalog_models: [{ id: 'gemini-3.8-flash', allowed: false }],
    });
    const models = await authFilesApi.getModelsForAuthFile('paid-fixture.json');
    expect(models).toContainEqual({
      id: 'gemini-3.8-flash',
      type: 'gemini',
      policy_allowed: false,
      upstream_listed: true,
    });
    const { i18n, policy } = await translations();
    const content = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(AuthFileModelsModal, {
          open: true,
          fileName: 'paid-fixture.json',
          fileType: 'gemini-enterprise',
          file: policyFile(),
          loading: false,
          error: null,
          models,
          excluded: {},
          testsEnabled: true,
          onClose: () => {},
          onCopyText: () => {},
        })
      )
    );
    expect(content).toContain('flash-alias');
    expect(content).toContain('gemini-3.8-flash');
    expect(content).toContain(policy.listed_blocked);
    expect(content).toMatch(/<button[^>]*disabled=""[^>]*aria-label="[^"]*flash-alias/);
    expect(isEnterpriseModelExcluded(policyFile(), 'gemini-3.8-flash')).toBe(true);
    expect(isEnterpriseModelExcluded(policyFile(), 'gemini-4-argon')).toBe(false);
  });

  test('shows paid enforcement and manual subscription pauses in all six languages', async () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const { i18n, policy } = await translations(locale);
      for (const compact of [true, false]) {
        const content = renderToStaticMarkup(
          createElement(
            I18nextProvider,
            { i18n },
            createElement(EnterpriseModelPolicyStatus, { snapshot: snapshot(), compact })
          )
        );
        expect(content).toContain(policy.paid);
        expect(content).toContain(compact ? policy.paid_restricted_short : policy.paid_restricted);
        expect(content).not.toContain('gemini_enterprise.policy.');
      }
      const paused = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(EnterpriseModelPolicyStatus, {
            snapshot: snapshot({
              enforced_allowed_models: [],
              enforced_reason: 'subscription_unverified',
              subscription: { status: 'unknown' },
            }),
          })
        )
      );
      expect(paused).toContain(policy.paused);
      expect(paused).toContain(policy.reason_subscription_unverified);
      expect(paused).not.toContain(policy.paid_restricted);
    }
  });
});
