import type { AuthFileItem } from '@/types';

export const ENTERPRISE_REGIONS = ['global', 'us', 'eu', 'ca', 'au', 'in'] as const;
export const ENTERPRISE_RESOURCE_FIELDS = [
  'projectId',
  'location',
  'collectionId',
  'engineId',
  'assistantId',
] as const;
export type EnterpriseResources = Record<(typeof ENTERPRISE_RESOURCE_FIELDS)[number], string>;

export function enterpriseResources(
  binding: AuthFileItem['geminiEnterprise']
): EnterpriseResources {
  return {
    projectId: binding?.projectId?.trim() ?? '',
    location: binding?.location?.trim() || 'global',
    collectionId: binding?.collectionId?.trim() || 'default_collection',
    engineId: binding?.engineId?.trim() ?? '',
    assistantId: binding?.assistantId?.trim() || 'default_assistant',
  };
}

export function enterpriseRegionOptions(current: string) {
  const values: readonly string[] = ENTERPRISE_REGIONS.includes(
    current as (typeof ENTERPRISE_REGIONS)[number]
  )
    ? ENTERPRISE_REGIONS
    : [current, ...ENTERPRISE_REGIONS];
  return values.map((value) => ({ value, label: value }));
}

export function enterpriseRegionEndpoint(region: string): string {
  switch (region) {
    case 'us':
      return 'https://us-discoveryengine.googleapis.com';
    case 'eu':
      return 'https://eu-discoveryengine.googleapis.com';
    case 'ca':
      return 'https://ca-discoveryengine.googleapis.com';
    case 'au':
      return 'https://au-discoveryengine.googleapis.com';
    case 'in':
      return 'https://in-discoveryengine.googleapis.com';
    default:
      return 'https://discoveryengine.googleapis.com';
  }
}

export function sameEnterpriseResources(a: EnterpriseResources, b: EnterpriseResources) {
  return ENTERPRISE_RESOURCE_FIELDS.every((field) => a[field].trim() === b[field].trim());
}

export function validEnterpriseResources(value: EnterpriseResources) {
  return ENTERPRISE_RESOURCE_FIELDS.every((field) => /^[A-Za-z0-9_-]+$/.test(value[field].trim()));
}

export function serializeEnterpriseResources(value: EnterpriseResources) {
  return {
    project_id: value.projectId.trim(),
    location: value.location.trim(),
    collection_id: value.collectionId.trim(),
    engine_id: value.engineId.trim(),
    assistant_id: value.assistantId.trim(),
  };
}
