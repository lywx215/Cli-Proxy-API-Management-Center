import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { canRetrySharedQuota, cooldownRemainingSeconds } from '../src/features/authFiles/cooldowns';
import type { AuthFileCooldown, AuthFileItem } from '../src/types/authFile';

const source = readFileSync('src/features/authFiles/hooks/useAuthFilesData.ts', 'utf8');
const shared: AuthFileCooldown = {
  origin: 'shared_pool',
  scope: 'credential',
  feature: 'assistant_search',
  phase: 'cooling',
  poolId: 'a'.repeat(64),
  poolVersion: 7,
  relatedAuthCount: 3,
  sharedResetSupported: true,
  reason: 'credential_quota',
  retryAt: '2026-10-24T07:00:00Z',
  remainingSeconds: 300,
};
const model: AuthFileCooldown = {
  scope: 'model',
  modelKey: 'model-a',
  reason: 'quota',
  retryAt: shared.retryAt,
  remainingSeconds: 600,
};
const makeFile = (authIndex: string): AuthFileItem => ({
  name: `${authIndex}.json`,
  authIndex,
  cooldownSnapshot: {
    observedAt: '2026-10-24T06:55:00Z',
    receivedAtMs: 1_000,
    records: [shared, model],
  },
});

function harness({ deferUpdates = false } = {}) {
  let revision = 1;
  let files = ['a', 'b', 'c'].map(makeFile);
  let confirmation: { message: string; onConfirm: () => Promise<void> } | undefined;
  let invalidations = 0;
  const notifications: unknown[][] = [];
  const loads: unknown[] = [];
  const updates: Array<(prev: AuthFileItem[]) => AuthFileItem[]> = [];
  const requests: Array<{
    args: unknown[];
    scope: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  const request = (scope: string, ...args: unknown[]) =>
    new Promise((resolve, reject) => requests.push({ scope, args, resolve, reject }));
  const env = {
    apiClient: { getConnectionRevision: () => revision },
    authFilesApi: {
      resetCooldown: (...args: unknown[]) => request('credential', ...args),
      retrySharedQuota: (...args: unknown[]) => request('shared_pool', ...args),
    },
    canRetrySharedQuota,
    cooldownResetPendingRef: { current: new Set<string>() },
    setCooldownResetting: () => {},
    showConfirmation: (value: typeof confirmation) => {
      confirmation = value;
    },
    showNotification: (...args: unknown[]) => notifications.push(args),
    invalidateInFlightLoads: () => {
      invalidations++;
    },
    loadFiles: async (options: unknown) => {
      loads.push(options);
    },
    setFiles: (update: (prev: AuthFileItem[]) => AuthFileItem[]) => {
      if (deferUpdates) updates.push(update);
      else files = update(files);
    },
    t: (key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params ?? {})}`,
    useCallback: (fn: unknown) => fn,
  };
  const block = source.slice(
    source.indexOf('  const handleCooldownReset = useCallback('),
    source.indexOf('  const handleStatusToggle = useCallback(')
  );
  const js = ts.transpileModule(`${block}\nreturn handleCooldownReset;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const reset = new Function(...Object.keys(env), js)(...Object.values(env)) as (
    item: AuthFileItem,
    record?: AuthFileCooldown
  ) => void;
  return {
    reset,
    requests,
    notifications,
    loads,
    get confirmation() {
      return confirmation;
    },
    confirm: () => confirmation?.onConfirm(),
    switchConnection: () => {
      revision++;
    },
    applyUpdates: () => {
      updates.forEach((update) => {
        files = update(files);
      });
    },
    get files() {
      return files;
    },
    get invalidations() {
      return invalidations;
    },
  };
}

describe('auth file cooldown action lifecycle', () => {
  test('confirms the shared impact and reloads all cards without clearing independent limits', async () => {
    const h = harness();
    const before = h.files;
    h.reset(before[0], shared);
    expect(h.requests).toHaveLength(0);
    expect(h.confirmation?.message).toContain('"count":3');
    const pending = h.confirm();
    await h.confirm();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toMatchObject({
      scope: 'shared_pool',
      args: ['a', shared.poolId, 7],
    });
    h.requests[0].resolve({ affected_auth_indexes: ['a', 'b', 'c'] });
    await pending;
    expect(h.files).toBe(before);
    expect(h.loads).toEqual([{ background: true }]);
    expect(h.invalidations).toBe(1);
    expect(h.notifications[0][0]).toContain('auth_files.shared_quota_retry_success');
  });

  test('a credential reset only clears its independent records and keeps the shared clock anchor', async () => {
    const h = harness();
    const before = h.files;
    h.reset(before[0]);
    const pending = h.confirm();
    expect(h.requests[0]).toMatchObject({ scope: 'credential', args: ['a'] });
    h.requests[0].resolve({ status: 'ok' });
    await pending;
    expect(h.files[0].cooldownSnapshot).toEqual({
      ...before[0].cooldownSnapshot,
      records: [shared],
    });
    const snapshot = h.files[0].cooldownSnapshot!;
    expect(cooldownRemainingSeconds(shared, snapshot.receivedAtMs, 31_000)).toBe(270);
    expect(h.files[1]).toBe(before[1]);
    expect(h.files[2]).toBe(before[2]);
    expect(h.loads).toEqual([{ background: true }]);
  });

  test('unsupported or incomplete shared projections cannot send a pool operation', () => {
    for (const record of [
      { ...shared, origin: undefined },
      { ...shared, scope: 'model' as const },
      { ...shared, sharedResetSupported: false },
      { ...shared, sharedResetSupported: undefined },
      { ...shared, poolId: '' },
      { ...shared, poolVersion: 0 },
      { ...shared, poolVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...shared, relatedAuthCount: undefined },
      { ...shared, relatedAuthCount: 0 },
      { ...shared, feature: 'future_feature' },
      { ...shared, phase: 'probing' as const },
    ]) {
      const h = harness();
      h.reset(h.files[0], record);
      expect(h.confirmation).toBeUndefined();
      expect(h.requests).toHaveLength(0);
    }
  });

  for (const record of [undefined, shared]) {
    const scope = record ? 'shared' : 'credential';
    test(`a ${scope} confirmation from an old connection cannot send a request`, async () => {
      const h = harness();
      h.reset(h.files[0], record);
      h.switchConnection();
      await h.confirm();
      expect(h.requests).toHaveLength(0);
    });

    for (const fail of [false, true]) {
      test(`a stale ${scope} ${fail ? 'failure' : 'success'} cannot update a new connection`, async () => {
        const h = harness();
        const before = h.files;
        h.reset(before[0], record);
        const pending = h.confirm();
        h.switchConnection();
        if (fail) h.requests[0].reject(new Error('fixture failure'));
        else h.requests[0].resolve({ status: 'ok' });
        await pending;
        expect(h.files).toBe(before);
        expect(h.invalidations).toBe(0);
        expect(h.notifications).toHaveLength(0);
        expect(h.loads).toHaveLength(0);
      });
    }
  }

  test('a shared version conflict refreshes the complete snapshot without pretending to reset it', async () => {
    const h = harness();
    const before = h.files;
    h.reset(before[0], shared);
    const pending = h.confirm();
    h.requests[0].reject(new Error('shared pool changed; refresh credentials before retrying'));
    await pending;
    expect(h.files).toBe(before);
    expect(h.loads).toEqual([{ background: true }]);
    expect(h.invalidations).toBe(1);
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0][1]).toBe('error');
  });

  test('a deferred credential update cannot change files after logout or a connection switch', async () => {
    const h = harness({ deferUpdates: true });
    const before = h.files;
    h.reset(before[0]);
    const pending = h.confirm();
    h.requests[0].resolve({ status: 'ok' });
    await pending;
    h.switchConnection();
    h.applyUpdates();
    expect(h.files).toBe(before);
  });
});
