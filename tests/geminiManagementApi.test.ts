import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import {
  geminiManagementApi,
  isGeminiConfigConflict,
  normalizeGeminiSnapshot,
  type GeminiAliasRule,
} from '../src/services/api/geminiManagement';

const originalGet = apiClient.get;
const originalPost = apiClient.post;
const originalPut = apiClient.put;
const originalRevision = apiClient.getConnectionRevision;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
  apiClient.put = originalPut;
  apiClient.getConnectionRevision = originalRevision;
});

const snapshotFixture = () => ({
  revision: 'opaque-config-sha-123',
  groups: [
    {
      name: 'team',
      'base-url': 'https://example.invalid',
      headers: { 'auth-index': 'header-value' },
      custom: { preserved: true },
      keys: [{ 'api-key': 'fixture-key', models: null, future: 'keep' }],
    },
    { name: 'empty', keys: [] },
  ],
  aliases: [
    {
      name: 'gemini-upstream',
      alias: 'gemini-client',
      fork: true,
      'display-name': 'Client model',
      'force-mapping': true,
      thinking: { levels: ['medium'] },
      custom: { preserved: true },
    },
  ],
  capabilities: { aliases: true, batch: true, migration: true },
});

describe('Gemini management v8 API', () => {
  test('reads the canonical snapshot and preserves raw group and alias metadata', async () => {
    const fixture = snapshotFixture();
    const calls: string[] = [];
    apiClient.get = (async (url: string) => {
      calls.push(url);
      return fixture;
    }) as typeof apiClient.get;

    const actual = await geminiManagementApi.snapshot();
    expect(calls).toEqual(['/credentials/api-keys/gemini/snapshot']);
    expect(actual).toEqual(fixture);
    expect(actual.groups).toBe(fixture.groups);
    expect(actual.aliases).toBe(fixture.aliases);
  });

  test('normalizes capability flags conservatively without changing raw subtrees', () => {
    const fixture = snapshotFixture();
    const actual = normalizeGeminiSnapshot({
      ...fixture,
      capabilities: { aliases: true, batch: 'true', migration: 1, future: true },
    });
    expect(actual.capabilities).toEqual({ aliases: true, batch: false, migration: false });
    expect(actual.groups).toBe(fixture.groups);
    expect(actual.aliases).toBe(fixture.aliases);
  });

  test.each([
    null,
    {},
    { ...snapshotFixture(), revision: '' },
    { ...snapshotFixture(), revision: 123 },
    { ...snapshotFixture(), groups: {} },
    { ...snapshotFixture(), groups: [{ name: 'team' }] },
    { ...snapshotFixture(), aliases: null },
    { ...snapshotFixture(), aliases: [{ name: 'model' }] },
    { ...snapshotFixture(), capabilities: null },
  ])('refuses an invalid snapshot %#', (value) => {
    expect(() => normalizeGeminiSnapshot(value)).toThrow('Invalid Gemini management snapshot.');
  });

  test('writes only the alias subtree with a quoted revision and raw metadata intact', async () => {
    const aliases: GeminiAliasRule[] = snapshotFixture().aliases;
    const calls: unknown[] = [];
    const result = { status: 'ok', revision: 'next-sha' };
    apiClient.put = (async (...args: unknown[]) => {
      calls.push(args);
      return result;
    }) as typeof apiClient.put;

    expect(await geminiManagementApi.saveAliases('opaque-config-sha-123', aliases)).toBe(result);
    expect(calls).toEqual([
      [
        '/config/routing/api-key-model-alias/gemini',
        aliases,
        { headers: { 'If-Match': '"opaque-config-sha-123"' } },
      ],
    ]);
    expect((calls[0] as unknown[])[1]).toBe(aliases);
  });

  test('sends empty alias lists as a raw subtree replacement', async () => {
    const calls: unknown[] = [];
    apiClient.put = (async (...args: unknown[]) => {
      calls.push(args);
      return { status: 'ok', revision: 'next' };
    }) as typeof apiClient.put;
    await geminiManagementApi.saveAliases('current', []);
    expect(calls).toEqual([
      ['/config/routing/api-key-model-alias/gemini', [], { headers: { 'If-Match': '"current"' } }],
    ]);
  });

  test('saves raw groups once with a revision and strips only direct read-only indexes', async () => {
    const groups = snapshotFixture().groups;
    Object.assign(groups[0], { auth_index: 'group-index', 'auth-index': 'other-group-index' });
    Object.assign(groups[0].keys[0], {
      auth_index: 'key-index',
      'auth-index': 'other-key-index',
      metadata: { auth_index: 'keep-nested', 'auth-index': 'keep-too' },
    });
    const before = structuredClone(groups);
    const calls: unknown[][] = [];
    const result = { status: 'ok', revision: 'next-groups' };
    apiClient.put = (async (...args: unknown[]) => {
      calls.push(args);
      return result;
    }) as typeof apiClient.put;
    expect(await geminiManagementApi.saveGroups('current-groups', groups)).toBe(result);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('/config/api-keys/gemini');
    expect(calls[0][2]).toEqual({ headers: { 'If-Match': '"current-groups"' } });
    const sent = calls[0][1] as Record<string, unknown>[];
    const expected = structuredClone(before);
    delete (expected[0] as Record<string, unknown>).auth_index;
    delete (expected[0] as Record<string, unknown>)['auth-index'];
    delete (expected[0].keys[0] as Record<string, unknown>).auth_index;
    delete (expected[0].keys[0] as Record<string, unknown>)['auth-index'];
    expect(sent).toEqual(expected);
    expect(sent[0].headers).toEqual({ 'auth-index': 'header-value' });
    expect(groups).toEqual(before);
    expect(sent).not.toBe(groups);
  });

  test.each([100, 1000])(
    'saves %s Keys in one request without changing order or metadata',
    async (count) => {
      const groups = [
        {
          name: 'bulk',
          models: null,
          future: { keep: true },
          keys: Array.from({ length: count }, (_, index) => ({
            'api-key': `fixture-${index}`,
            models: index % 2 ? [] : null,
            metadata: { index },
          })),
        },
      ];
      let calls = 0;
      apiClient.put = (async (url: string, data: unknown) => {
        calls += 1;
        expect(url).toBe('/config/api-keys/gemini');
        expect(data).toEqual(groups);
        return { status: 'ok', revision: 'next' };
      }) as typeof apiClient.put;
      await geminiManagementApi.saveGroups('current', groups);
      expect(calls).toBe(1);
    }
  );

  test('keeps selected key and whole-group indices distinct in batch payloads', async () => {
    const calls: unknown[] = [];
    apiClient.post = (async (...args: unknown[]) => {
      calls.push(args);
      return { status: 'ok', revision: 'next', affected: 3 };
    }) as typeof apiClient.post;
    const targets = [
      { groupIndex: 0, keyIndex: 0 },
      { groupIndex: 2, keyIndex: 4 },
    ];
    await geminiManagementApi.batch('key-revision', 'disable', targets);
    await geminiManagementApi.batch('group-revision', 'patch', [{ groupIndex: 2 }], {
      'base-url': 'https://group.invalid',
      'proxy-url': '',
      headers: { A: 'fixture-value' },
      priority: 0,
    });
    expect(calls).toEqual([
      [
        '/credentials/api-keys/gemini/batch',
        { revision: 'key-revision', action: 'disable', targets },
      ],
      [
        '/credentials/api-keys/gemini/batch',
        {
          revision: 'group-revision',
          action: 'patch',
          targets: [{ groupIndex: 2 }],
          changes: {
            'base-url': 'https://group.invalid',
            'proxy-url': '',
            headers: { A: 'fixture-value' },
            priority: 0,
          },
        },
      ],
    ]);
  });

  test('migration preview and apply retain the server revision and candidate IDs', async () => {
    const calls: unknown[] = [];
    apiClient.post = (async (...args: unknown[]) => {
      calls.push(args);
      return { status: 'ok', revision: 'next' };
    }) as typeof apiClient.post;
    await geminiManagementApi.previewMigration('preview-sha');
    await geminiManagementApi.applyMigration('preview-sha', ['candidate-0', 'candidate-2']);
    expect(calls).toEqual([
      ['/credentials/api-keys/gemini/alias-migration/preview', { revision: 'preview-sha' }],
      [
        '/credentials/api-keys/gemini/alias-migration/apply',
        { revision: 'preview-sha', candidateIds: ['candidate-0', 'candidate-2'] },
      ],
    ]);
  });

  test('model suggestions use the Gemini v8 routing definitions endpoint', async () => {
    apiClient.get = (async (url: string) => {
      expect(url).toBe('/routing/model-definitions/gemini');
      return { models: [{ id: 'gemini-upstream' }] };
    }) as typeof apiClient.get;
    expect(await geminiManagementApi.modelDefinitions()).toEqual({
      models: [{ id: 'gemini-upstream' }],
    });
  });

  test.each([409, 400, 401, 404, 500])(
    'classifies status %s without confusing other errors',
    (status) => {
      expect(isGeminiConfigConflict({ status, apiCode: 'config_conflict' })).toBe(status === 409);
    }
  );

  test('does not classify unrelated error shapes as a revision conflict', () => {
    for (const value of [null, undefined, '409', 409, [], new Error('409'), { status: '409' }]) {
      expect(isGeminiConfigConflict(value)).toBe(false);
    }
  });

  test.each(['snapshot', 'batch', 'groups', 'aliases', 'preview', 'apply', 'definitions'] as const)(
    'rejects a stale %s response after a connection revision changes during the request',
    async (operation) => {
      let revision = 10;
      apiClient.getConnectionRevision = () => revision;
      const response = async () => {
        await Promise.resolve();
        revision += 1;
        return snapshotFixture();
      };
      apiClient.get = response as typeof apiClient.get;
      apiClient.post = response as typeof apiClient.post;
      apiClient.put = response as typeof apiClient.put;
      const requests = {
        snapshot: () => geminiManagementApi.snapshot(),
        batch: () =>
          geminiManagementApi.batch('current', 'enable', [{ groupIndex: 0, keyIndex: 0 }]),
        aliases: () => geminiManagementApi.saveAliases('current', []),
        groups: () => geminiManagementApi.saveGroups('current', snapshotFixture().groups),
        preview: () => geminiManagementApi.previewMigration('current'),
        apply: () => geminiManagementApi.applyMigration('current', ['candidate']),
        definitions: () => geminiManagementApi.modelDefinitions(),
      };
      await expect(requests[operation]()).rejects.toMatchObject({ name: 'AbortError' });
    }
  );

  test('propagates an HTTP revision conflict unchanged so callers can reload explicitly', async () => {
    const conflict = { status: 409, apiCode: 'config_conflict', revision: 'fresh-sha' };
    apiClient.post = (async () => {
      throw conflict;
    }) as typeof apiClient.post;
    try {
      await geminiManagementApi.batch('stale-sha', 'delete', [{ groupIndex: 0, keyIndex: 0 }]);
      throw new Error('The stale batch should have failed.');
    } catch (error) {
      expect(error).toBe(conflict);
      expect(isGeminiConfigConflict(error)).toBe(true);
    }
  });

  test('propagates a group-save revision conflict without retrying', async () => {
    const conflict = { status: 409, apiCode: 'config_conflict', revision: 'fresh' };
    let calls = 0;
    apiClient.put = (async () => {
      calls += 1;
      throw conflict;
    }) as typeof apiClient.put;
    try {
      await geminiManagementApi.saveGroups('stale', snapshotFixture().groups);
      throw new Error('The stale save should have failed.');
    } catch (error) {
      expect(error).toBe(conflict);
    }
    expect(calls).toBe(1);
  });
});
