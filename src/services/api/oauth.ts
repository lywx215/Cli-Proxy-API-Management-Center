/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider =
  | 'codex'
  | 'gemini-cli'
  | 'gemini-enterprise'
  | 'anthropic'
  | 'antigravity'
  | 'kimi'
  | 'kimi-ai'
  | 'xai'
  | 'devin'
  | 'meta';

export type OAuthProvider = string;
export interface OAuthStartResponse {
  url: string;
  state?: string;
  user_code?: string;
  flow?: string;
  expires_in?: number;
  callback_url?: string;
  manual_callback_required?: boolean;
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
  'claude',
  'antigravity',
  'xai',
  'devin',
  'gemini-cli',
  'gemini-enterprise',
]);

const CALLBACK_PROVIDER_MAP: Record<string, string> = { 'gemini-cli': 'gemini' };

export const normalizeGeminiCliProjectId = (value?: string): string | undefined => {
  const projectId = value?.trim();
  return projectId?.toUpperCase() === 'ALL' ? 'ALL' : projectId || undefined;
};

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key === 'anthropic' ? 'claude' : key;
};

export const oauthApi = {
  startAuth: (provider: string, signal?: AbortSignal, options?: { projectId?: string }) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params: Record<string, string | boolean> = { provider: providerKey };
    if (WEBUI_SUPPORTED.has(providerKey)) {
      params.is_webui = true;
    }
    const projectId = normalizeGeminiCliProjectId(options?.projectId);
    if (providerKey === 'gemini-cli' && projectId) {
      params.project_id = projectId;
    }
    return apiClient.get<OAuthStartResponse>('/oauth/auth-url', {
      params,
      ...(signal ? { signal } : {}),
    });
  },

  getAuthStatus: (state: string, signal?: AbortSignal) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/oauth/status`, {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  cancelSession: (state: string, signal?: AbortSignal) =>
    apiClient.delete<OAuthCancelResponse>('/oauth/session', {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  submitCallback: (provider: string, redirectUrl: string, signal?: AbortSignal) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCallbackResponse>(
      '/oauth/callback',
      { provider: CALLBACK_PROVIDER_MAP[providerKey] ?? providerKey, redirect_url: redirectUrl },
      signal ? { signal } : undefined
    );
  },
};
