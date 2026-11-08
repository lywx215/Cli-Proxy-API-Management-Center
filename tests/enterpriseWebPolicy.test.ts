import { afterEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  enterpriseWebApi,
  getEnterpriseWebEditError,
  normalizeEnterpriseWebSummary,
} from '@/services/api/geminiEnterpriseWeb';
import { apiClient } from '@/services/api/client';
import { authFileModelTestsApi } from '@/services/api/authFileModelTests';
import { canTestEnterpriseFile, modelTestIdentity } from '@/features/authFiles/modelTesting';
import { matchesAuthFileSearch, matchesWebModelPolicyFilter } from '@/features/authFiles/logic';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { EnterpriseWebCredentialStatus } from '@/features/authFiles/enterpriseWeb/EnterpriseWebCredentialStatus';
import { isProblemAuthFile } from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';
import en from '@/i18n/locales/en.json';

const catalog = [{ id: 'gemini-4-argon' }, { id: 'gemini-3.8-flash' }];
const legacy = normalizeEnterpriseWebSummary({ revision: 1, available_models: catalog })!;
const classified = normalizeEnterpriseWebSummary({
  revision: 2,
  model_policy: 'argon_only',
  available_models: catalog,
  effective_model_ids: ['gemini-4-argon'],
})!;
const file: AuthFileItem = {
  name: 'web.json',
  type: 'gemini-enterprise-web',
  authIndex: 'web-index',
  geminiEnterpriseWeb: classified,
};
const edit = {
  label: 'Web',
  pageUrl: 'https://vertexaisearch.cloud.google.com/ca/home/cid/test',
  cookies: 'SID=synthetic; SAPISID=synthetic',
  userAgent: '',
  proxyUrl: '',
  priority: 0,
  modelPolicy: 'argon_only' as const,
};
const restores: Array<() => void> = [];
afterEach(() => restores.splice(0).forEach((restore) => restore()));

test('cookie check reports relogin in compact cards and distinguishes transient failure', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  const render = (status: string, compact: boolean) => {
    const summary = normalizeEnterpriseWebSummary({ cookie_check_status: status });
    return renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(EnterpriseWebCredentialStatus, { summary, compact })
      )
    );
  };
  const rejected = render('relogin_required', true);
  expect(rejected).toContain('role="alert"');
  expect(rejected).toContain('Google requires you to sign in again');
  const failed = render('check_failed', false);
  expect(failed).toContain('The last Cookie check failed');
  expect(failed).not.toContain('sign in again');
  expect(render('verified', false)).toContain('Cookie authentication verified');
  expect(render('future_state', false)).toContain('Cookie authentication unverified or expired');
  expect(
    isProblemAuthFile({
      ...file,
      geminiEnterpriseWeb: normalizeEnterpriseWebSummary({
        cookie_check_status: 'relogin_required',
      }),
    })
  ).toBe(true);
});

test('legacy catalogs do not infer classification or enable model tests', () => {
  expect(legacy.modelPolicy).toBe('unclassified');
  expect(legacy.modelPolicySupported).toBe(false);
  expect(legacy.availableModels).toHaveLength(2);
  expect(canTestEnterpriseFile({ ...file, geminiEnterpriseWeb: legacy })).toBe(false);
  expect(canTestEnterpriseFile(file)).toBe(true);
  expect(modelTestIdentity(file)).not.toBe(
    modelTestIdentity({
      ...file,
      geminiEnterpriseWeb: { ...classified, modelPolicy: 'exclude_argon' },
    })
  );
  expect(normalizeEnterpriseWebSummary({ model_policy: 'auto' })?.modelPolicySupported).toBe(false);
});

test('classification is mandatory and is sent with the persisted credential revision', async () => {
  expect(getEnterpriseWebEditError({ ...edit, modelPolicy: 'unclassified' })).toBe(
    'missing_policy'
  );
  expect(getEnterpriseWebEditError(edit)).toBeNull();
  const patch = spyOn(apiClient, 'patch').mockResolvedValue({});
  restores.push(() => patch.mockRestore());
  await enterpriseWebApi.saveCredential({
    ...edit,
    name: file.name,
    expectedRevision: 2,
    cookies: undefined,
  });
  expect(patch.mock.calls[0]).toEqual([
    '/credentials/gemini-enterprise-web',
    expect.objectContaining({ model_policy: 'argon_only', expected_revision: 2 }),
  ]);
  await expect(
    enterpriseWebApi.saveCredential({ ...edit, modelPolicy: 'unclassified' })
  ).rejects.toMatchObject({ code: 'missing_policy' });
  expect(patch).toHaveBeenCalledTimes(1);
});

test('classification filters and localized search do not include other providers', () => {
  expect(matchesWebModelPolicyFilter(file, 'argon_only')).toBe(true);
  expect(matchesWebModelPolicyFilter(file, 'exclude_argon')).toBe(false);
  expect(
    matchesWebModelPolicyFilter({ ...file, geminiEnterpriseWeb: legacy }, 'unclassified')
  ).toBe(true);
  expect(
    matchesWebModelPolicyFilter(
      { name: 'enterprise.json', type: 'gemini-enterprise' },
      'unclassified'
    )
  ).toBe(false);
  expect(matchesAuthFileSearch(file, 'argon_only', null)).toBe(true);
  expect(matchesAuthFileSearch(file, 'Argon 专用', null, ['Argon 专用'])).toBe(true);
});

test('pinned model tests reject pending and wrong classes before an HTTP request', async () => {
  const post = spyOn(apiClient, 'post').mockResolvedValue({});
  restores.push(() => post.mockRestore());
  const signal = new AbortController().signal;
  await expect(
    authFileModelTestsApi.test(
      { ...file, geminiEnterpriseWeb: legacy },
      'x',
      signal,
      'gemini-4-argon'
    )
  ).rejects.toMatchObject({ code: 'missing_policy' });
  await expect(
    authFileModelTestsApi.test(file, 'flash-alias', signal, 'gemini-3.8-flash')
  ).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});

test('cards distinguish raw catalog counts and pending model dialogs explain classification', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  const wrap = (child: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(createElement(I18nextProvider, { i18n }, child));
  const noop = () => {};
  const card = wrap(createElement(EnterpriseWebCredentialStatus, { summary: classified }));
  expect(card).toContain('Argon only');
  expect(card).toContain('Upstream catalog: 2');
  expect(card).toContain('Allowed by current class: 1');
  const modal = wrap(
    createElement(AuthFileModelsModal, {
      open: true,
      fileName: file.name,
      fileType: 'gemini-enterprise-web',
      file: { ...file, geminiEnterpriseWeb: { ...legacy, modelPolicySupported: true } },
      loading: false,
      error: null,
      models: [],
      excluded: {},
      onClose: noop,
      onCopyText: noop,
    })
  );
  expect(modal).toContain(i18n.t('enterprise_web.policy_pending_hint'));
  expect(modal).not.toContain(i18n.t('enterprise_web.catalog_empty'));
});
