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

  test.each(['snapshot', 'batch', 'aliases', 'preview', 'apply', 'definitions'] as const)(
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
});
