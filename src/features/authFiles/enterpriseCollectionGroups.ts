import type { AuthFileItem, EnterpriseModelPolicyState } from '@/types/authFile';

const GROUP_ORDER = ['paid', 'trial', 'unknown'] as const;

export type EnterpriseCollectionGroupKind = (typeof GROUP_ORDER)[number];
export type EnterpriseCollectionGroup = {
  kind: EnterpriseCollectionGroupKind;
  files: AuthFileItem[];
};

export function enterpriseSubscriptionGroup(
  subscription?: EnterpriseModelPolicyState['subscription']
): EnterpriseCollectionGroupKind {
  if (!subscription || !['ok', 'stale'].includes(subscription.status)) return 'unknown';
  if (subscription.freeTrial === false) return 'paid';
  if (subscription.freeTrial === true) return 'trial';
  return 'unknown';
}

export function groupEnterpriseCollections(
  files: readonly AuthFileItem[]
): EnterpriseCollectionGroup[] {
  const groups: Record<EnterpriseCollectionGroupKind, AuthFileItem[]> = {
    paid: [],
    trial: [],
    unknown: [],
  };
  for (const file of files) {
    groups[enterpriseSubscriptionGroup(file.geminiEnterprise?.modelPolicyState?.subscription)].push(
      file
    );
  }
  return GROUP_ORDER.filter((kind) => groups[kind].length > 0).map((kind) => ({
    kind,
    files: groups[kind],
  }));
}

export function enterpriseSubscriptionUnknownReason(
  subscription?: EnterpriseModelPolicyState['subscription']
): string | undefined {
  if (enterpriseSubscriptionGroup(subscription) !== 'unknown') return undefined;
  if (subscription?.reason?.trim()) return subscription.reason.trim();
  switch (subscription?.status) {
    case 'unassigned':
      return 'license_unassigned';
    case 'inactive':
    case 'expired':
      return 'subscription_inactive';
    case 'conflict':
      return 'conflicting_subscriptions';
    case 'ok':
    case 'stale':
      return 'subscription_type_unknown';
    default:
      return 'subscription_unverified';
  }
}
