import { afterEach, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { oauthApi, normalizeGeminiCliProjectId } from '../src/services/api/oauth';

const originalGet = apiClient.get;
const originalPost = apiClient.post;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
});

test('Gemini project selection supports automatic discovery, ALL, and explicit project IDs', () => {
  expect(normalizeGeminiCliProjectId()).toBeUndefined();
  expect(normalizeGeminiCliProjectId('  ')).toBeUndefined();
  expect(normalizeGeminiCliProjectId(' all ')).toBe('ALL');
  expect(normalizeGeminiCliProjectId(' my-Project ')).toBe('my-Project');
});

test('Gemini CLI keeps project selection and callback alias in cancellable OAuth requests', async () => {
  const signal = new AbortController().signal;
  let startChecked = false;
  let callbackChecked = false;
  apiClient.get = (async (path, options) => {
    expect(path).toBe('/oauth/auth-url');
    expect(options?.params).toEqual({
      provider: 'gemini-cli',
      is_webui: true,
      project_id: 'test-project',
    });
    expect(options?.signal).toBe(signal);
    startChecked = true;
    return { url: 'https://example.invalid/oauth', state: 'test-state' };
  }) as typeof apiClient.get;
  apiClient.post = (async (path, body, options) => {
    expect(path).toBe('/oauth/callback');
    expect(body).toEqual({
      provider: 'gemini',
      redirect_url: 'http://localhost/callback?state=test',
    });
    expect(options?.signal).toBe(signal);
    callbackChecked = true;
    return { status: 'ok' };
  }) as typeof apiClient.post;
  await oauthApi.startAuth('gemini-cli', signal, { projectId: 'test-project' });
  await oauthApi.submitCallback('gemini-cli', 'http://localhost/callback?state=test', signal);
  expect(startChecked && callbackChecked).toBe(true);
});
