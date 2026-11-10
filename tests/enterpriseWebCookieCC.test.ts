import { afterEach, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { parse } from 'yaml';
import { apiClient } from '@/services/api/client';
import {
  normalizeEnterpriseWebStatus,
  normalizeEnterpriseWebSummary,
} from '@/services/api/geminiEnterpriseWeb';
import { verifyEnterpriseWebConfigChange } from '@/features/config/enterpriseWebConfig';
import { EnterpriseWebCredentialStatus } from '@/features/authFiles/enterpriseWeb/EnterpriseWebCredentialStatus';
import { runVisualConfig } from './helpers/visualConfig';
import en from '@/i18n/locales/en.json';

const before = 'config-version: 8\nupstream:\n  gemini-enterprise-web:\n    enabled: true\n';
const on = before + '    cookie-cc-polling-enabled: true\n';
const off = before + '    cookie-cc-polling-enabled: false\n';
const raw = {
  enabled: true,
  max_concurrent: 2,
  max_inflight_bytes: 268435456,
  active_requests: 0,
  inflight_bytes: 0,
};
const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});

test('CC switch round trips an explicit false without inserting defaults on unrelated saves', () => {
  expect(runVisualConfig(before).visualValues.geminiEnterpriseWebCookieCCPollingEnabled).toBe(
    false
  );
  const unrelated = runVisualConfig(before, [{ debug: true }]);
  expect(
    parse(unrelated.applyVisualChangesToYaml(before)).upstream['gemini-enterprise-web']
  ).toEqual({
    enabled: true,
  });
  const changed = runVisualConfig(on, [{ geminiEnterpriseWebCookieCCPollingEnabled: false }]);
  expect(parse(changed.applyVisualChangesToYaml(on)).upstream['gemini-enterprise-web']).toEqual({
    enabled: true,
    'cookie-cc-polling-enabled': false,
  });
});

test('CC saves require backend support and confirmation of the actual false state', async () => {
  expect(normalizeEnterpriseWebStatus(raw).cookieCCPollingEnabled).toBeUndefined();
  expect(
    normalizeEnterpriseWebStatus({ ...raw, cookie_cc_polling_enabled: false })
      .cookieCCPollingEnabled
  ).toBe(false);
  const get = spyOn(apiClient, 'get').mockResolvedValue(raw);
  restores.push(() => get.mockRestore());
  await verifyEnterpriseWebConfigChange(on, on + 'logging: {}\n', 'before');
  expect(get).not.toHaveBeenCalled();
  await expect(verifyEnterpriseWebConfigChange(before, on, 'before')).rejects.toMatchObject({
    code: 'cc_polling_unsupported',
  });
  get.mockResolvedValue({ ...raw, cookie_cc_polling_enabled: true });
  await expect(verifyEnterpriseWebConfigChange(on, off, 'after')).rejects.toMatchObject({
    code: 'settings_not_effective',
  });
  get.mockResolvedValue({ ...raw, cookie_cc_polling_enabled: false });
  await verifyEnterpriseWebConfigChange(on, off, 'after');
  await expect(
    verifyEnterpriseWebConfigChange(before, off.replace('false', '"false"'), 'before')
  ).rejects.toMatchObject({
    code: 'cc_polling_invalid',
  });
});

test('CC health and authenticated Plus are displayed independently using only sanitized fields', async () => {
  const summary = normalizeEnterpriseWebSummary({
    cookie_check_status: 'verified',
    cookie_cc_check: {
      status: 'retrying',
      reason: 'candidate_rejected',
      last_checked_at: '2026-11-10T04:00:00Z',
      next_check_at: '2026-11-10T04:05:00Z',
      last_renewed_at: '2026-11-10T03:59:00Z',
      cookie: 'synthetic-secret',
    },
  });
  expect(summary?.cookieCCCheck).toEqual({
    status: 'retrying',
    reason: 'candidate_rejected',
    lastCheckedAt: '2026-11-10T04:00:00Z',
    nextCheckAt: '2026-11-10T04:05:00Z',
    lastRenewedAt: '2026-11-10T03:59:00Z',
  });
  expect(
    normalizeEnterpriseWebSummary({ cookie_cc_check: { status: 'arbitrary' } })?.cookieCCCheck
  ).toBeUndefined();
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(EnterpriseWebCredentialStatus, { summary })
    )
  );
  expect(html).toContain(en.enterprise_web.auth_verified);
  expect(html).toContain(en.enterprise_web.cc_statuses.retrying);
  expect(html).toContain(en.enterprise_web.cc_reasons.candidate_rejected);
  expect(html).not.toContain('synthetic-secret');
});

test('conflict reload reads the scoped summary and only replaces the draft revision', () => {
  const dialog = readFileSync(
    new URL(
      '../src/features/authFiles/enterpriseWeb/EnterpriseWebCredentialDialog.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const reload = dialog.slice(
    dialog.indexOf('const reloadRevision'),
    dialog.indexOf('const patchEdit')
  );
  expect(reload).toContain('authFilesApi.list({');
  expect(reload).toContain('...prior, expectedRevision: latest.revision');
  expect(reload).toContain('if (!isCurrent()) return');
  expect(reload).not.toContain('saveCredential(');
  expect(dialog).toContain('getStatusFromError(failure) === 409');
});
