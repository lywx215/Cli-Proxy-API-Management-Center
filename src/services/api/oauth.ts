/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import { requireManagementObject } from './managementResponse';
import type { GeminiEnterpriseConfig } from '@/types/config';
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
  resource_inputs_supported?: boolean;
}

export interface OAuthStartOptions {
  projectId?: string;
  geminiEnterprise?: GeminiEnterpriseConfig & { discoverResources: boolean };
}

export class GeminiEnterpriseBackendUpgrade extends Error {}

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
  startAuth: async (provider: string, signal?: AbortSignal, options?: OAuthStartOptions) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params: Record<string, string | boolean> = { provider: providerKey };
    if (WEBUI_SUPPORTED.has(providerKey)) {
      params.is_webui = true;
    }
    const projectId = normalizeGeminiCliProjectId(options?.projectId);
    if (providerKey === 'gemini-cli' && projectId) {
      params.project_id = projectId;
    }
    const enterprise = providerKey === 'gemini-enterprise' ? options?.geminiEnterprise : undefined;
    if (enterprise) {
      params.auto_discover_resources = enterprise.discoverResources;
      params.client_id = enterprise.clientId.trim();
      params.client_secret_env = enterprise.clientSecretEnv.trim();
      if (!enterprise.discoverResources) {
        params.engine_id = enterprise.engineId.trim();
        params.assistant_id = enterprise.assistantId.trim() || 'default_assistant';
        params.project_id = enterprise.projectId.trim();
        params.location = enterprise.location.trim();
        params.collection_id = enterprise.collectionId.trim();
      }
    }
    const revision = apiClient.getConnectionRevision();
    const response = await apiClient.get<OAuthStartResponse>('/oauth/auth-url', {
      params,
      ...(signal ? { signal } : {}),
    });
    requireManagementObject(response);
    if (enterprise && response.resource_inputs_supported !== true) {
      if (response.state && !signal?.aborted && revision === apiClient.getConnectionRevision()) {
        await apiClient
          .delete('/oauth/session', {
            params: { state: response.state },
            ...(signal ? { signal } : {}),
          })
          .catch(() => undefined);
      }
      throw new GeminiEnterpriseBackendUpgrade(
        'Gemini Enterprise resource inputs require a newer backend'
      );
    }
    return response;
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
