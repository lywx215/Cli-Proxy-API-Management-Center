import type { EnterpriseModelPolicyMode, EnterpriseModelPolicyState } from '@/types/authFile';
import { isModelExcluded } from './constants';

export const ENTERPRISE_MODEL_POLICIES = [
  'auto',
  'catalog',
  'argon_only',
  'exclude_argon',
  'custom',
] as const;

export type EnterprisePolicyDraft = {
  mode: EnterpriseModelPolicyMode;
  whitelistEnabled: boolean;
  allowedText: string;
  touched: { mode: boolean; allowed: boolean };
};

export type EnterprisePolicyField =
  'enterpriseModelPolicy' | 'enterpriseWhitelistEnabled' | 'enterpriseAllowedModelsText';

export function readEnterprisePolicy(value: Record<string, unknown>): EnterprisePolicyDraft {
  const mode = ENTERPRISE_MODEL_POLICIES.find((entry) => entry === value.model_policy) ?? 'auto';
  return {
    mode,
    whitelistEnabled: Array.isArray(value.allowed_models),
    allowedText: Array.isArray(value.allowed_models)
      ? value.allowed_models
          .filter((entry): entry is string => typeof entry === 'string')
          .join('\n')
      : '',
    touched: { mode: false, allowed: false },
  };
}

export function enterprisePolicyRoutingPaused(snapshot?: EnterpriseModelPolicyState): boolean {
  return Boolean(
    snapshot &&
    (snapshot.status === 'blocked' ||
      (snapshot.mode === 'custom' && snapshot.allowedModels?.length === 0) ||
      (snapshot.catalogKnown && snapshot.effectiveModels.length === 0))
  );
}

export function parseEnterpriseAllowedModels(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ];
}

export function enterprisePolicyError(draft?: EnterprisePolicyDraft): string | null {
  if (!draft?.whitelistEnabled || !draft.touched.allowed) return null;
  return parseEnterpriseAllowedModels(draft.allowedText).some(
    (entry) => entry.includes(String.fromCharCode(0)) || /[*?\s(),/\\]/.test(entry)
  )
    ? 'gemini_enterprise.policy.invalid_allowed'
    : null;
}

export function buildEnterprisePolicyPatch(
  original: Record<string, unknown>,
  draft?: EnterprisePolicyDraft,
  supported = false
): { model_policy?: EnterpriseModelPolicyMode; allowed_models?: string[] | null } {
  if (!supported || !draft) return {};
  const patch: { model_policy?: EnterpriseModelPolicyMode; allowed_models?: string[] | null } = {};
  if (draft.touched.mode && draft.mode !== (original.model_policy ?? 'auto')) {
    patch.model_policy = draft.mode;
  }
  if (draft.touched.allowed) {
    const next = draft.whitelistEnabled ? parseEnterpriseAllowedModels(draft.allowedText) : null;
    if (JSON.stringify(next) !== JSON.stringify(original.allowed_models ?? null)) {
      patch.allowed_models = next;
    }
  }
  return patch;
}

export function enterprisePolicyHasChanges(
  original: Record<string, unknown>,
  draft?: EnterprisePolicyDraft,
  supported = false
): boolean {
  return (
    supported &&
    (Boolean(enterprisePolicyError(draft)) ||
      Object.keys(buildEnterprisePolicyPatch(original, draft, supported)).length > 0)
  );
}

export function enterprisePolicyPreview(
  draft: EnterprisePolicyDraft,
  snapshot: EnterpriseModelPolicyState | undefined,
  excluded: string[]
): string[] | null {
  const allowed = draft.whitelistEnabled ? parseEnterpriseAllowedModels(draft.allowedText) : null;
  if (draft.mode === 'custom' && allowed?.length === 0) return [];
  if (!snapshot) return null;
  let effective: string = draft.mode;
  if (draft.mode === 'auto') {
    const subscription = snapshot.subscription;
    if (subscription.status !== 'ok' && subscription.status !== 'stale') return [];
    effective = 'catalog';
    if (subscription.freeTrial === true) {
      if (subscription.edition === 'business_standard') effective = 'argon_only';
      if (subscription.edition === 'enterprise_plus') effective = 'exclude_argon';
    }
  }
  if (!snapshot.catalogKnown) return null;
  excluded = [...excluded, ...snapshot.globalExcludedModels];
  return snapshot.catalogModels
    .map((entry) => entry.id)
    .filter((id) => {
      if (effective === 'argon_only' && id !== 'gemini-4-argon') return false;
      if (effective === 'exclude_argon' && id === 'gemini-4-argon') return false;
      if (effective === 'custom' && allowed && !allowed.includes(id)) return false;
      if (
        (effective === 'argon_only' ||
          effective === 'exclude_argon' ||
          (effective === 'custom' && allowed) ||
          excluded.length > 0) &&
        /^(?:auto|default)$|^auto-|-auto$/i.test(id)
      )
        return false;
      return !isModelExcluded(id, 'gemini-enterprise', { 'gemini-enterprise': excluded });
    });
}
