/**
 * Antigravity 请求统计 API
 */

import { apiClient } from './client';

export interface AntigravityStatEntry {
  auth_id: string;
  model: string;
  total: number;
  success: number;
  failure: number;
  credits_count: number;
  status_codes?: Record<string, number>;
  first_seen: string;
  last_seen: string;
}

export interface AntigravityAuthSummary {
  auth_id: string;
  total: number;
  success: number;
  failure: number;
  credits_count: number;
  error_rate: string;
  status_codes?: Record<string, number>;
  models: string[];
  first_seen: string;
  last_seen: string;
}

export interface AntigravityModelSummary {
  model: string;
  total: number;
  success: number;
  failure: number;
  credits_count: number;
  error_rate: string;
  status_codes?: Record<string, number>;
  auth_count: number;
  first_seen: string;
  last_seen: string;
}

export interface AntigravityStatsSummary {
  total_auths: number;
  total_models: number;
  total_requests: number;
  total_success: number;
  total_failure: number;
  total_credits: number;
  error_rate: string;
}

export interface AntigravityStatsResponse {
  view: string;
  stats: AntigravityStatEntry[] | AntigravityAuthSummary[] | AntigravityModelSummary[];
  summary: AntigravityStatsSummary;
  auth_id?: string;
}

export interface AntigravityStatsResetResponse {
  message: string;
  cleared_entries: number;
  auth_id?: string;
}

export const antigravityStatsApi = {
  /**
   * 获取 Antigravity 请求统计
   */
  getStats: (view: 'auth' | 'model' | 'detail' = 'auth', authId?: string) => {
    const params = new URLSearchParams({ view });
    if (authId) params.set('auth_id', authId);
    return apiClient.get<AntigravityStatsResponse>(`/antigravity-stats?${params.toString()}`);
  },

  /**
   * 重置 Antigravity 请求统计
   */
  resetStats: (authId?: string) => {
    const params = authId ? `?auth_id=${encodeURIComponent(authId)}` : '';
    return apiClient.delete<AntigravityStatsResetResponse>(`/antigravity-stats${params}`);
  },
};
