import { afterEach, describe, expect, test } from 'bun:test';
import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { apiClient } from '../src/services/api/client';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('v8 management transport', () => {
  test('uses the v8 prefix, bearer authentication and bare JSON scalar writes', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.invalid/gateway/v8/management',
      managementKey: 'fixture-only',
    });
    const adapter: AxiosAdapter = async (config) => {
      expect(config.baseURL).toBe('https://proxy.invalid/gateway/v8/management');
      expect(config.url).toBe('/config/observability/logs/debug');
      expect(config.headers.Authorization).toBe('Bearer fixture-only');
      expect(config.data).toBe('false');
      return { data: { status: 'ok' }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await apiClient.put('/config/observability/logs/debug', false, { adapter });
  });

  test('retains backend version and plugin support events', async () => {
    const events: Event[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event);
          return true;
        },
      },
    });
    apiClient.setConfig({ apiBase: 'http://proxy.invalid', managementKey: 'fixture-only' });
    const adapter: AxiosAdapter = async (config) => ({
      data: {},
      status: 200,
      statusText: 'OK',
      config,
      headers: { 'x-cpa-version': 'v8.0.3', 'x-cpa-support-plugin': 'true' },
    });
    await apiClient.get('/config', { adapter });
    expect(events.map((event) => event.type)).toEqual([
      'server-version-update',
      'server-plugin-support-update',
    ]);
    expect((events[0] as CustomEvent).detail.version).toBe('v8.0.3');
    expect((events[1] as CustomEvent).detail.supportsPlugin).toBe(true);
  });

  for (const status of [200, 401]) {
    for (const transition of ['switch', 'logout', 'aba', 'same'] as const) {
      test(`${status} response side effects follow the request connection (${transition})`, async () => {
        const events: string[] = [];
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: { dispatchEvent: (event: Event) => events.push(event.type) },
        });
        apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'fixture-old' });
        let dispatched!: () => void;
        const started = new Promise<void>((resolve) => {
          dispatched = resolve;
        });
        let deliver!: () => void;
        const request = apiClient.get('/credentials', {
          adapter: (config) =>
            new Promise<AxiosResponse>((resolve, reject) => {
              deliver = () => {
                const response: AxiosResponse = {
                  config,
                  data: { files: [] },
                  status,
                  statusText: String(status),
                  headers: { 'X-CPA-Version': 'old-server', 'X-CPA-Support-Plugin': 'true' },
                };
                if (status === 401)
                  reject(
                    new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response)
                  );
                else resolve(response);
              };
              dispatched();
            }),
        });
        await started;
        if (transition === 'logout') apiClient.setConfig({ apiBase: '', managementKey: '' });
        if (transition === 'switch' || transition === 'aba')
          apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'fixture-new' });
        if (transition === 'aba')
          apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'fixture-old' });
        deliver();
        if (status === 401) await expect(request).rejects.toHaveProperty('status', 401);
        else expect(await request).toEqual({ files: [] });
        expect(events).toEqual(
          transition === 'same'
            ? status === 401
              ? ['unauthorized']
              : ['server-version-update', 'server-plugin-support-update']
            : []
        );
      });
    }
  }
});
