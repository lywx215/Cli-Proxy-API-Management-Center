import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { normalizeAuthFileModelsSnapshot } from '@/services/api/authFiles';
import { authFileModelTestsApi } from '@/services/api/authFileModelTests';
import { normalizeEnterpriseModelPolicy } from '@/services/api/enterpriseAccounts';
import { InvalidManagementResponseError } from '@/services/api/managementResponse';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { GeminiEnterpriseAccount } from '@/features/authFiles/components/GeminiEnterpriseAccount';
import {
  enterpriseResources,
  serializeEnterpriseResources,
} from '@/features/authFiles/enterpriseResources';
import type { AuthFileItem } from '@/types';

afterEach(() => mock.restore());
const hydrogen = 'gemini-4-hydrogen';
const carbon = 'gemini-4-carbon';
const alias = 'team/hydrogen-public';
const noop = () => {};

function file(): AuthFileItem {
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
      argonForceSupported: true,
      allModelsSupported: true,
      settings: { argon_force_enabled: true, hydrogen_enabled: false },
      modelPolicyState: normalizeEnterpriseModelPolicy({
        mode: 'argon_only',
        effective_mode: 'argon_only',
        status: 'ok',
        argon_force_enabled: true,
        catalog_known: true,
        catalog_models: [{ id: hydrogen, allowed: true }],
        effective_models: [hydrogen],
        subscription: { status: 'ok', free_trial: false },
      }),
    },
  };
}

test('uses registered models even if old Hydrogen flags report closed and ignores candidates', () => {
  const snapshot = normalizeAuthFileModelsSnapshot({
    models: [
      { id: alias, upstream_model: hydrogen, policy_allowed: true },
      { id: hydrogen, test_candidate: true, business_registered: false },
    ],
    hydrogen_admission_supported: true,
    hydrogen_admission: { enabled: false, available: false },
    test_candidates: [{ id: hydrogen, test_candidate: true }],
  });
  expect(snapshot.models).toEqual([{ id: alias, upstream_model: hydrogen, policy_allowed: true }]);
});

for (const upstream of [hydrogen, carbon]) {
  test('sends a direct, pinned test for ' + upstream, async () => {
    const target = file();
    const model = 'team/model-alias';
    const raw = {
      status: 'ok',
      model,
      upstream_model: upstream,
      auth_index: 'app-index',
      binding_id: 'binding',
      revision: 3,
      resources: serializeEnterpriseResources(enterpriseResources(target.geminiEnterprise)),
      checked_at: '2026-11-14T08:00:00Z',
      elapsed_ms: 5,
      http_status: 200,
    };
    const post = spyOn(apiClient, 'post').mockResolvedValue(raw);
    const signal = new AbortController().signal;
    expect(await authFileModelTestsApi.test(target, model, signal, upstream)).toMatchObject({
      status: 'ok',
      model,
      upstreamModel: upstream,
    });
    expect(post).toHaveBeenLastCalledWith(
      '/credentials/models/test',
      {
        name: 'fixture.json',
        auth_index: 'app-index',
        model,
        ...(upstream === hydrogen ? { hydrogen_direct: true } : { carbon_direct: true }),
        binding_id: 'binding',
        expected_revision: 3,
        expected: raw.resources,
      },
      { signal, timeout: 0 }
    );
    post.mockResolvedValue({ ...raw, revision: 4 });
    await expect(
      authFileModelTestsApi.test(target, model, signal, upstream)
    ).rejects.toBeInstanceOf(InvalidManagementResponseError);
    if (upstream === hydrogen) {
      post.mockResolvedValue({ ...raw, upstream_model: carbon });
      await expect(
        authFileModelTestsApi.test(target, model, signal, upstream)
      ).rejects.toBeInstanceOf(InvalidManagementResponseError);
    }
  });
}

test('uses the ordinary model row and removes old controls from the account and dialog', async () => {
  const locale = 'zh-CN';
  const translation = JSON.parse(readFileSync('src/i18n/locales/zh-CN.json', 'utf8'));
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    resources: { [locale]: { translation } },
    interpolation: { escapeValue: false },
  });
  const target = file();
  const render = (element: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
  const card = render(
    createElement(GeminiEnterpriseAccount, {
      file: target,
      selected: false,
      disableControls: false,
      deleting: null,
      statusUpdating: {},
      manualRefreshing: {},
      onShowModels: noop,
      onDownload: noop,
      onManualRefresh: noop,
      onOpenPrefixProxyEditor: noop,
      onDelete: noop,
      onToggleStatus: noop,
      onToggleSelect: noop,
    })
  );
  const modal = render(
    createElement(AuthFileModelsModal, {
      open: true,
      fileName: target.name,
      fileType: target.type!,
      file: target,
      loading: false,
      error: null,
      models: [{ id: alias, type: 'gemini', upstream_model: hydrogen, policy_allowed: true }],
      excluded: {},
      testsEnabled: true,
      onTestModels: noop,
      onClose: noop,
      onCopyText: noop,
    })
  );
  expect(card).toContain('付费应用（1）');
  expect(card).toContain('全模型');
  expect(card).toContain('仅 Argon / Carbon / Hydrogen');
  expect(modal).toContain(alias);
  expect(modal).toContain(hydrogen);
  expect(modal).toContain(
    `aria-label="${i18n.t('auth_files.model_test_one_label', { model: alias })}"`
  );
  for (const removed of [
    '配置 Google Hydrogen',
    '批量测试 Hydrogen',
    '强制启用',
    '重新验证 Hydrogen',
    'Hydrogen 已关闭',
  ]) {
    expect(card + modal).not.toContain(removed);
  }
});
