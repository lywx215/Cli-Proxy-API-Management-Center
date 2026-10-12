import { describe, expect, test } from 'bun:test';
import {
  GEMINI_SHARED_FIELDS,
  MAX_GEMINI_IMPORT_KEYS,
  appendGeminiKeys,
  findGeminiMergeCandidates,
  geminiCredentialFingerprint,
  getGeminiEffectiveKey,
  getGeminiGroupKeys,
  getGeminiMergeDiagnostics,
  getGeminiOverrideFields,
  mergeGeminiGroups,
  parseGeminiKeyImport,
  patchGeminiGroups,
  patchGeminiKey,
  rebaseGeminiTargets,
  restoreGeminiInheritance,
  type GeminiGroups,
} from '../src/features/providers/geminiGroups';

const model = { name: 'gemini-upstream', alias: 'gemini-client', thinking: { levels: ['medium'] } };
const fixture = (): GeminiGroups => [
  {
    name: 'first',
    'base-url': 'https://example.invalid',
    models: [model],
    headers: { A: 'fixture', 'auth-index': 'keep-header' },
    priority: 0,
    future: { preserved: true },
    keys: [
      { 'api-key': 'fixture-a', name: 'alpha', models: null, 'auth-index': 'read-only', custom: 1 },
      {
        'api-key': 'fixture-b',
        models: [],
        headers: {},
        weight: 3,
        custom: [null, { keep: true }],
      },
    ],
  },
  { name: 'second', 'base-url': 'https://other.invalid', keys: [{ 'api-key': 'fixture-cross' }] },
];

const mergeGroups = (): GeminiGroups =>
  ['a', 'b', 'c'].map((suffix) => ({
    name: `group-${suffix}`,
    'base-url': 'https://same.invalid',
    models: [
      {
        ...model,
        'display-name': 'Visible model',
        'max-context-length': 100000,
        'force-mapping': true,
        'is-compat': false,
        thinking: {
          min: 0,
          max: 2048,
          'zero-allowed': true,
          'dynamic-allowed': true,
          levels: ['medium'],
        },
      },
    ],
    headers: { Z: 'last', A: 'first', 'auth-index': 'business-header' },
    'request-scoped-errors': [
      { status: 400, match: ['invalid'], 'match-regexr': ['bad.*'], action: 'stop' },
    ],
    keys: [{ 'api-key': `fixture-${suffix}`, models: null, priority: 0, weight: 2 }],
  }));

describe('Gemini group inheritance and mutations', () => {
  test('distinguishes inherited null from empty arrays, objects and zero overrides', () => {
    const groups = fixture();
    const [inherited, overridden] = getGeminiGroupKeys(groups[0]);
    expect(getGeminiEffectiveKey(groups[0], inherited).models).toEqual([model]);
    expect(getGeminiEffectiveKey(groups[0], overridden)).toMatchObject({ models: [], headers: {} });
    expect(getGeminiOverrideFields({ models: null, headers: {}, priority: 0, weight: 4 })).toEqual([
      'priority',
      'headers',
    ]);
    expect(GEMINI_SHARED_FIELDS).not.toContain('weight');
    expect(GEMINI_SHARED_FIELDS).not.toContain('base-url');
  });

  test.each([100, 1000])(
    'imports %s arbitrary-prefix keys with only api-key on new rows',
    (count) => {
      const groups = fixture();
      const before = structuredClone(groups);
      const input = Array.from({ length: count }, (_, index) => `vendor-${index}`).join('\n');
      const parsed = parseGeminiKeyImport(input, groups, 0);
      expect(parsed.tooMany).toBe(false);
      expect(parsed.keys).toHaveLength(count);
      const next = appendGeminiKeys(groups, 0, parsed.keys);
      expect(getGeminiGroupKeys(next[0])).toHaveLength(count + 2);
      expect(
        getGeminiGroupKeys(next[0])
          .slice(2)
          .every((key) => Object.keys(key).length === 1)
      ).toBe(true);
      expect(groups).toEqual(before);
      expect(next[0].future).toEqual(before[0].future);
    }
  );

  test('counts duplicates, cross-group keys and original invalid line numbers after trimming', () => {
    const parsed = parseGeminiKeyImport(
      '\n fixture-a \r\n vendor-new \nfixture-cross\nfixture-cross\nbad key\n\t\nother\tkey',
      fixture(),
      0
    );
    expect(parsed).toEqual({
      keys: ['vendor-new', 'fixture-cross'],
      duplicateCount: 2,
      crossGroupCount: 1,
      invalidLines: [6, 8],
      tooMany: false,
    });
  });

  test('limits nonempty lines, even if duplicate, while ignoring empty lines', () => {
    expect(MAX_GEMINI_IMPORT_KEYS).toBe(1000);
    expect(parseGeminiKeyImport('same\n'.repeat(1001), fixture(), 0).tooMany).toBe(true);
    expect(parseGeminiKeyImport('\n'.repeat(1500) + 'fixture-new', fixture(), 0).tooMany).toBe(
      false
    );
    expect(() =>
      appendGeminiKeys(
        fixture(),
        0,
        Array.from({ length: 1001 }, (_, i) => `k-${i}`)
      )
    ).toThrow();
  });

  test('allows existing cross-group credentials without changing existing duplicates', () => {
    const groups: GeminiGroups = [
      { name: 'first', keys: [] },
      { name: 'other', keys: [{ 'api-key': 'fixture-cross', metadata: 'keep' }] },
    ];
    const next = appendGeminiKeys(groups, 0, ['fixture-cross']);
    expect(next[0].keys).toEqual([{ 'api-key': 'fixture-cross' }]);
    expect(next[1]).toEqual(groups[1]);
  });

  test('patches only selected fields and restores selected inheritance without flattening', () => {
    const groups = fixture();
    const before = structuredClone(groups);
    const changed = patchGeminiGroups(groups, [0], {
      models: [{ name: 'new', alias: 'new-alias' }],
    });
    expect(changed[0].keys).toEqual(groups[0].keys);
    expect(changed[0].future).toEqual(groups[0].future);
    const keyChanged = patchGeminiKey(changed, { groupIndex: 0, keyIndex: 1 }, { priority: 0 }, [
      'models',
    ]);
    expect(getGeminiGroupKeys(keyChanged[0])[1]).toMatchObject({
      headers: {},
      weight: 3,
      priority: 0,
    });
    expect(getGeminiGroupKeys(keyChanged[0])[1]).not.toHaveProperty('models');
    const restored = restoreGeminiInheritance(keyChanged, [{ groupIndex: 0 }], ['headers']);
    expect(getGeminiGroupKeys(restored[0])[1]).not.toHaveProperty('headers');
    expect(getGeminiGroupKeys(restored[0])[1].custom).toEqual([null, { keep: true }]);
    expect(restored[0].headers).toEqual(groups[0].headers);
    expect(groups).toEqual(before);
  });

  test('rejects a bad last target, invalid fields and imports without mutating input', () => {
    const groups = fixture();
    const before = structuredClone(groups);
    expect(() => patchGeminiGroups(groups, [0, 99], { priority: 1 })).toThrow();
    expect(() =>
      restoreGeminiInheritance(groups, [{ groupIndex: 0 }, { groupIndex: 9 }], ['models'])
    ).toThrow();
    expect(() => patchGeminiKey(groups, { groupIndex: 0, keyIndex: -1 }, {}, [])).toThrow();
    expect(() => patchGeminiGroups(groups, [0], { keys: [] })).toThrow();
    expect(() => restoreGeminiInheritance(groups, [{ groupIndex: 0 }], ['weight'])).toThrow();
    expect(() => appendGeminiKeys(groups, 0, ['fixture-a'])).toThrow();
    expect(() => appendGeminiKeys(groups, 0, ['ok', 'bad key'])).toThrow();
    expect(groups).toEqual(before);
  });

  test('replaces a single Key with the import trimming rules and preserves unrelated metadata', () => {
    const groups = fixture();
    const before = structuredClone(groups);
    const changes = { 'api-key': '  arbitrary-vendor-key  ', priority: 2 };
    const next = patchGeminiKey(groups, { groupIndex: 0, keyIndex: 0 }, changes);
    expect(getGeminiGroupKeys(next[0])[0]).toEqual({
      ...getGeminiGroupKeys(before[0])[0],
      'api-key': 'arbitrary-vendor-key',
      priority: 2,
    });
    expect(getGeminiGroupKeys(next[0])[1]).toEqual(getGeminiGroupKeys(before[0])[1]);
    expect(next[1]).toEqual(before[1]);
    expect(groups).toEqual(before);
    expect(changes['api-key']).toBe('  arbitrary-vendor-key  ');
  });

  test.each([null, 123, {}, '', '   ', 'bad key', 'bad\tkey', 'bad\nkey'])(
    'rejects invalid Key replacement %# before changing any data',
    (value) => {
      const groups = fixture();
      const before = structuredClone(groups);
      expect(() =>
        patchGeminiKey(groups, { groupIndex: 0, keyIndex: 0 }, { 'api-key': value })
      ).toThrow('Invalid Gemini key replacement.');
      expect(groups).toEqual(before);
    }
  );
});

describe('Gemini safe group merging', () => {
  test('retains first name, all raw key metadata and original group/key ordering', () => {
    const groups = mergeGroups();
    const before = structuredClone(groups);
    expect(findGeminiMergeCandidates(groups)).toEqual([
      { groupIndices: [0, 1, 2], keyCount: 3, sourceKeyCounts: [1, 1, 1] },
    ]);
    const next = mergeGeminiGroups(groups, [2, 0]);
    expect(next.map((group) => group.name)).toEqual(['group-a', 'group-b']);
    expect(next[0].keys).toEqual([
      getGeminiGroupKeys(groups[0])[0],
      getGeminiGroupKeys(groups[2])[0],
    ]);
    expect(next[0].models).toEqual(groups[0].models);
    expect(next[0].headers).toEqual(groups[0].headers);
    expect(groups).toEqual(before);
    expect(geminiCredentialFingerprint(next[0], getGeminiGroupKeys(next[0])[1])).toBe(
      geminiCredentialFingerprint(groups[2], getGeminiGroupKeys(groups[2])[0])
    );
    expect(geminiCredentialFingerprint(groups[0], getGeminiGroupKeys(groups[0])[0])).not.toContain(
      'fixture-a'
    );
  });

  test.each(['base', 'missing', 'null', 'unknown', 'model-order', 'key-override'])(
    'refuses differences in %s and leaves the source unchanged',
    (difference) => {
      const groups = mergeGroups().slice(0, 2);
      if (difference === 'base') groups[1]['base-url'] = 'https://different.invalid';
      if (difference === 'missing') delete groups[1].headers;
      if (difference === 'null') groups[1].headers = null;
      if (difference === 'unknown') groups[1].future = { preserved: false };
      if (difference === 'model-order') {
        groups[0].models = [model, { name: 'another', alias: 'another' }];
        groups[1].models = [{ name: 'another', alias: 'another' }, model];
      }
      if (difference === 'key-override') getGeminiGroupKeys(groups[1])[0].models = [];
      const before = structuredClone(groups);
      expect(findGeminiMergeCandidates(groups)).toEqual([]);
      expect(() => mergeGeminiGroups(groups, [0, 1])).toThrow();
      expect(groups).toEqual(before);
    }
  );

  test('rejects repeated credentials even outside selected groups; never deletes duplicates', () => {
    const groups = mergeGroups();
    getGeminiGroupKeys(groups[2])[0]['api-key'] = 'fixture-a';
    const before = structuredClone(groups);
    expect(findGeminiMergeCandidates(groups)).toEqual([]);
    expect(() => mergeGeminiGroups(groups, [0, 1])).toThrow('Duplicate Gemini credential identity');
    expect(groups).toEqual(before);
  });

  test('allows different Key identity with distinct explicit headers only if settings agree', () => {
    const groups = mergeGroups().slice(0, 2);
    getGeminiGroupKeys(groups[0])[0].headers = { A: 'same', B: 'same' };
    getGeminiGroupKeys(groups[1])[0].headers = { B: 'same', A: 'same' };
    expect(mergeGeminiGroups(groups, [0, 1])).toHaveLength(1);
  });

  test.each(['group', 'key', 'key-name', 'model', 'thinking', 'error-rule'])(
    'blocks moving unknown %s fields without removing the raw values',
    (location) => {
      const groups = mergeGroups().slice(0, 2);
      let field = '';
      if (location === 'group') {
        groups[1].future = { keep: true };
        field = 'future';
      }
      if (location === 'key') {
        getGeminiGroupKeys(groups[1])[0].metadata = { keep: true };
        field = 'keys[0].metadata';
      }
      if (location === 'key-name') {
        getGeminiGroupKeys(groups[1])[0].name = 'existing-name';
        field = 'keys[0].name';
      }
      if (location === 'model') {
        (groups[1].models as Record<string, unknown>[])[0].future = true;
        field = 'models[0].future';
      }
      if (location === 'thinking') {
        const thinking = (groups[1].models as Record<string, unknown>[])[0].thinking as Record<
          string,
          unknown
        >;
        thinking.future = true;
        field = 'models[0].thinking.future';
      }
      if (location === 'error-rule') {
        (groups[1]['request-scoped-errors'] as Record<string, unknown>[])[0].future = true;
        field = 'request-scoped-errors[0].future';
      }
      const before = structuredClone(groups);
      expect(findGeminiMergeCandidates(groups)).toEqual([]);
      expect(getGeminiMergeDiagnostics(groups)).toContainEqual({
        groupIndex: 1,
        reason: 'unknown-fields',
        fields: [field],
      });
      expect(() => mergeGeminiGroups(groups, [0, 1])).toThrow(
        'Unknown Gemini configuration fields'
      );
      expect(groups).toEqual(before);
    }
  );

  test('rejects merging before a later opaque group whose index would move', () => {
    const groups = mergeGroups();
    groups[2]['base-url'] = 'https://separate.invalid';
    getGeminiGroupKeys(groups[2])[0].custom = 'keep';
    const before = structuredClone(groups);
    expect(findGeminiMergeCandidates(groups)).toEqual([]);
    expect(getGeminiMergeDiagnostics(groups)).toEqual([
      { groupIndex: 0, reason: 'unknown-fields', fields: ['groups[2].keys[0].custom'] },
      { groupIndex: 1, reason: 'unknown-fields', fields: ['groups[2].keys[0].custom'] },
      { groupIndex: 2, reason: 'unknown-fields', fields: ['keys[0].custom'] },
    ]);
    expect(() => mergeGeminiGroups(groups, [0, 1])).toThrow('Unknown Gemini configuration fields');
    expect(groups).toEqual(before);
  });

  test('keeps unrelated opaque groups at their original position while merging later groups', () => {
    const groups = mergeGroups();
    groups[1]['base-url'] = 'https://separate.invalid';
    groups[1].future = { keep: true };
    expect(findGeminiMergeCandidates(groups)).toEqual([
      { groupIndices: [0, 2], keyCount: 2, sourceKeyCounts: [1, 1] },
    ]);
    const next = mergeGeminiGroups(groups, [0, 2]);
    expect(next[1]).toEqual(groups[1]);
    expect(getGeminiMergeDiagnostics(groups)).toEqual([
      { groupIndex: 1, reason: 'unknown-fields', fields: ['future'] },
    ]);
  });

  test('allows supported metadata and strips no nested business headers during merge', () => {
    const groups = mergeGroups().slice(0, 2);
    groups[0].auth_index = 'read-only';
    getGeminiGroupKeys(groups[1])[0]['auth-index'] = 'read-only';
    expect(getGeminiMergeDiagnostics(groups)).toEqual([]);
    const next = mergeGeminiGroups(groups, [0, 1]);
    expect(next[0].models).toEqual(groups[0].models);
    expect(next[0]['request-scoped-errors']).toEqual(groups[0]['request-scoped-errors']);
    expect((next[0].headers as Record<string, unknown>)['auth-index']).toBe('business-header');
    expect(getGeminiGroupKeys(next[0])[1]['auth-index']).toBe('read-only');
  });

  test('explains empty, group defaults, effective Key settings and repeated identities', () => {
    const empty: GeminiGroups = [{ keys: [] }];
    expect(getGeminiMergeDiagnostics(empty)).toEqual([{ groupIndex: 0, reason: 'empty' }]);
    expect(() => mergeGeminiGroups([...mergeGroups().slice(0, 1), ...empty], [0, 1])).toThrow(
      'Empty'
    );
    const different = mergeGroups().slice(0, 2);
    different[1].priority = 3;
    expect(getGeminiMergeDiagnostics(different)).toEqual([
      { groupIndex: 0, reason: 'group-settings' },
      { groupIndex: 1, reason: 'group-settings' },
    ]);
    delete different[1].priority;
    getGeminiGroupKeys(different[1])[0].models = [];
    expect(getGeminiMergeDiagnostics(different)).toEqual([
      { groupIndex: 0, reason: 'key-settings' },
      { groupIndex: 1, reason: 'key-settings' },
    ]);
    const duplicate = mergeGroups().slice(0, 2);
    getGeminiGroupKeys(duplicate[1])[0]['api-key'] = 'fixture-a';
    expect(getGeminiMergeDiagnostics(duplicate)).toEqual([
      { groupIndex: 0, reason: 'duplicate-identity' },
      { groupIndex: 1, reason: 'duplicate-identity' },
    ]);
  });
});

describe('Gemini target rebasing after a revision conflict', () => {
  test('moves indices by unique group name/key multiset, then raw Key/name identity', () => {
    const before = fixture();
    const after = structuredClone([before[1], before[0]]);
    after[1].keys = [...getGeminiGroupKeys(after[1])].reverse();
    after[1].models = [{ name: 'fresh', alias: 'fresh' }];
    expect(
      rebaseGeminiTargets(before, after, [{ groupIndex: 0 }, { groupIndex: 0, keyIndex: 0 }])
    ).toEqual([{ groupIndex: 1 }, { groupIndex: 1, keyIndex: 1 }]);
    expect(after[1].models).toEqual([{ name: 'fresh', alias: 'fresh' }]);
  });

  test('fails closed for changed membership, renamed groups and ambiguous raw Key identities', () => {
    const before = fixture();
    const changed = appendGeminiKeys(before, 0, ['new-key']);
    expect(() => rebaseGeminiTargets(before, changed, [{ groupIndex: 0 }])).toThrow();
    const renamed = structuredClone(before);
    renamed[0].name = 'renamed';
    expect(() => rebaseGeminiTargets(before, renamed, [{ groupIndex: 0 }])).toThrow();
    const duplicate: GeminiGroups = [
      { name: 'same', keys: [{ 'api-key': 'fixture' }, { 'api-key': 'fixture' }] },
    ];
    expect(() =>
      rebaseGeminiTargets(duplicate, duplicate, [{ groupIndex: 0, keyIndex: 0 }])
    ).toThrow();
    expect(() =>
      rebaseGeminiTargets(before, [before[0], before[0]], [{ groupIndex: 0 }])
    ).toThrow();
  });

  test('compares raw key values rather than indexes or normalized credential values', () => {
    const before = fixture();
    const after = structuredClone(before);
    getGeminiGroupKeys(after[0])[0]['api-key'] = ' fixture-a ';
    expect(() => rebaseGeminiTargets(before, after, [{ groupIndex: 0, keyIndex: 0 }])).toThrow();
    const changedName = structuredClone(before);
    getGeminiGroupKeys(changedName[0])[0].name = 'new-name';
    expect(() =>
      rebaseGeminiTargets(before, changedName, [{ groupIndex: 0, keyIndex: 0 }])
    ).toThrow();
  });
});
