import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { geminiEnterpriseApi } from '@/services/api/geminiEnterprise';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import { InvalidManagementResponseError } from '@/services/api/managementResponse';
import { GeminiEnterpriseRegionEditor } from '@/features/authFiles/components/GeminiEnterpriseRegionEditor';
import {
  enterpriseResources,
  enterpriseRegionEndpoint,
  enterpriseRegionOptions,
  sameEnterpriseResources,
  serializeEnterpriseResources,
  validEnterpriseResources,
} from '@/features/authFiles/enterpriseResources';
import { enterpriseQuotaKey } from '@/features/authFiles/geminiEnterpriseQuota';
import type { AuthFileItem } from '@/types';

const file: AuthFileItem = {
  name: 'regional.json',
  authIndex: 'fixture-index',
  type: 'gemini-enterprise',
  geminiEnterprise: {
    clientId: 'fixture-client',
    projectId: '123',
    location: 'global',
    engineId: 'global-app',
    hasRefreshToken: true,
    resourceEditSupported: true,
  },
  access_token: 'never-display-token',
};
const expected = enterpriseResources(file.geminiEnterprise);
const saved = {
  status: 'ok',
  gemini_enterprise: { project_id: '123', location: 'us', engine_id: 'us-app' },
};

describe('Gemini Enterprise region editor', () => {
  test('offers official regions, retains existing bindings and never derives arbitrary domains', () => {
    expect(enterpriseRegionOptions('global').map((option) => option.value)).toEqual([
      'global',
      'us',
      'eu',
    ]);
    expect(enterpriseRegionOptions('ca').map((option) => option.value)).toEqual([
      'ca',
      'global',
      'us',
      'eu',
    ]);
    expect(enterpriseResources(undefined)).toMatchObject({
      location: 'global',
      collectionId: 'default_collection',
      assistantId: 'default_assistant',
    });
    expect(validEnterpriseResources(expected)).toBe(true);
    expect(validEnterpriseResources({ ...expected, engineId: '../escape' })).toBe(false);
    expect(validEnterpriseResources({ ...expected, projectId: '' })).toBe(false);
    expect(sameEnterpriseResources(expected, { ...expected, engineId: ' global-app ' })).toBe(true);
    expect(enterpriseRegionEndpoint('us')).toBe('https://us-discoveryengine.googleapis.com');
    expect(enterpriseRegionEndpoint('eu')).toBe('https://eu-discoveryengine.googleapis.com');
    expect(enterpriseRegionEndpoint('global')).toBe('https://discoveryengine.googleapis.com');
    expect(enterpriseRegionEndpoint('evil.test')).toBe('https://discoveryengine.googleapis.com');
  });

  test('normalizes public editing capability and isolates quota caches after rebinding', () => {
    const normalized = normalizeAuthFilesResponse({
      files: [
        {
          name: file.name,
          type: 'gemini-enterprise',
          auth_index: file.authIndex,
          gemini_enterprise: {
            project_id: '123',
            location: 'eu',
            engine_id: 'eu-app',
            endpoint: enterpriseRegionEndpoint('eu'),
            resource_edit_supported: true,
          },
        },
      ],
    }).files[0];
    expect(normalized.geminiEnterprise).toMatchObject({
      location: 'eu',
      resourceEditSupported: true,
      endpoint: enterpriseRegionEndpoint('eu'),
    });
    expect(enterpriseQuotaKey(normalized)).not.toBe(enterpriseQuotaKey(file));
    const older = normalizeAuthFilesResponse({
      files: [{ name: 'older.json', gemini_enterprise: { location: 'global' } }],
    }).files[0];
    expect(older.geminiEnterprise?.resourceEditSupported).toBeUndefined();
  });

  test('saves only fixed public resource fields with an expected binding and exact identity', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue(saved);
    const resources = {
      ...expected,
      location: 'us',
      engineId: 'us-app',
      access_token: 'do-not-send',
    };
    const signal = new AbortController().signal;
    try {
      await geminiEnterpriseApi.updateResources(file, resources, expected, signal);
      expect(patch).toHaveBeenCalledWith(
        '/credentials/gemini-enterprise/resources',
        {
          name: file.name,
          auth_index: file.authIndex,
          expected: serializeEnterpriseResources(expected),
          resources: serializeEnterpriseResources(resources),
        },
        { signal }
      );
      expect(JSON.stringify(patch.mock.calls)).not.toContain('do-not-send');
      expect(JSON.stringify(patch.mock.calls)).not.toContain('never-display-token');
    } finally {
      patch.mockRestore();
    }
  });

  test('rejects invalid server responses and does not hide conflicts', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue('<html>wrong address</html>');
    try {
      await expect(
        geminiEnterpriseApi.updateResources(file, expected, expected)
      ).rejects.toBeInstanceOf(InvalidManagementResponseError);
      patch.mockRejectedValue({ status: 409, apiCode: 'credential_changed', message: 'reload' });
      await expect(
        geminiEnterpriseApi.updateResources(file, expected, expected)
      ).rejects.toMatchObject({ status: 409, apiCode: 'credential_changed' });
    } finally {
      patch.mockRestore();
    }
  });

  test('rejects a response after a connection switch, including ABA switches', async () => {
    const patch = spyOn(apiClient, 'patch').mockImplementation(async () => {
      apiClient.setConfig({ apiBase: 'http://127.0.0.1:19993', managementKey: 'synthetic-b' });
      apiClient.setConfig({ apiBase: 'http://127.0.0.1:19992', managementKey: 'synthetic-a' });
      return saved;
    });
    apiClient.setConfig({ apiBase: 'http://127.0.0.1:19992', managementKey: 'synthetic-a' });
    try {
      await expect(
        geminiEnterpriseApi.updateResources(file, expected, expected)
      ).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      patch.mockRestore();
      apiClient.setConfig({ apiBase: '', managementKey: '' });
    }
  });

  test('does not publish an aborted save', async () => {
    const controller = new AbortController();
    const patch = spyOn(apiClient, 'patch').mockImplementation(async () => {
      controller.abort();
      return saved;
    });
    try {
      await expect(
        geminiEnterpriseApi.updateResources(file, expected, expected, controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      patch.mockRestore();
    }
  });

  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
    test(`renders the credential region control and all instructions in ${locale}`, async () => {
      const translations = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      const i18n = createInstance();
      await i18n.init({ lng: locale, resources: { [locale]: { translation: translations } } });
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(GeminiEnterpriseRegionEditor, { file, disabled: false })
        )
      );
      expect(markup).toContain('aria-haspopup="listbox"');
      expect(markup).toContain(translations.gemini_enterprise.region_endpoint);
      expect(markup).toContain(translations.gemini_enterprise.edit_resources);
      expect(markup).toContain(enterpriseRegionEndpoint('global'));
      expect(markup).not.toContain('never-display-token');
      expect(markup).not.toContain('gemini_enterprise.');
      for (const key of [
        'region_hint',
        'resource_advanced',
        'validate_save',
        'region_validating',
        'region_saved',
        'region_conflict',
        'region_authorization_error',
        'region_sync_error',
        'region_error',
      ]) {
        expect(typeof translations.gemini_enterprise[key]).toBe('string');
        expect(translations.gemini_enterprise[key].length).toBeGreaterThan(0);
      }
    });
  }
});
