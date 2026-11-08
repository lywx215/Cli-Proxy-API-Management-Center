import { afterEach, expect, spyOn, test } from 'bun:test';
import { parse } from 'yaml';
import { apiClient } from '@/services/api/client';
import { normalizeWebInputLimits } from '@/services/api/enterpriseWebInputLimits';
import { normalizeEnterpriseWebStatus } from '@/services/api/geminiEnterpriseWeb';
import { verifyEnterpriseWebConfigChange } from '@/features/config/enterpriseWebConfig';
import { runVisualConfig } from './helpers/visualConfig';

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});
const defaults = normalizeWebInputLimits({}, true)!;
const status = {
  enabled: true,
  max_concurrent: 2,
  max_inflight_bytes: 268435456,
  active_requests: 0,
  inflight_bytes: 0,
  input_limits: defaults,
};
const before = 'config-version: 8\nupstream:\n  gemini-enterprise-web:\n    enabled: true\n';
const after = before + '    input-limits:\n      max-contents: 70\n';
function mockStatus(value: unknown = status) {
  const get = spyOn(apiClient, 'get').mockResolvedValue(value);
  restores.push(() => get.mockRestore());
  return get;
}

test('input limits normalize explicit runtime values without inventing old backend support', () => {
  expect(defaults['max-contents']).toBe(50);
  expect(defaults['max-text-bytes']).toBe(4 * 1048576);
  expect(defaults['max-attachments']).toBe(12);
  expect(normalizeEnterpriseWebStatus(status).inputLimits).toEqual(defaults);
  expect(
    normalizeEnterpriseWebStatus({ ...status, input_limits: undefined }).inputLimits
  ).toBeUndefined();
  expect(normalizeWebInputLimits({})).toBeUndefined();
  expect(normalizeWebInputLimits({ 'max-contents': 0 }, true)).toEqual(defaults);
  expect(normalizeWebInputLimits({ ...defaults, 'max-contents': 0 })).toBeUndefined();
  expect(normalizeWebInputLimits({ ...defaults, 'max-contents': 1.5 })).toBeUndefined();
  expect(normalizeWebInputLimits({ ...defaults, 'max-attachments': 129 })).toBeUndefined();
  expect(normalizeWebInputLimits({ ...defaults, 'max-tool-array-entries': 65536 })).toBeDefined();
  expect(normalizeWebInputLimits({ ...defaults, 'max-tool-array-entries': 65537 })).toBeUndefined();
  expect(normalizeWebInputLimits({ ...defaults, 'max-segments': 49 })).toBeUndefined();
});

test('input limit saves require runtime support before write and actual values after write', async () => {
  const get = mockStatus();
  await verifyEnterpriseWebConfigChange(before, after, 'before');
  await expect(verifyEnterpriseWebConfigChange(before, after, 'after')).rejects.toMatchObject({
    code: 'settings_not_effective',
  });
  get.mockResolvedValue({ ...status, input_limits: { ...defaults, 'max-contents': 70 } });
  await verifyEnterpriseWebConfigChange(before, after, 'after');
  get.mockResolvedValue({ ...status, input_limits: undefined });
  await expect(verifyEnterpriseWebConfigChange(before, after, 'before')).rejects.toMatchObject({
    code: 'input_limits_unsupported',
  });
  // Existing settings remain usable against a backend without input-limit support.
  await verifyEnterpriseWebConfigChange(before, before + '    max-concurrent: 2\n', 'after');
});

test('removing configured input limits confirms backend defaults, including zero values', async () => {
  mockStatus();
  await verifyEnterpriseWebConfigChange(after, before, 'after');
  await verifyEnterpriseWebConfigChange(
    after,
    before + '    input-limits: {max-contents: 0}\n',
    'after'
  );
});

test('invalid limits fail without status requests and unrelated saves do not add a dependency', async () => {
  const get = mockStatus();
  for (const value of ['-1', '1.5', '10001', '"70"']) {
    await expect(
      verifyEnterpriseWebConfigChange(
        before,
        before + `    input-limits: {max-contents: ${value}}\n`,
        'before'
      )
    ).rejects.toMatchObject({ code: 'invalid_input_limits' });
  }
  const ordered = before + '    input-limits: {max-contents: 70, max-attachments: 20}\n';
  const reordered = before + '    input-limits: {max-attachments: 20, max-contents: 70}\n';
  await verifyEnterpriseWebConfigChange(ordered, reordered, 'after');
  await verifyEnterpriseWebConfigChange(
    after,
    after + 'observability: {logs: {debug: true}}\n',
    'after'
  );
  expect(get).not.toHaveBeenCalled();
});

test('connection changes invalidate delayed input-limit confirmation', async () => {
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
  finish({ ...status, input_limits: { ...defaults, 'max-contents': 70 } });
  await expect(pending).rejects.toThrow();
});

test('visual Web edits preserve configured input limits and unrelated provider settings', () => {
  const yaml = `config-version: 8
upstream:
  gemini-enterprise:
    client-id: synthetic-client
  gemini-enterprise-web:
    enabled: true
    history-mode: serialized-context
    input-limits:
      max-contents: 70
      max-text-bytes: 8388608
      max-attachments: 20
      max-json-object-fields: 512
`;
  const source = parse(yaml);
  const config = runVisualConfig(yaml, [
    { debug: true },
    { geminiEnterpriseWebMaxConcurrent: '3' },
  ]);
  const saved = parse(config.applyVisualChangesToYaml(yaml));
  expect(saved.upstream['gemini-enterprise-web']['input-limits']).toEqual(
    source.upstream['gemini-enterprise-web']['input-limits']
  );
  expect(saved.upstream['gemini-enterprise']).toEqual(source.upstream['gemini-enterprise']);
  expect(saved.upstream['gemini-enterprise-web']['max-concurrent']).toBe(3);
});
