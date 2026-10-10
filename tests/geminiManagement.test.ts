import { describe, expect, test } from 'bun:test';
import {
  filterGeminiResources,
  geminiResourcesFromSnapshot,
  geminiTargetId,
  getGeminiAliasDraftSignature,
  getGeminiModelSource,
  getGeminiTarget,
  normalizeGeminiAliasDraft,
  paginateGeminiResources,
  selectGeminiTargets,
  toGeminiGroupTargets,
  validateGeminiAliasDraft,
} from '../src/features/providers/geminiManagement';
import type { GeminiSnapshot } from '../src/services/api/geminiManagement';

function snapshot(groups: Record<string, unknown>[]): GeminiSnapshot {
  return {
    revision: 'fixture-revision',
    groups,
    aliases: [{ name: 'upstream', alias: 'global-client', fork: true }],
    capabilities: { aliases: true, batch: true, migration: true },
  };
}

describe('Gemini management selection and pagination', () => {
  test('flattens canonical groups without losing raw inheritance, sibling or unknown fields', () => {
    const groups = [
      {
        name: 'one',
        priority: 8,
        models: [{ name: 'upstream', alias: 'group-alias', future: true }],
        future: { preserved: true },
        keys: [
          { 'api-key': 'same-fixture', models: null, custom: 'keep' },
          { 'api-key': 'same-fixture', priority: 0, models: [] },
        ],
      },
      { name: 'empty', keys: [] },
      { name: 'two', keys: [{ 'api-key': 'same-fixture' }] },
    ];
    const before = structuredClone(groups);
    const resources = geminiResourcesFromSnapshot(snapshot(groups));

    expect(resources).toHaveLength(3);
    expect(resources.map(getGeminiTarget)).toEqual([
      { groupIndex: 0, keyIndex: 0 },
      { groupIndex: 0, keyIndex: 1 },
      { groupIndex: 2, keyIndex: 0 },
    ]);
    expect(resources.map((resource) => resource.priority)).toEqual([8, 0, 0]);
    expect(resources.map((resource) => resource.modelCount)).toEqual([1, 0, 0]);
    expect(resources[0].raw).toMatchObject({
      source: { groupIndex: 0, keyIndex: 0, group: groups[0], groups },
    });
    expect(groups).toEqual(before);
  });

  test('filters by canonical group index and effective enabled state', () => {
    const resources = geminiResourcesFromSnapshot(
      snapshot([
        {
          name: 'same-name',
          'excluded-models': ['*'],
          keys: [{ 'api-key': 'fixture-a' }, { 'api-key': 'fixture-b', 'excluded-models': [] }],
        },
        { name: 'same-name', keys: [{ 'api-key': 'fixture-c', 'excluded-models': ['*'] }] },
      ])
    );
    expect(filterGeminiResources(resources, '', 'all')).toEqual(resources);
    expect(filterGeminiResources(resources, '', 'enabled')).toEqual([resources[1]]);
    expect(filterGeminiResources(resources, '', 'disabled')).toEqual([resources[0], resources[2]]);
    expect(filterGeminiResources(resources, '0', 'all')).toEqual(resources.slice(0, 2));
    expect(filterGeminiResources(resources, '1', 'disabled')).toEqual([resources[2]]);
    expect(filterGeminiResources(resources, 'missing', 'all')).toEqual([]);
  });

  test.each([25, 50, 100])('paginates %s rows and clamps out-of-range pages', (pageSize) => {
    const items = Array.from({ length: 107 }, (_, index) => index);
    const expectedPages = Math.ceil(items.length / pageSize);
    expect(paginateGeminiResources(items, 1, pageSize)).toEqual({
      currentPage: 1,
      totalPages: expectedPages,
      pageItems: items.slice(0, pageSize),
    });
    expect(paginateGeminiResources(items, 2, pageSize).pageItems).toEqual(
      items.slice(pageSize, pageSize * 2)
    );
    expect(paginateGeminiResources(items, 999, pageSize)).toEqual({
      currentPage: expectedPages,
      totalPages: expectedPages,
      pageItems: items.slice((expectedPages - 1) * pageSize),
    });
    expect(paginateGeminiResources(items, -1, pageSize).currentPage).toBe(1);
    expect(paginateGeminiResources([], 5, pageSize)).toEqual({
      currentPage: 1,
      totalPages: 1,
      pageItems: [],
    });
  });

  test('keeps cross-page selections distinct when credentials repeat within and across groups', () => {
    const resources = geminiResourcesFromSnapshot(
      snapshot([
        {
          name: 'one',
          keys: Array.from({ length: 27 }, () => ({ 'api-key': 'same-fixture' })),
        },
        { name: 'two', keys: [{ 'api-key': 'same-fixture' }] },
      ])
    );
    const firstPage = paginateGeminiResources(resources, 1, 25).pageItems;
    const secondPage = paginateGeminiResources(resources, 2, 25).pageItems;
    const selected = new Set([
      geminiTargetId(getGeminiTarget(firstPage[0])!),
      geminiTargetId(getGeminiTarget(secondPage[0])!),
      geminiTargetId(getGeminiTarget(secondPage[2])!),
    ]);
    expect(selectGeminiTargets(selected, resources)).toEqual([
      { groupIndex: 0, keyIndex: 0 },
      { groupIndex: 0, keyIndex: 25 },
      { groupIndex: 1, keyIndex: 0 },
    ]);
    expect(toGeminiGroupTargets(selectGeminiTargets(selected, resources))).toEqual([
      { groupIndex: 0 },
      { groupIndex: 1 },
    ]);
    expect(selectGeminiTargets(new Set(['99:0']), resources)).toEqual([]);
    expect(geminiTargetId({ groupIndex: 0, keyIndex: 0 })).toBe('0:0');
    expect(geminiTargetId({ groupIndex: 0 })).toBe('0:group');
  });

  test('ignores resources without a canonical Key source', () => {
    const resource = geminiResourcesFromSnapshot(
      snapshot([{ name: 'one', keys: [{ 'api-key': 'fixture' }] }])
    )[0];
    const missingSource = { ...resource, raw: { apiKey: 'fixture' } };
    const groupSource = { ...resource, raw: { source: { groupIndex: 0, group: { keys: [] } } } };
    expect(getGeminiTarget(missingSource)).toBeNull();
    expect(getGeminiTarget(groupSource)).toBeNull();
    expect(selectGeminiTargets(new Set(['0:group', '0:0']), [missingSource, groupSource])).toEqual(
      []
    );
  });

  test('reports null and omitted model fields as inheritance but empty arrays as Key overrides', () => {
    const resources = geminiResourcesFromSnapshot(
      snapshot([
        {
          name: 'inherited',
          models: [{ name: 'group-model' }],
          keys: [
            { 'api-key': 'fixture-a', models: null },
            { 'api-key': 'fixture-b' },
            { 'api-key': 'fixture-c', models: [] },
            { 'api-key': 'fixture-d', models: [{ name: 'key-model' }] },
          ],
        },
        {
          name: 'catalog',
          keys: [{ 'api-key': 'fixture-e', models: null }, { 'api-key': 'fixture-f' }],
        },
        { name: 'empty-group-policy', models: [], keys: [{ 'api-key': 'fixture-g' }] },
      ])
    );
    expect(resources.map(getGeminiModelSource)).toEqual([
      'group',
      'group',
      'key',
      'key',
      'catalog',
      'catalog',
      'group',
    ]);
  });
});

describe('Gemini unified alias drafts', () => {
  test('ignores fully blank draft rows but rejects partial mappings', () => {
    expect(
      validateGeminiAliasDraft([
        { name: '', alias: '', fork: true },
        { name: '  ', alias: '  ', fork: true },
        { name: ' upstream ', alias: ' client ', fork: true },
      ])
    ).toBeNull();
    expect(validateGeminiAliasDraft([{ name: 'upstream', alias: '  ' }])).toBe('incomplete');
    expect(validateGeminiAliasDraft([{ name: '  ', alias: 'client' }])).toBe('incomplete');
  });

  test('rejects aliases differing only in whitespace or case, allowing repeated upstream names', () => {
    expect(
      validateGeminiAliasDraft([
        { name: 'first-model', alias: ' Client-A ' },
        { name: 'second-model', alias: 'client-a' },
      ])
    ).toBe('duplicate');
    expect(
      validateGeminiAliasDraft([
        { name: 'same-model', alias: 'client-a' },
        { name: 'same-model', alias: 'client-b' },
      ])
    ).toBeNull();
  });

  test('normalizes editable names while preserving hidden alias metadata and explicit false', () => {
    const rules = [
      { name: '', alias: '', fork: true },
      {
        name: ' upstream ',
        alias: ' client ',
        fork: false,
        'display-name': 'Display',
        'force-mapping': true,
        image: true,
        thinking: { levels: ['medium'] },
        future: { preserve: 'exactly' },
      },
    ];
    const before = structuredClone(rules);
    expect(normalizeGeminiAliasDraft(rules)).toEqual([
      { ...rules[1], name: 'upstream', alias: 'client' },
    ]);
    expect(rules).toEqual(before);
  });

  test('draft signatures ignore the default blank row and retain meaningful hidden changes', () => {
    const baseline = [{ name: 'upstream', alias: 'client', future: 'keep' }];
    expect(getGeminiAliasDraftSignature([...baseline, { name: '', alias: '', fork: true }])).toBe(
      getGeminiAliasDraftSignature(baseline)
    );
    expect(getGeminiAliasDraftSignature([{ ...baseline[0], fork: false }])).toBe(
      getGeminiAliasDraftSignature(baseline)
    );
    expect(getGeminiAliasDraftSignature([{ ...baseline[0], fork: true }])).not.toBe(
      getGeminiAliasDraftSignature(baseline)
    );
    expect(getGeminiAliasDraftSignature([{ ...baseline[0], future: 'changed' }])).not.toBe(
      getGeminiAliasDraftSignature(baseline)
    );
  });
});
