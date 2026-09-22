/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider =
  'codex' | 'gemini-cli' | 'anthropic' | 'antigravity' | 'kimi' | 'xai' | 'devin' | 'meta';

export type OAuthProvider = string;
export interface OAuthStartResponse {
  url: string;
  state?: string;
  user_code?: string;
  flow?: string;
  expires_in?: number;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthCancelResponse {
  status: 'ok';
  cancelled: boolean;
}

const WEBUI_SUPPORTED = new Set<string>([
  'codex',
  'anthropic',
  'antigravity',
  'xai',
  'devin',
  'gemini-cli',
]);

const CALLBACK_PROVIDER_MAP: Record<string, string> = { 'gemini-cli': 'gemini' };

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key;
};

export const oauthApi = {
  startAuth: (provider: string, signal?: AbortSignal, options?: { projectId?: string }) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.has(providerKey)) {
      params.is_webui = true;
    }
    if (providerKey === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    return apiClient.get<OAuthStartResponse>(`/${providerKey}-auth-url`, {
      params: Object.keys(params).length ? params : undefined,
      ...(signal ? { signal } : {}),
    });
  },

  getAuthStatus: (state: string, signal?: AbortSignal) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/get-auth-status`, {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  cancelSession: (state: string, signal?: AbortSignal) =>
    apiClient.delete<OAuthCancelResponse>('/oauth-session', {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  submitCallback: (provider: string, redirectUrl: string, signal?: AbortSignal) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCallbackResponse>(
      '/oauth-callback',
      { provider: CALLBACK_PROVIDER_MAP[providerKey] ?? providerKey, redirect_url: redirectUrl },
      signal ? { signal } : undefined
    );
  },
};
