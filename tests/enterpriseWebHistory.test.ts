import { afterEach, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { parse } from 'yaml';
import { apiClient } from '@/services/api/client';
import {
  enterpriseWebApi,
  normalizeEnterpriseWebStatus,
  WEB_PREFLIGHT_REASONS,
} from '@/services/api/geminiEnterpriseWeb';
import { verifyEnterpriseWebConfigChange } from '@/features/config/enterpriseWebConfig';
import { EnterpriseWebStatus } from '@/features/authFiles/enterpriseWeb/EnterpriseWebStatus';
import { runVisualConfig } from './helpers/visualConfig';
import { getVisualConfigValidationErrors } from '@/hooks/useVisualConfig';
import en from '@/i18n/locales/en.json';

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});
const raw = {
  enabled: true,
  max_concurrent: 2,
  max_inflight_bytes: 268435456,
  active_requests: 0,
  inflight_bytes: 0,
  history_mode: 'serialized-context',
  supported_history_modes: ['single-turn', 'serialized-context'],
  preflight_rejections: { invalid_history: 3, 'synthetic-secret': 9 },
};
const before = 'config-version: 8\nupstream:\n  gemini-enterprise-web:\n    enabled: true\n';
const after = before + '    history-mode: serialized-context\n';
function mockStatus(value: unknown = raw) {
  const get = spyOn(apiClient, 'get').mockResolvedValue(value);
  restores.push(() => get.mockRestore());
  return get;
}

test('history mode round trips without adding unrelated defaults or Enterprise settings', () => {
  const defaults = runVisualConfig(before);
  expect(defaults.visualValues.geminiEnterpriseWebHistoryMode).toBe('single-turn');
  const unrelated = runVisualConfig(before, [{ debug: true }]);
  expect(
    parse(unrelated.applyVisualChangesToYaml(before)).upstream['gemini-enterprise-web']
  ).toEqual({ enabled: true });
  const changed = runVisualConfig(before, [
    { geminiEnterpriseWebHistoryMode: 'serialized-context' },
  ]);
  const saved = parse(changed.applyVisualChangesToYaml(before));
  expect(saved.upstream['gemini-enterprise-web']['history-mode']).toBe('serialized-context');
  expect(saved.upstream['gemini-enterprise']).toBeUndefined();
  expect(
    getVisualConfigValidationErrors(
      runVisualConfig(after, [{ geminiEnterpriseWebHistoryMode: 'invalid' }]).visualValues
    ).geminiEnterpriseWebHistoryMode
  ).toBeDefined();
});

test('status drops unknown reasons and supports an older backend without disabling Web', () => {
  const value = normalizeEnterpriseWebStatus(raw);
  expect(value.historyMode).toBe('serialized-context');
  expect(value.preflightRejections).toEqual({ invalid_history: 3 });
  const old = normalizeEnterpriseWebStatus({
    ...raw,
    history_mode: undefined,
    supported_history_modes: undefined,
    preflight_rejections: undefined,
  });
  expect(old.enabled).toBe(true);
  expect(old.historyMode).toBeUndefined();
  expect(old.supportedHistoryModes).toEqual([]);
});

test('configuration confirmation reads actual runtime and skips unrelated saves', async () => {
  const get = mockStatus();
  await verifyEnterpriseWebConfigChange(
    before,
    before + 'observability: {logs: {debug: true}}\n',
    'after'
  );
  expect(get).not.toHaveBeenCalled();
  await verifyEnterpriseWebConfigChange(before, after, 'before');
  await verifyEnterpriseWebConfigChange(before, after, 'after');
  get.mockResolvedValue({ ...raw, history_mode: 'single-turn' });
  await expect(verifyEnterpriseWebConfigChange(before, after, 'after')).rejects.toMatchObject({
    code: 'settings_not_effective',
  });
  get.mockResolvedValue({ ...raw, history_mode: undefined, supported_history_modes: undefined });
  await expect(verifyEnterpriseWebConfigChange(before, after, 'before')).rejects.toMatchObject({
    code: 'history_unsupported',
  });
});

test('API settings preserve omitted history mode and reject unsupported or unconfirmed writes', async () => {
  const get = mockStatus();
  const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
  restores.push(() => patch.mockRestore());
  const settings = { enabled: true, maxConcurrent: 2, maxInflightBytes: 268435456 };
  await enterpriseWebApi.saveSettings(settings);
  expect(patch.mock.calls[0][1]).not.toHaveProperty('history-mode');
  await enterpriseWebApi.saveSettings({ ...settings, historyMode: 'serialized-context' });
  expect(patch.mock.calls[1][1]).toHaveProperty('history-mode', 'serialized-context');
  get.mockResolvedValue({ ...raw, history_mode: 'single-turn' });
  await expect(
    enterpriseWebApi.saveSettings({ ...settings, historyMode: 'serialized-context' })
  ).rejects.toMatchObject({ code: 'settings_not_effective' });
  get.mockResolvedValue({ ...raw, history_mode: undefined, supported_history_modes: undefined });
  const count = patch.mock.calls.length;
  await expect(
    enterpriseWebApi.saveSettings({ ...settings, historyMode: 'serialized-context' })
  ).rejects.toMatchObject({ code: 'history_unsupported' });
  expect(patch.mock.calls.length).toBe(count);
});

test('connection changes invalidate delayed history confirmation', async () => {
  const revision = spyOn(apiClient, 'getConnectionRevision').mockReturnValue(10);
  restores.push(() => revision.mockRestore());
  let finish!: (value: unknown) => void;
  const get = spyOn(apiClient, 'get').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  restores.push(() => get.mockRestore());
  const pending = verifyEnterpriseWebConfigChange(before, after, 'after');
  revision.mockReturnValue(11);
  finish(raw);
  await expect(pending).rejects.toThrow();
});

test('actual mode and rejection reasons are visible and disappear when runtime is unknown', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  const render = (error: boolean) =>
    renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(EnterpriseWebStatus, { status: normalizeEnterpriseWebStatus(raw), error })
      )
    );
  expect(render(false)).toContain(en.enterprise_web.history_serialized);
  expect(render(false)).toContain('Invalid history 3');
  expect(render(false)).not.toContain('synthetic-secret');
  expect(render(true)).not.toContain(en.enterprise_web.history_serialized);
  for (const language of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
    const locale = JSON.parse(
      readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8')
    );
    for (const reason of WEB_PREFLIGHT_REASONS)
      expect(locale.enterprise_web.preflight_reasons[reason].length).toBeGreaterThan(0);
  }
});
