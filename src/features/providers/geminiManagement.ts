import type { GeminiKeyConfig } from '@/types';
import type {
  GeminiAliasRule,
  GeminiSnapshot,
  GeminiTarget,
} from '@/services/api/geminiManagement';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { geminiToResource } from './adapters';
import type { ProviderResource } from './types';

export const geminiTargetId = (target: GeminiTarget): string =>
  `${target.groupIndex}:${target.keyIndex ?? 'group'}`;

export const getGeminiTarget = (resource: ProviderResource): GeminiTarget | null => {
  const source = (resource.raw as GeminiKeyConfig).source;
  if (!source || source.keyIndex === undefined) return null;
  return { groupIndex: source.groupIndex, keyIndex: source.keyIndex };
};

export const geminiResourcesFromSnapshot = (snapshot: GeminiSnapshot): ProviderResource[] =>
  (normalizeProviderGroups(snapshot.groups) as GeminiKeyConfig[]).map(geminiToResource);

export const filterGeminiResources = (
  resources: ProviderResource[],
  group: string,
  status: 'all' | 'enabled' | 'disabled'
): ProviderResource[] =>
  resources.filter((resource) => {
    const target = getGeminiTarget(resource);
    return (
      (group === '' || String(target?.groupIndex) === group) &&
      (status === 'all' || resource.disabled === (status === 'disabled'))
    );
  });

export const paginateGeminiResources = <T>(items: T[], page: number, pageSize: number) => {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  return {
    currentPage,
    totalPages,
    pageItems: items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
  };
};

export const selectGeminiTargets = (
  selected: ReadonlySet<string>,
  resources: ProviderResource[]
): GeminiTarget[] =>
  resources.flatMap((resource) => {
    const target = getGeminiTarget(resource);
    return target && selected.has(geminiTargetId(target)) ? [target] : [];
  });

export const toGeminiGroupTargets = (targets: GeminiTarget[]): GeminiTarget[] =>
  Array.from(new Set(targets.map((target) => target.groupIndex)), (groupIndex) => ({ groupIndex }));

export const validateGeminiAliasDraft = (
  rules: GeminiAliasRule[]
): 'incomplete' | 'duplicate' | null => {
  const seen = new Set<string>();
  for (const rule of rules) {
    const name = rule.name.trim();
    const alias = rule.alias.trim();
    if (!name && !alias) continue;
    if (!name || !alias) return 'incomplete';
    const id = alias.toLowerCase();
    if (seen.has(id)) return 'duplicate';
    seen.add(id);
  }
  return null;
};

export const normalizeGeminiAliasDraft = (rules: GeminiAliasRule[]): GeminiAliasRule[] =>
  rules
    .filter((rule) => rule.name.trim() || rule.alias.trim())
    .map((rule) => ({ ...rule, name: rule.name.trim(), alias: rule.alias.trim() }));

export const getGeminiAliasDraftSignature = (rules: GeminiAliasRule[]): string =>
  JSON.stringify(
    rules
      .filter((rule) => rule.name || rule.alias || rule.fork === false)
      .map((rule) => ({ ...rule, fork: rule.fork === true }))
  );

export const getGeminiModelSource = (resource: ProviderResource): 'key' | 'group' | 'catalog' => {
  const source = (resource.raw as GeminiKeyConfig).source;
  const keys = source?.group.keys;
  const key = Array.isArray(keys) && source?.keyIndex !== undefined ? keys[source.keyIndex] : null;
  if (key && typeof key === 'object' && 'models' in key && key.models !== null) return 'key';
  return Array.isArray(source?.group.models) ? 'group' : 'catalog';
};
