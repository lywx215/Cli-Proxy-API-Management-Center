import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';
import { refreshProviderWorkbenchConfig } from '../src/features/providers/useProviderWorkbench';

const originalVertex = providersApi.getVertexConfigs;
const originalOpenAI = providersApi.getOpenAIProviders;
const originalRevision = apiClient.getConnectionRevision;
afterEach(() => {
  providersApi.getVertexConfigs = originalVertex;
  providersApi.getOpenAIProviders = originalOpenAI;
  apiClient.getConnectionRevision = originalRevision;
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('provider workbench refresh aggregation', () => {
  test('does not apply completed A results after switching to B while another read is pending', async () => {
    let revision = 1;
    apiClient.getConnectionRevision = () => revision;
    const pendingOpenAI = deferred<Awaited<ReturnType<typeof providersApi.getOpenAIProviders>>>();
    providersApi.getVertexConfigs = async () => [{ apiKey: 'fixture-old-a' }];
    providersApi.getOpenAIProviders = () => pendingOpenAI.promise;
    const writes: unknown[] = [];
    const refresh = refreshProviderWorkbenchConfig(
      async () => ({ loaded: 'A' }),
      (section, value) => writes.push([section, value]),
      () => true
    );
    await Promise.resolve();
    revision = 2;
    pendingOpenAI.reject(new DOMException('Connection changed.', 'AbortError'));
    await expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
    expect(writes).toEqual([]);
  });

  test('refuses the ABA connection change even when current UI scope strings match again', async () => {
    let revision = 1;
    apiClient.getConnectionRevision = () => revision;
    const pending = deferred<Awaited<ReturnType<typeof providersApi.getOpenAIProviders>>>();
    providersApi.getVertexConfigs = async () => [];
    providersApi.getOpenAIProviders = () => pending.promise;
    const writes: unknown[] = [];
    const refresh = refreshProviderWorkbenchConfig(
      async () => ({}),
      (...args) => writes.push(args),
      () => true
    );
    revision = 3;
    pending.resolve([]);
    await expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
    expect(writes).toEqual([]);
  });

  test('ignores an older refresh superseded by a newer request on the same connection', async () => {
    const pending = deferred<Awaited<ReturnType<typeof providersApi.getOpenAIProviders>>>();
    providersApi.getVertexConfigs = async () => [{ apiKey: 'fixture-old' }];
    providersApi.getOpenAIProviders = () => pending.promise;
    let current = true;
    const writes: unknown[] = [];
    const refresh = refreshProviderWorkbenchConfig(
      async () => ({}),
      (...args) => writes.push(args),
      () => current
    );
    current = false;
    pending.resolve([]);
    expect(await refresh).toBe(false);
    expect(writes).toEqual([]);
  });

  test('applies current successful sections and keeps an unavailable optional section unchanged', async () => {
    const vertex = [{ apiKey: 'fixture-current' }];
    providersApi.getVertexConfigs = async () => vertex;
    providersApi.getOpenAIProviders = async () => {
      throw new Error('Unavailable optional read.');
    };
    const writes: unknown[] = [];
    expect(
      await refreshProviderWorkbenchConfig(
        async () => ({}),
        (...args) => writes.push(args),
        () => true
      )
    ).toBe(true);
    expect(writes).toEqual([['vertex-api-key', vertex]]);
  });

  test('does not apply optional results when the full config read fails', async () => {
    providersApi.getVertexConfigs = async () => [{ apiKey: 'fixture' }];
    providersApi.getOpenAIProviders = async () => [];
    const failure = new Error('Full config failed.');
    const writes: unknown[] = [];
    await expect(
      refreshProviderWorkbenchConfig(
        async () => {
          throw failure;
        },
        (...args) => writes.push(args),
        () => true
      )
    ).rejects.toBe(failure);
    expect(writes).toEqual([]);
  });
});
