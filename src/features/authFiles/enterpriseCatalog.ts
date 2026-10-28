import type { EnterpriseModelPolicyState, GeminiEnterpriseAccount } from '@/types/authFile';
import { isRecord } from '@/utils/helpers';
import { enterprisePolicyPreview, type EnterprisePolicyDraft } from './enterpriseModelPolicy';

export type EnterpriseCatalogFallback = {
  mode: 'default' | 'custom' | 'disabled';
  models: string[];
};
export type EnterpriseCatalogDraft = {
  mode: EnterpriseCatalogFallback['mode'];
  text: string;
  touched: boolean;
};
export type EnterpriseCatalogField = 'enterpriseCatalogMode' | 'enterpriseCatalogModels';
export const ENTERPRISE_TRIAL_CATALOG = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
];
export const ENTERPRISE_MEDIA_CATALOG = ['gemini-3-pro-image', 'veo-3.1'];

export function catalogModelIDs(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]+/)
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
}

export function readEnterpriseCatalog(value: Record<string, unknown>): EnterpriseCatalogDraft {
  const raw = isRecord(value.catalog_fallback) ? value.catalog_fallback : {};
  return {
    mode: raw.mode === 'custom' || raw.mode === 'disabled' ? raw.mode : 'default',
    text: Array.isArray(raw.models)
      ? raw.models.filter((id): id is string => typeof id === 'string').join('\n')
      : '',
    touched: false,
  };
}

export function enterpriseCatalogError(draft?: EnterpriseCatalogDraft): string | null {
  if (!draft?.touched) return null;
  const ids = catalogModelIDs(draft.text);
  return ids.length > 256 ||
    ids.some(
      (id) =>
        id.length > 128 ||
        !/^(?:gemini|veo)-[a-z0-9][a-z0-9._-]*$/.test(id) ||
        /(?:^auto-|\bauto$)/i.test(id) ||
        ((id.startsWith('veo-') || id.includes('image')) && !ENTERPRISE_MEDIA_CATALOG.includes(id))
    )
    ? 'gemini_enterprise.catalog.invalid'
    : null;
}

export function buildEnterpriseCatalogPatch(
  original: Record<string, unknown>,
  draft?: EnterpriseCatalogDraft,
  supported = false
): { catalog_fallback?: EnterpriseCatalogFallback } {
  if (!supported || !draft?.touched) return {};
  const value = { mode: draft.mode, models: catalogModelIDs(draft.text) };
  const previous = readEnterpriseCatalog(original);
  return JSON.stringify(value) ===
    JSON.stringify({ mode: previous.mode, models: catalogModelIDs(previous.text) })
    ? {}
    : { catalog_fallback: value };
}

export function enterpriseDefaultCatalog(snapshot?: EnterpriseModelPolicyState): string[] {
  const sub = snapshot?.subscription;
  if (!sub || !['ok', 'stale'].includes(sub.status) || sub.freeTrial === null) return [];
  return sub.freeTrial === false || sub.edition === 'business_standard'
    ? ['gemini-4-argon']
    : [...ENTERPRISE_TRIAL_CATALOG];
}

export function enterpriseCatalogPreview(
  draft: EnterpriseCatalogDraft,
  policy: EnterprisePolicyDraft,
  snapshot: EnterpriseModelPolicyState | undefined,
  excluded: string[]
): string[] | null {
  if (!snapshot) return null;
  if (snapshot.catalogState?.source === 'upstream' || snapshot.catalogState?.source === 'cached')
    return enterprisePolicyPreview(policy, snapshot, excluded);
  const ids =
    draft.mode === 'default'
      ? enterpriseDefaultCatalog(snapshot)
      : draft.mode === 'custom'
        ? catalogModelIDs(draft.text)
        : [];
  return enterprisePolicyPreview(
    policy,
    {
      ...snapshot,
      catalogKnown: true,
      catalogModels: ids
        .filter((id) => !(id === 'gemini-3-pro-image' && snapshot.imageGenerationDisabled))
        .map((id) => ({ id, allowed: true })),
    },
    excluded
  );
}

export function enterpriseDiscoveryGroups(account?: GeminiEnterpriseAccount) {
  const groups = new Map<
    string,
    {
      project: string;
      name?: string;
      errors: { code: string; service?: string; consumerProject?: string; regions: string[] }[];
    }
  >();
  for (const project of account?.discovery?.projects ?? [])
    groups.set(project.id, { project: project.id, name: project.name, errors: [] });
  for (const warning of account?.discovery?.warnings ?? []) {
    const id = warning.project ?? '';
    const group = groups.get(id) ?? { project: id, errors: [] };
    const code = warning.code ?? 'discovery_failed';
    let error = group.errors.find(
      (entry) =>
        entry.code === code &&
        entry.service === warning.service &&
        entry.consumerProject === warning.consumerProject
    );
    if (!error) {
      error = {
        code,
        service: warning.service,
        consumerProject: warning.consumerProject,
        regions: [],
      };
      group.errors.push(error);
    }
    if (warning.location && !error.regions.includes(warning.location))
      error.regions.push(warning.location);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.project.localeCompare(b.project));
}
