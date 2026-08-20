import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  GeminiCliCodeAssistPayload,
  GeminiCliCredits,
  GeminiCliParsedBucket,
  GeminiCliQuotaBucketState,
  GeminiCliQuotaState,
  GeminiCliUserTier,
} from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  GEMINI_CLI_CODE_ASSIST_URL,
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  buildGeminiCliQuotaBuckets,
  createStatusError,
  isDisabledAuthFile,
  isGeminiCliFile,
  normalizeGeminiCliModelId,
  normalizeNumberValue,
  normalizeQuotaFraction,
  normalizeStringValue,
  parseGeminiCliCodeAssistPayload,
  parseGeminiCliQuotaPayload,
  resolveGeminiCliProjectId,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isRuntimeOnlyAuthFile } from '@/features/authFiles/constants';
import type { QuotaProviderData } from '../types';

export interface GeminiCliQuotaData {
  buckets: GeminiCliQuotaBucketState[];
  tierLabel: string | null;
  tierId: string | null;
  creditBalance: number | null;
}

const GEMINI_CLI_TIER_LABELS: Record<string, string> = {
  'free-tier': 'tier_free',
  'legacy-tier': 'tier_legacy',
  'standard-tier': 'tier_standard',
  'g1-pro-tier': 'tier_pro',
  'g1-ultra-tier': 'tier_ultra',
};

function resolveTier(payload: GeminiCliCodeAssistPayload | null) {
  const currentTier: GeminiCliUserTier | null | undefined =
    payload?.currentTier ?? payload?.current_tier;
  const paidTier: GeminiCliUserTier | null | undefined = payload?.paidTier ?? payload?.paid_tier;
  return paidTier ?? currentTier ?? null;
}

function resolveTierId(payload: GeminiCliCodeAssistPayload | null): string | null {
  const tier = resolveTier(payload);
  const rawId = normalizeStringValue(tier?.id);
  return rawId ? rawId.toLowerCase() : null;
}

function resolveTierLabel(payload: GeminiCliCodeAssistPayload | null, t: TFunction): string | null {
  const tierId = resolveTierId(payload);
  if (!tierId) return null;
  const labelKey = GEMINI_CLI_TIER_LABELS[tierId];
  return labelKey
    ? t(`gemini_cli_quota.${labelKey}`)
    : normalizeStringValue(resolveTier(payload)?.id);
}

function resolveCreditBalance(payload: GeminiCliCodeAssistPayload | null): number | null {
  const tier = resolveTier(payload);
  const credits: GeminiCliCredits[] =
    tier?.availableCredits ??
    tier?.available_credits ??
    payload?.availableCredits ??
    payload?.available_credits ??
    [];
  let total = 0;
  let found = false;
  for (const credit of credits) {
    const amount = normalizeNumberValue(credit.creditAmount ?? credit.credit_amount);
    if (amount !== null) {
      total += amount;
      found = true;
    }
  }
  return found ? total : null;
}

async function fetchSupplementaryQuota(
  authIndex: string,
  projectId: string,
  t: TFunction
): Promise<Pick<GeminiCliQuotaData, 'tierLabel' | 'tierId' | 'creditBalance'>> {
  try {
    const result = await apiCallApi.request({
      authIndex,
      method: 'POST',
      url: GEMINI_CLI_CODE_ASSIST_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify({
        cloudaicompanionProject: projectId,
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
          duetProject: projectId,
        },
      }),
    });
    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { tierLabel: null, tierId: null, creditBalance: null };
    }
    const payload = parseGeminiCliCodeAssistPayload(result.body ?? result.bodyText);
    return {
      tierLabel: resolveTierLabel(payload, t),
      tierId: resolveTierId(payload),
      creditBalance: resolveCreditBalance(payload),
    };
  } catch {
    return { tierLabel: null, tierId: null, creditBalance: null };
  }
}

async function fetchGeminiCliQuota(file: AuthFileItem, t: TFunction): Promise<GeminiCliQuotaData> {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) throw new Error(t('gemini_cli_quota.missing_auth_index'));

  const projectId = resolveGeminiCliProjectId(file);
  if (!projectId) throw new Error(t('gemini_cli_quota.missing_project_id'));

  const supplementaryPromise = fetchSupplementaryQuota(authIndex, projectId, t);
  const quotaResponse = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: GEMINI_CLI_QUOTA_URL,
    header: { ...GEMINI_CLI_REQUEST_HEADERS },
    data: JSON.stringify({ project: projectId }),
  });
  if (quotaResponse.statusCode < 200 || quotaResponse.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(quotaResponse), quotaResponse.statusCode);
  }

  const payload = parseGeminiCliQuotaPayload(quotaResponse.body ?? quotaResponse.bodyText);
  const parsedBuckets = (Array.isArray(payload?.buckets) ? payload.buckets : [])
    .map((bucket) => {
      const modelId = normalizeGeminiCliModelId(bucket.modelId ?? bucket.model_id);
      if (!modelId) return null;
      const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type);
      const remainingAmount = normalizeNumberValue(
        bucket.remainingAmount ?? bucket.remaining_amount
      );
      const resetTime = normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined;
      const remainingFractionRaw = normalizeQuotaFraction(
        bucket.remainingFraction ?? bucket.remaining_fraction
      );
      const remainingFraction =
        remainingFractionRaw ??
        (remainingAmount !== null ? (remainingAmount <= 0 ? 0 : null) : resetTime ? 0 : null);
      return { modelId, tokenType, remainingFraction, remainingAmount, resetTime };
    })
    .filter((bucket): bucket is GeminiCliParsedBucket => bucket !== null);

  const supplementary = await supplementaryPromise;
  return {
    buckets: buildGeminiCliQuotaBuckets(parsedBuckets),
    ...supplementary,
  };
}

export const GEMINI_CLI_CONFIG: QuotaProviderData<GeminiCliQuotaState, GeminiCliQuotaData> = {
  type: 'gemini-cli',
  i18nPrefix: 'gemini_cli_quota',
  filterFn: (file) =>
    isGeminiCliFile(file) && !isRuntimeOnlyAuthFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchGeminiCliQuota,
  storeSelector: (state) => state.geminiCliQuota,
  storeSetter: 'setGeminiCliQuota',
  buildLoadingState: () => ({ status: 'loading', buckets: [] }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (message, status) => ({
    status: 'error',
    buckets: [],
    error: message,
    errorStatus: status,
  }),
};
