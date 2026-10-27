import type { EnterpriseModelPolicyState } from '@/types/authFile';

type EnterpriseSubscriptionTone = 'business-trial' | 'plus-trial' | 'paid';

export function enterpriseSubscriptionTone(
  subscription?: EnterpriseModelPolicyState['subscription']
): EnterpriseSubscriptionTone | undefined {
  if (!subscription || !['ok', 'stale'].includes(subscription.status)) return undefined;
  if (subscription.freeTrial === false) return 'paid';
  if (subscription.freeTrial !== true) return undefined;
  if (subscription.edition === 'business_standard') return 'business-trial';
  if (subscription.edition === 'enterprise_plus') return 'plus-trial';
  return undefined;
}
