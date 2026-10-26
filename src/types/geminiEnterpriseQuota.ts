export type GeminiEnterpriseQuotaStatus =
  'ok' | 'partial' | 'stale' | 'no_permission' | 'no_data' | 'unavailable';

export interface GeminiEnterpriseQuotaPool {
  tier: string;
  status: GeminiEnterpriseQuotaStatus;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  usageUpdatedAt: string | null;
}

export interface GeminiEnterpriseQuotaData {
  status: GeminiEnterpriseQuotaStatus;
  observedAt: string | null;
  periodStart: string | null;
  resetAt: string | null;
  pools: GeminiEnterpriseQuotaPool[];
  selectedPool: GeminiEnterpriseQuotaPool | null;
  accountId?: string;
  bindingId?: string;
  revision?: number;
}

export interface GeminiEnterpriseQuotaState {
  loading: boolean;
  fetchedAtMs: number;
  data?: GeminiEnterpriseQuotaData;
  poolScope?: string;
}
