import type { AuthFileItem } from '@/types';
import type { EnterpriseCredentialLifetime } from '@/types/authFile';
import { enterpriseResources, serializeEnterpriseResources } from './enterpriseResources';

export function enterpriseCollectionIdentity(file: AuthFileItem): string {
  const binding = file.geminiEnterprise;
  return JSON.stringify([
    file.name,
    binding?.accountId ?? '',
    binding?.bindingId ?? '',
    binding?.revision ?? null,
    String(file.authIndex ?? ''),
    serializeEnterpriseResources(enterpriseResources(binding)),
  ]);
}

export function enterpriseCollectionFiles(parent: AuthFileItem): AuthFileItem[] {
  const account = parent.geminiEnterprise;
  if (!account) return [];
  if (!account.collections) return account.engineId ? [parent] : [];
  return account.collections.map((collection) => ({
    ...collection.settings,
    name: parent.name,
    type: parent.type || parent.provider,
    email: parent.email,
    authIndex: collection.authIndex,
    disabled: collection.disabled,
    unavailable: collection.unavailable || collection.missing,
    status: collection.status,
    statusMessage: collection.statusMessage,
    successCount: collection.successCount,
    failureCount: collection.failureCount,
    recentRequests: collection.recentRequests,
    cooldownSnapshot: collection.cooldownSnapshot,
    geminiEnterprise: {
      ...account,
      ...collection,
      collections: undefined,
      effectiveDisabled: parent.disabled === true || collection.effectiveDisabled,
      accountAuthIndex: String(parent.authIndex ?? ''),
      accountRevision: account.revision,
    },
  }));
}

export function enterpriseCollectionName(file: AuthFileItem): string {
  const binding = file.geminiEnterprise;
  return [
    binding?.projectName || binding?.projectId,
    binding?.collectionId && binding.collectionId !== 'default_collection'
      ? binding.collectionId
      : '',
  ]
    .filter(Boolean)
    .join(' / ');
}

export function enterpriseCredentialLifetimeHours(
  lifetime: EnterpriseCredentialLifetime,
  clientNow: number
): number {
  const elapsed =
    Date.parse(lifetime.serverTime) -
    Date.parse(lifetime.startedAt) +
    Math.max(0, clientNow - lifetime.receivedAtMs);
  return Math.floor(elapsed / 3_600_000);
}
