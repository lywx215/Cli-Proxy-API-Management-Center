import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { isRecord } from '@/utils/helpers';
import { useConfigStore } from '@/stores/useConfigStore';
import { normalizeWebInputLimits, type WebInputLimits } from './enterpriseWebInputLimits';

export class EnterpriseWebClientError extends Error {
  constructor(
    readonly code:
      | 'invalid_status'
      | 'invalid_limits'
      | 'settings_not_effective'
      | 'missing_policy'
      | 'history_unsupported'
      | 'input_limits_unsupported'
      | 'invalid_input_limits'
  ) {
    super(code);
  }
}

export const ENTERPRISE_WEB_PROVIDER = 'gemini-enterprise-web';
export const ENTERPRISE_WEB_CHANGED = 'enterprise-web-config-changed';
export type WebHistoryMode = 'single-turn' | 'serialized-context';
export const WEB_HISTORY_MODES: WebHistoryMode[] = ['single-turn', 'serialized-context'];
export const WEB_PREFLIGHT_REASONS = [
  'history_mode_disabled',
  'invalid_history',
  'unsupported_history_content',
  'history_limit_exceeded',
  'invalid_input',
  'authentication_or_policy',
  'credential_changed',
  'input_limit_exceeded',
  'capacity_exhausted',
  'channel_disabled',
  'unavailable',
  'cancelled',
] as const;
export type WebAvailableModel = { id: string; displayName: string };
export type WebModelPolicy = 'argon_only' | 'exclude_argon' | 'unclassified';
export type WebModelPolicyFilter = 'all' | WebModelPolicy;
const COOKIE_CHECK_REASONS = [
  'rotation_unauthorized',
  'candidate_rejected',
  'session_rejected',
  'rate_limited',
  'access_denied',
  'temporary_failure',
] as const;
type CookieCheckReason = (typeof COOKIE_CHECK_REASONS)[number];
export const WEB_MODEL_POLICIES: WebModelPolicy[] = ['argon_only', 'exclude_argon', 'unclassified'];
export const isClassifiedWebPolicy = (policy: unknown): policy is 'argon_only' | 'exclude_argon' =>
  policy === 'argon_only' || policy === 'exclude_argon';
export type EnterpriseWebSummary = {
  pageUrl: string;
  proxyUrl: string;
  userAgent?: string;
  availableModels: WebAvailableModel[];
  catalogUpdatedAt?: string;
  revision: number;
  cookiePresent: boolean;
  authVerified: boolean;
  cookieCheckStatus?: 'verified' | 'renewal_degraded' | 'relogin_required' | 'check_failed';
  cookieCheckReason?: CookieCheckReason;
  cookieCheckedAt?: string;
  cookieLastVerifiedAt?: string;
  cookieLastRenewedAt?: string;
  cookieNextCheckAt?: string;
  verifiedAt?: string;
  testedModelIds: string[];
  modelPolicy: WebModelPolicy;
  modelPolicySupported: boolean;
  effectiveModelIds: string[];
};
export type EnterpriseWebSettings = {
  enabled: boolean;
  historyMode?: WebHistoryMode;
  maxConcurrent: number;
  maxInflightBytes: number;
};
export type EnterpriseWebStatus = EnterpriseWebSettings & {
  inputLimits?: WebInputLimits;
  supportedHistoryModes?: WebHistoryMode[];
  preflightRejections?: Partial<Record<(typeof WEB_PREFLIGHT_REASONS)[number], number>>;
  activeRequests: number;
  inflightBytes: number;
  draining: boolean;
  rejectedConcurrency: number;
  rejectedMemory: number;
};
export type EnterpriseWebEdit = {
  name?: string;
  expectedRevision?: number;
  label: string;
  cookies?: string;
  pageUrl: string;
  userAgent?: string;
  proxyUrl: string;
  priority: number;
  modelPolicy: WebModelPolicy;
};
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

// A strict allowlist keeps secrets out of UI records, even on unexpected responses.
export function normalizeEnterpriseWebSummary(raw: unknown): EnterpriseWebSummary | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    pageUrl: string(raw.page_url),
    proxyUrl: string(raw.proxy_url),
    userAgent: typeof raw.user_agent === 'string' ? raw.user_agent : undefined,
    revision: number(raw.revision),
    cookiePresent: raw.cookie_present === true,
    modelPolicy: isClassifiedWebPolicy(raw.model_policy) ? raw.model_policy : 'unclassified',
    modelPolicySupported: WEB_MODEL_POLICIES.includes(raw.model_policy as WebModelPolicy),
    effectiveModelIds: Array.isArray(raw.effective_model_ids)
      ? raw.effective_model_ids.filter((id): id is string => typeof id === 'string')
      : [],
    authVerified: raw.auth_verified === true,
    cookieCheckStatus:
      raw.cookie_check_status === 'verified' ||
      raw.cookie_check_status === 'renewal_degraded' ||
      raw.cookie_check_status === 'relogin_required' ||
      raw.cookie_check_status === 'check_failed'
        ? raw.cookie_check_status
        : undefined,
    cookieCheckReason: COOKIE_CHECK_REASONS.find((reason) => reason === raw.cookie_check_reason),
    cookieCheckedAt: string(raw.cookie_checked_at) || undefined,
    cookieLastVerifiedAt: string(raw.cookie_last_verified_at) || undefined,
    cookieLastRenewedAt: string(raw.cookie_last_renewed_at) || undefined,
    cookieNextCheckAt: string(raw.cookie_next_check_at) || undefined,
    verifiedAt: string(raw.verified_at) || undefined,
    testedModelIds: Array.isArray(raw.tested_model_ids)
      ? raw.tested_model_ids.filter((id): id is string => typeof id === 'string')
      : [],
    availableModels: Array.isArray(raw.available_models)
      ? raw.available_models
          .filter(isRecord)
          .filter((row) => typeof row.id === 'string' && row.id.length > 0)
          .map((row) => ({ id: string(row.id), displayName: string(row.display_name) }))
      : [],
    catalogUpdatedAt: string(raw.catalog_updated_at) || undefined,
  };
}
export function normalizeEnterpriseWebStatus(raw: unknown): EnterpriseWebStatus {
  if (
    !isRecord(raw) ||
    typeof raw.enabled !== 'boolean' ||
    !Number.isInteger(raw.max_concurrent) ||
    !Number.isInteger(raw.max_inflight_bytes) ||
    !Number.isInteger(raw.active_requests) ||
    !Number.isInteger(raw.inflight_bytes)
  ) {
    throw new EnterpriseWebClientError('invalid_status');
  }
  const settings = {
    enabled: raw.enabled,
    maxConcurrent: number(raw.max_concurrent),
    maxInflightBytes: number(raw.max_inflight_bytes),
  };
  if (
    !validEnterpriseWebSettings(settings) ||
    number(raw.active_requests) !== raw.active_requests ||
    number(raw.inflight_bytes) !== raw.inflight_bytes
  )
    throw new EnterpriseWebClientError('invalid_status');
  const supported = Array.isArray(raw.supported_history_modes) ? raw.supported_history_modes : [];
  return {
    enabled: raw.enabled,
    inputLimits: normalizeWebInputLimits(raw.input_limits),
    historyMode: WEB_HISTORY_MODES.find((mode) => mode === raw.history_mode),
    supportedHistoryModes: WEB_HISTORY_MODES.filter((mode) => supported.includes(mode)),
    preflightRejections: Object.fromEntries(
      WEB_PREFLIGHT_REASONS.flatMap((reason) => {
        const value = isRecord(raw.preflight_rejections)
          ? raw.preflight_rejections[reason]
          : undefined;
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
          ? [[reason, value]]
          : [];
      })
    ),
    maxConcurrent: number(raw.max_concurrent),
    maxInflightBytes: number(raw.max_inflight_bytes),
    activeRequests: number(raw.active_requests),
    inflightBytes: number(raw.inflight_bytes),
    draining: raw.draining === true,
    rejectedConcurrency: number(raw.rejected_concurrency),
    rejectedMemory: number(raw.rejected_memory),
  };
}
export function parseEnterpriseWebPage(
  raw: string
): { location: string; authUser: string; configId: string } | null {
  try {
    const url = new URL(raw.trim());
    if (
      url.origin !== 'https://vertexaisearch.cloud.google.com' ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    let parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    let authUser = '0';
    if (parts[0] === 'u' && parts.length >= 2) {
      authUser = parts[1];
      parts = parts.slice(2);
    }
    if (url.searchParams.getAll('authuser').length > 1) return null;
    if (url.searchParams.has('authuser')) authUser = url.searchParams.get('authuser') ?? '';
    const location = parts[0] === 'home' ? 'global' : (parts.shift() ?? '');
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(location) ||
      !/^\d{1,3}$/.test(authUser) ||
      parts[0] !== 'home' ||
      parts[1] !== 'cid' ||
      !/^[A-Za-z0-9_-]{1,1000}$/.test(parts[2] ?? '')
    )
      return null;
    if (
      parts.length !== 3 &&
      (parts.length !== 6 ||
        parts[3] !== 'r' ||
        parts[4] !== 'session' ||
        !/^[A-Za-z0-9_-]{1,1000}$/.test(parts[5]))
    )
      return null;
    return { location, authUser, configId: parts[2] };
  } catch {
    return null;
  }
}
export function getEnterpriseWebEditError(
  edit: EnterpriseWebEdit
): 'invalid_url' | 'missing_cookie' | 'invalid_priority' | 'missing_policy' | null {
  if (!parseEnterpriseWebPage(edit.pageUrl)) return 'invalid_url';
  const cookies = edit.cookies ?? '';
  if (
    (!edit.name || cookies.trim()) &&
    (!/(?:^|;)\s*(?:SID|__Secure-[13]PSID)=[^;\s]+/.test(cookies) ||
      !/(?:^|;)\s*(?:SAPISID|__Secure-[13]PAPISID)=[^;\s]+/.test(cookies))
  )
    return 'missing_cookie';
  if (!Number.isInteger(edit.priority) || Math.abs(edit.priority) > 1000000)
    return 'invalid_priority';
  if (!isClassifiedWebPolicy(edit.modelPolicy)) return 'missing_policy';
  return null;
}

export function validEnterpriseWebSettings(value: EnterpriseWebSettings) {
  return (
    (value.historyMode === undefined || WEB_HISTORY_MODES.includes(value.historyMode)) &&
    Number.isInteger(value.maxConcurrent) &&
    value.maxConcurrent >= 1 &&
    value.maxConcurrent <= 16 &&
    Number.isSafeInteger(value.maxInflightBytes) &&
    value.maxInflightBytes >= 64 * 1048576 &&
    value.maxInflightBytes <= 4096 * 1048576
  );
}
export function notifyEnterpriseWebChange() {
  useConfigStore.getState().clearCache();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ENTERPRISE_WEB_CHANGED));
}
export const enterpriseWebApi = {
  async status() {
    const guard = guardConfigConnection();
    const raw = await apiClient.get('/credentials/gemini-enterprise-web/status');
    guard();
    return normalizeEnterpriseWebStatus(raw);
  },
  async saveSettings(settings: EnterpriseWebSettings) {
    if (!validEnterpriseWebSettings(settings)) throw new EnterpriseWebClientError('invalid_limits');
    const guard = guardConfigConnection();
    if (settings.historyMode !== undefined) {
      const before = await enterpriseWebApi.status();
      guard();
      if (!before.historyMode || !before.supportedHistoryModes?.includes(settings.historyMode))
        throw new EnterpriseWebClientError('history_unsupported');
    }
    await apiClient.patch('/config/upstream/gemini-enterprise-web', {
      enabled: settings.enabled,
      'max-concurrent': settings.maxConcurrent,
      'max-inflight-bytes': settings.maxInflightBytes,
      ...(settings.historyMode === undefined ? {} : { 'history-mode': settings.historyMode }),
    });
    guard();
    notifyEnterpriseWebChange();
    // Only confirmed effective state may be presented as a successful shutdown.
    const actual = await enterpriseWebApi.status();
    guard();
    if (
      actual.enabled !== settings.enabled ||
      (settings.historyMode !== undefined && actual.historyMode !== settings.historyMode) ||
      actual.maxConcurrent !== settings.maxConcurrent ||
      actual.maxInflightBytes !== settings.maxInflightBytes
    ) {
      throw new EnterpriseWebClientError('settings_not_effective');
    }
    return actual;
  },
  async saveCredential(edit: EnterpriseWebEdit) {
    if (!isClassifiedWebPolicy(edit.modelPolicy))
      throw new EnterpriseWebClientError('missing_policy');
    const guard = guardConfigConnection();
    const payload = {
      name: edit.name,
      expected_revision: edit.expectedRevision,
      label: edit.label,
      cookies: edit.cookies,
      page_url: edit.pageUrl,
      ...(edit.userAgent !== undefined ? { user_agent: edit.userAgent } : {}),
      proxy_url: edit.proxyUrl,
      priority: edit.priority,
      model_policy: edit.modelPolicy,
    };
    if (edit.name) await apiClient.patch('/credentials/gemini-enterprise-web', payload);
    else await apiClient.post('/credentials/gemini-enterprise-web', payload);
    guard();
  },
};
