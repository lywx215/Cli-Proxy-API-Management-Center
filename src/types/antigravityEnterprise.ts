import type { AuthFileCooldownSnapshot } from './authFile';
import type { RecentRequestBucket } from '@/utils/recentRequests';

export interface AntigravityEnterpriseLicense {
  projectId: string;
  location: string;
  userTier: string;
  tierDisplayName: string;
  processingLocation?: string;
}

export interface AntigravityEnterpriseBinding {
  bindingId: string;
  revision?: number;
  authIndex?: string;
  license: AntigravityEnterpriseLicense;
  disabled: boolean;
  effectiveDisabled: boolean;
  missing: boolean;
  status?: string;
  statusMessage?: string;
  successCount: number;
  failureCount: number;
  recentRequests: RecentRequestBucket[];
  cooldownSnapshot?: AuthFileCooldownSnapshot;
  settings: Record<string, unknown>;
}

export interface AntigravityEnterpriseAccount {
  accountId: string;
  revision?: number;
  accountManagementSupported: boolean;
  hasRefreshToken?: boolean;
  bindings?: AntigravityEnterpriseBinding[];
  discovery?: { status?: string; checkedAt?: string; unreachable: string[] };
  /** Runtime binding views retain the parent's filename and account identity. */
  bindingId?: string;
  license?: AntigravityEnterpriseLicense;
  accountAuthIndex?: string;
  accountRevision?: number;
  effectiveDisabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface AntigravityEnterpriseQuota {
  accountId: string;
  bindingId: string;
  revision?: number;
  poolId: string;
  status: string;
  stale: boolean;
  observedAt?: string;
  overageEnabled: boolean | null;
  weekly?: {
    remainingFraction: number | null;
    remainingAmount: string | null;
    resetAt: string | null;
    disabled: boolean;
  };
}
