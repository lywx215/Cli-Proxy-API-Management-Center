/**
 * Auth file types, based on the original src/modules/auth-files.js.
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'gemini-cli'
  | 'gemini-enterprise'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'devin'
  | 'meta'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileCooldown {
  /** Optional shared quota projection; scope remains compatible with older backends. */
  origin?: 'shared_pool';
  feature?: string;
  poolId?: string;
  poolVersion?: number;
  relatedAuthCount?: number;
  phase?: 'cooling' | 'probe_pending' | 'probing';
  restrictionKind?: string;
  restrictionScope?: string;
  timeSource?: string;
  sharedResetSupported?: boolean;
  scope: 'model' | 'credential';
  modelKey?: string;
  reason: string;
  retryAt: string;
  remainingSeconds: number;
  backoffLevel?: number;
  httpStatus?: number;
}

export interface AuthFileCooldownSnapshot {
  /** Server observation time, not the start of the cooldown. */
  observedAt?: string;
  /** Local receipt time anchors relative timers without relying on synchronized clocks. */
  receivedAtMs: number;
  /** null = runtime state unknown; [] = known, with no active timers. */
  records: AuthFileCooldown[] | null;
}

export interface GeminiEnterpriseResources {
  projectId?: string;
  location?: string;
  collectionId?: string;
  engineId?: string;
  assistantId?: string;
  endpoint?: string;
}

export type EnterpriseModelPolicyMode =
  'auto' | 'catalog' | 'argon_only' | 'exclude_argon' | 'custom';
export type EnterpriseModelPolicyState = {
  mode: EnterpriseModelPolicyMode;
  effectiveMode: string;
  status: string;
  reason?: string;
  enforcedAllowedModels?: string[] | null;
  enforcedReason?: string;
  catalogState?: {
    source: string;
    status: string;
    checkedAt?: string;
    lastSuccessAt?: string;
    lastError?: {
      code: string;
      httpStatus?: number;
      reason?: string;
      service?: string;
      consumerProject?: string;
    };
  };
  imageGenerationDisabled?: boolean;
  catalogKnown: boolean;
  allowedModels: string[] | null;
  excludedModels: string[];
  globalExcludedModels: string[];
  effectiveModels: string[];
  catalogModels: {
    id: string;
    displayName?: string;
    mediaKind?: string;
    allowed: boolean;
    reason?: string;
  }[];
  subscription: {
    status: string;
    edition?: string;
    freeTrial: boolean | null;
    state?: string;
    checkedAt?: string;
    lastSuccessAt?: string;
    reason?: string;
  };
};

export interface GeminiEnterpriseCollection extends GeminiEnterpriseResources {
  modelPolicyState?: EnterpriseModelPolicyState;
  bindingId: string;
  revision?: number;
  authIndex?: string;
  projectName?: string;
  disabled: boolean;
  effectiveDisabled: boolean;
  missing?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  successCount: number;
  failureCount: number;
  recentRequests: RecentRequestBucket[];
  cooldownSnapshot?: AuthFileCooldownSnapshot;
  settings: Record<string, unknown>;
}

export interface GeminiEnterpriseAccount extends GeminiEnterpriseResources {
  modelPolicySupported?: boolean;
  catalogFallbackSupported?: boolean;
  modelPolicyState?: EnterpriseModelPolicyState;
  clientId?: string;
  expiry?: string;
  hasRefreshToken?: boolean;
  resourceEditSupported?: boolean;
  accountId?: string;
  revision?: number;
  accountManagementSupported?: boolean;
  discovery?: {
    status?: string;
    checkedAt?: string;
    projects?: { id: string; name?: string }[];
    coverage?: { project?: string; location?: string; status?: string; code?: string }[];
    warnings: {
      project?: string;
      location?: string;
      code?: string;
      message?: string;
      httpStatus?: number;
      reason?: string;
      service?: string;
      consumerProject?: string;
    }[];
  };
  collections?: GeminiEnterpriseCollection[];
  /** Present only on a derived collection view; the saved file remains the parent. */
  bindingId?: string;
  accountAuthIndex?: string;
  accountRevision?: number;
  projectName?: string;
  effectiveDisabled?: boolean;
  missing?: boolean;
  settings?: Record<string, unknown>;
}

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  /**
   * Credential email from disk or runtime metadata, used as the card identity.
   * Never display or search account/account_type: for API-key credentials,
   * AccountInfo returns the API key itself in account.
   */
  email?: string;
  /** GCP / Vertex project ID, used when the email is absent. */
  projectId?: string;
  geminiEnterprise?: GeminiEnterpriseAccount;
  size?: number;
  authIndex?: string | number | null;
  /** Generic plugin quota capability advertised by CPA's auth-files API. */
  supportsQuota?: boolean;
  quotaProvider?: string;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  lastRefresh?: string | number;
  modified?: number;
  priority?: number;
  weight?: number;
  note?: string;
  success?: unknown;
  failed?: unknown;
  /** Cumulative counters normalized from success/failed at the API boundary. */
  successCount?: number;
  failureCount?: number;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  /** Absent on older servers. Never interpreted as credential health. */
  cooldownSnapshot?: AuthFileCooldownSnapshot;
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
  observed_at?: unknown;
  observedAt?: string;
}
