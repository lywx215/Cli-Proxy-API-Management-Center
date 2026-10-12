import { describe, expect, test } from 'bun:test';
import {
  buildGeminiDialogPatch,
  buildGeminiKeyDialogPatch,
  getGeminiGroupDialogImpacts,
  buildGeminiModelDrafts,
  maskGeminiImportKey,
  parseGeminiDialogField,
  parseGeminiDialogWeight,
  readGeminiDialogValues,
  readGeminiModelDrafts,
} from '@/features/providers/components/GeminiGroupDialogDraft';

describe('Gemini group dialog drafts', () => {
  test('preserves unknown model metadata, alias identity, and order during a targeted edit', () => {
    const original = [
      {
        name: 'same-upstream',
        alias: 'first',
        thinking: { future: true },
        'display-name': 'First',
      },
      { name: 'same-upstream', alias: 'second', arbitrary: { nested: ['keep'] } },
    ];
    const drafts = readGeminiModelDrafts(original);
    drafts[0].alias = 'renamed';
    expect(buildGeminiModelDrafts(drafts)).toEqual([
      { ...original[0], alias: 'renamed' },
      original[1],
    ]);
    expect(original[0].alias).toBe('first');
  });

  test('rejects duplicate public model names without rejecting shared upstream names', () => {
    expect(() =>
      buildGeminiModelDrafts([
        { name: 'upstream-1', alias: 'PUBLIC', metadata: '{}' },
        { name: 'upstream-2', alias: 'public', metadata: '{}' },
      ])
    ).toThrow();
    expect(() => buildGeminiModelDrafts([{ name: '', alias: 'public', metadata: '{}' }])).toThrow();
    expect(() =>
      buildGeminiModelDrafts([{ name: 'upstream', alias: '', metadata: '[]' }])
    ).toThrow();
  });

  test('only serializes touched fields; retaining models never sends a snapshot copy', () => {
    const original = {
      name: 'group',
      models: [{ name: 'upstream', alias: 'public', future: true }],
      headers: { Untouched: 'keep' },
    };
    const values = readGeminiDialogValues(original);
    values.priority = '12';
    expect(
      buildGeminiDialogPatch(values, ['priority'], 'keep', readGeminiModelDrafts(original.models))
    ).toEqual({ priority: 12 });
    expect(
      buildGeminiDialogPatch(values, ['models'], 'keep', readGeminiModelDrafts(original.models))
    ).toEqual({});
    expect(buildGeminiDialogPatch(values, ['models'], 'catalog', [])).toEqual({ models: [] });
  });

  test('distinguishes explicit clearing from inherited fields and validates JSON formats', () => {
    expect(parseGeminiDialogField('headers', '{}')).toEqual({});
    expect(parseGeminiDialogField('proxy-url', '')).toBe('');
    expect(parseGeminiDialogField('priority', '')).toBeNull();
    expect(parseGeminiDialogField('disable-cooling', 'false')).toBe(false);
    expect(parseGeminiDialogField('request-scoped-errors', '[{"future-rule":true}]')).toEqual([
      { 'future-rule': true },
    ]);
    expect(() => parseGeminiDialogField('headers', '{"invalid":2}')).toThrow();
    expect(() =>
      parseGeminiDialogField('base-url', 'https://user:password@example.invalid')
    ).toThrow();
    expect(() => parseGeminiDialogField('priority', '1.2')).toThrow();
  });

  test('validates credential weights without silently changing non-positive values', () => {
    expect(parseGeminiDialogWeight('')).toBeNull();
    expect(parseGeminiDialogWeight('-1')).toBe(-1);
    expect(parseGeminiDialogWeight('1000000')).toBe(1000000);
    expect(() => parseGeminiDialogWeight('1000001')).toThrow();
    expect(() => parseGeminiDialogWeight('1.5')).toThrow();
  });

  test('keeps inherited resets separate from explicit empty and false overrides', () => {
    const values = readGeminiDialogValues({ priority: 10, headers: { Shared: 'yes' } });
    values.headers = '{}';
    values['disable-cooling'] = 'false';
    const result = buildGeminiKeyDialogPatch({
      values,
      touched: new Set(['priority', 'headers', 'disable-cooling']),
      overrides: new Set(['headers', 'disable-cooling']),
      modelMode: 'keep',
      models: [],
      weight: '2',
      weightTouched: false,
      apiKey: '',
    });
    expect(result).toEqual({
      changes: { headers: {}, 'disable-cooling': false },
      inheritFields: ['priority'],
    });
    expect(result.changes).not.toHaveProperty('weight');
    expect(result.changes).not.toHaveProperty('api-key');
  });

  test.each(['priority', 'request-retry', 'disable-cooling'] as const)(
    'requires an explicit value for a Key %s override rather than silently inheriting',
    (field) => {
      const values = readGeminiDialogValues({});
      const input = {
        values,
        touched: new Set([field]),
        overrides: new Set([field]),
        modelMode: 'keep' as const,
        models: [],
        weight: '',
        weightTouched: false,
        apiKey: '',
      };
      expect(() => buildGeminiKeyDialogPatch(input)).toThrow();
      expect(buildGeminiKeyDialogPatch({ ...input, overrides: new Set() })).toEqual({
        changes: {},
        inheritFields: [field],
      });
      values[field] = field === 'disable-cooling' ? 'false' : '0';
      expect(buildGeminiKeyDialogPatch(input)).toEqual({
        changes: { [field]: field === 'disable-cooling' ? false : 0 },
        inheritFields: [],
      });
    }
  );

  test('still permits group numeric and cooling defaults to be cleared explicitly', () => {
    expect(
      buildGeminiDialogPatch(
        readGeminiDialogValues({}),
        ['priority', 'request-retry', 'disable-cooling'],
        'keep',
        []
      )
    ).toEqual({ priority: null, 'request-retry': null, 'disable-cooling': null });
  });

  test('masks even short import keys completely and never prints full credentials', () => {
    for (const key of ['a', 'short-key', 'fixture-secret-key-long']) {
      expect(maskGeminiImportKey(key)).not.toContain(key);
    }
  });

  test('previews field-specific inheritance across groups including explicit zero and false', () => {
    const groups = [
      {
        name: 'first',
        keys: [{ priority: 0, 'disable-cooling': false, models: [] }, { priority: null }],
      },
      { name: 'second', keys: [{ headers: {}, 'proxy-url': '' }, {}] },
    ];
    expect(
      getGeminiGroupDialogImpacts(groups, [
        'name',
        'base-url',
        'priority',
        'disable-cooling',
        'models',
      ])
    ).toEqual({
      'base-url': { inherited: 4, overridden: 0 },
      priority: { inherited: 3, overridden: 1 },
      'disable-cooling': { inherited: 3, overridden: 1 },
      models: { inherited: 3, overridden: 1 },
    });
  });
});
