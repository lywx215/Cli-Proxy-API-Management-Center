import { describe, expect, test, spyOn, afterEach, mock } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import zh from '@/i18n/locales/zh-CN.json';
import {
  normalizeEnterpriseAccount,
  normalizeEnterpriseModelPolicy,
} from '@/services/api/enterpriseAccounts';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import {
  buildEnterpriseCatalogPatch,
  enterpriseCatalogError,
  enterpriseCatalogPreview,
  enterpriseDefaultCatalog,
  enterpriseDiscoveryGroups,
  readEnterpriseCatalog,
  ENTERPRISE_TRIAL_CATALOG,
} from '@/features/authFiles/enterpriseCatalog';
import { readEnterprisePolicy } from '@/features/authFiles/enterpriseModelPolicy';
import {
  EnterpriseCatalogFields,
  EnterpriseCatalogStatus,
} from '@/features/authFiles/components/EnterpriseCatalogFields';
import { EnterpriseDiscoveryStatus } from '@/features/authFiles/components/EnterpriseDiscoveryStatus';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';

afterEach(() => mock.restore());

function snapshot(overrides: Record<string, unknown> = {}) {
  return normalizeEnterpriseModelPolicy({
    mode: 'auto',
    effective_mode: 'exclude_argon',
    status: 'ok',
    catalog_known: true,
    catalog_state: {
      source: 'default',
      status: 'fallback',
      last_error: {
        code: 'service_disabled',
        http_status: 403,
        reason: 'SERVICE_DISABLED',
        service: 'discoveryengine.googleapis.com',
        consumer_project: '123',
      },
    },
    enforced_allowed_models: null,
    global_excluded_models: [],
    excluded_models: ['gemini-4-argon'],
    effective_models: ENTERPRISE_TRIAL_CATALOG,
    catalog_models: ENTERPRISE_TRIAL_CATALOG.map((id) => ({ id, allowed: true })),
    subscription: { status: 'ok', edition: 'enterprise_plus', free_trial: true },
    ...overrides,
  })!;
}

function render(component: React.ReactElement) {
  const i18n = createInstance();
  void i18n.init({
    lng: 'zh-CN',
    resources: { 'zh-CN': { translation: zh } },
    initImmediate: false,
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, component));
}

describe('Enterprise catalog fallback', () => {
  test('normalizes the capability, cache state and discovery project_id', () => {
    const account = normalizeEnterpriseAccount({
      catalog_fallback_supported: true,
      discovery: {
        status: 'partial',
        projects: [{ project_id: '123', project_name: 'Known project' }],
        coverage: [{ project_id: '123', location: 'eu', status: 'partial' }],
        warnings: [
          {
            project_id: '123',
            location: 'eu',
            code: 'service_disabled',
            http_status: 403,
            reason: 'SERVICE_DISABLED',
            service: 'discoveryengine.googleapis.com',
            consumer_project: '999',
          },
        ],
      },
    });
    expect(account?.catalogFallbackSupported).toBe(true);
    expect(account?.discovery?.warnings[0]).toMatchObject({
      project: '123',
      consumerProject: '999',
      httpStatus: 403,
    });
    expect(account?.discovery?.coverage?.[0].project).toBe('123');
    expect(snapshot().catalogState?.lastError?.consumerProject).toBe('123');
    expect(normalizeEnterpriseAccount({})?.catalogFallbackSupported).toBeUndefined();
    expect(normalizeEnterpriseModelPolicy({})?.catalogState).toBeUndefined();
  });

  test('retains dormant settings, explicit empties and old-backend compatibility', () => {
    const original = { catalog_fallback: { mode: 'custom', models: ['gemini-3-pro-image'] } };
    const draft = readEnterpriseCatalog(original);
    draft.mode = 'disabled';
    draft.touched = true;
    expect(buildEnterpriseCatalogPatch(original, draft, true)).toEqual({
      catalog_fallback: { mode: 'disabled', models: ['gemini-3-pro-image'] },
    });
    expect(buildEnterpriseCatalogPatch(original, draft, false)).toEqual({});
    draft.mode = 'custom';
    draft.text = '';
    expect(buildEnterpriseCatalogPatch(original, draft, true)).toEqual({
      catalog_fallback: { mode: 'custom', models: [] },
    });
    expect(readEnterpriseCatalog({ catalog_fallback: null }).mode).toBe('default');
    expect(buildEnterpriseCatalogPatch({}, readEnterpriseCatalog({}), true)).toEqual({});
  });

  test('defaults follow verified subscription and preserve exact media IDs', () => {
    expect(enterpriseDefaultCatalog(snapshot())).toEqual(ENTERPRISE_TRIAL_CATALOG);
    expect(
      enterpriseDefaultCatalog(
        snapshot({ subscription: { status: 'ok', edition: 'business_standard', free_trial: true } })
      )
    ).toEqual(['gemini-4-argon']);
    expect(
      enterpriseDefaultCatalog(
        snapshot({
          subscription: { status: 'stale', edition: 'enterprise_plus', free_trial: false },
        })
      )
    ).toEqual(['gemini-4-argon']);
    expect(
      enterpriseDefaultCatalog(snapshot({ subscription: { status: 'unknown', free_trial: false } }))
    ).toEqual([]);
    for (const text of [
      'gemini-*',
      'auto',
      'prefix/gemini-3.8-flash',
      'gemini-4-argon(high)',
      'veo-3.1-fast',
      'gemini-3-pro-image-preview',
    ])
      expect(enterpriseCatalogError({ mode: 'custom', text, touched: true })).toBeTruthy();
    expect(
      enterpriseCatalogError({ mode: 'custom', text: 'gemini-3-pro-image\nveo-3.1', touched: true })
    ).toBeNull();
  });

  test('preview honors authoritative catalogs, paid ceilings, empty lists and local media settings', () => {
    const policy = readEnterprisePolicy({ model_policy: 'catalog' });
    const draft = {
      mode: 'custom' as const,
      text: 'gemini-4-argon\ngemini-3.8-flash\ngemini-3-pro-image\nveo-3.1',
      touched: true,
    };
    const paid = snapshot({
      mode: 'catalog',
      effective_mode: 'catalog',
      enforced_allowed_models: ['gemini-4-argon', 'gemini-3-pro-image', 'veo-3.1'],
      subscription: { status: 'ok', free_trial: false },
      image_generation_disabled: true,
    });
    expect(enterpriseCatalogPreview(draft, policy, paid, ['veo-*'])).toEqual(['gemini-4-argon']);
    expect(enterpriseCatalogPreview({ ...draft, text: '' }, policy, paid, [])).toEqual([]);
    expect(
      enterpriseCatalogPreview(
        draft,
        policy,
        snapshot({ catalog_state: { source: 'cached', status: 'stale' }, catalog_models: [] }),
        []
      )
    ).toEqual([]);
    expect(
      enterpriseCatalogPreview(
        draft,
        policy,
        snapshot({ enforced_allowed_models: [], status: 'blocked' }),
        []
      )
    ).toEqual([]);
  });

  test('groups repeated region errors by resource project and preserves consumer attribution', () => {
    const account = normalizeEnterpriseAccount({
      discovery: {
        status: 'partial',
        projects: [{ project_id: '123' }, { project_id: '234' }],
        warnings: [
          { project_id: '234', location: 'us', code: 'service_disabled', consumer_project: '999' },
          { project_id: '234', location: 'eu', code: 'service_disabled', consumer_project: '999' },
          { code: 'permission_denied' },
        ],
      },
    });
    const groups = enterpriseDiscoveryGroups(account);
    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.project === '123')?.errors).toHaveLength(0);
    expect(groups.find((group) => group.project === '234')?.errors).toEqual([
      {
        code: 'service_disabled',
        consumerProject: '999',
        service: undefined,
        regions: ['us', 'eu'],
      },
    ]);
    const html = render(createElement(EnterpriseDiscoveryStatus, { account }));
    expect(html).toContain('账号级项目枚举');
    expect(html).toContain('999');
    expect(html).toContain('us, eu');
  });

  test('renders fallback provenance, media shortcuts, empty intersection and known cache timestamp', () => {
    const state = snapshot({
      catalog_state: { source: 'cached', status: 'stale', last_success_at: '2026-10-26T12:00:00Z' },
    });
    expect(render(createElement(EnterpriseCatalogStatus, { snapshot: state }))).toContain(
      '最近成功目录'
    );
    const html = render(
      createElement(EnterpriseCatalogFields, {
        draft: { mode: 'custom', text: '', touched: true },
        policy: readEnterprisePolicy({}),
        snapshot: snapshot(),
        excluded: [],
        disabled: false,
        onChange: () => {},
      })
    );
    expect(html).toContain('添加 gemini-3-pro-image');
    expect(html).toContain('添加 veo-3.1');
    expect(html).toContain('不参与调度');
    expect(html).toContain('尚未获得上游目录确认');
  });

  test('never relabels default or custom fallback as upstream-listed', async () => {
    spyOn(apiClient, 'get').mockResolvedValue({
      model_policy_supported: true,
      models: [
        {
          id: 'gemini-4-argon',
          policy_allowed: true,
          catalog_source: 'default',
          upstream_listed: false,
        },
      ],
      catalog_models: [
        {
          id: 'gemini-3.8-flash',
          allowed: false,
          catalog_source: 'custom',
          upstream_listed: false,
        },
      ],
    });
    const models = await authFilesApi.getModelsForAuthFile('fixture.json');
    expect(models.map((entry) => entry.upstream_listed)).toEqual([false, false]);
    expect(models.map((entry) => entry.catalog_source)).toEqual(['default', 'custom']);
    const html = render(
      createElement(AuthFileModelsModal, {
        open: true,
        fileName: 'fixture.json',
        fileType: 'gemini-enterprise',
        loading: false,
        error: null,
        models,
        excluded: {},
        onClose: () => {},
        onCopyText: () => {},
      })
    );
    expect(html).toContain('兜底候选 · 策略禁止');
    expect(html).not.toContain('上游已列出');
  });
});
