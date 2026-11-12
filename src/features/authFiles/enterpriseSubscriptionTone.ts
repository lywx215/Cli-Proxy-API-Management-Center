import type { EnterpriseModelPolicyState } from '@/types/authFile';
import { enterpriseSubscriptionGroup } from './enterpriseCollectionGroups';

type EnterpriseSubscriptionTone = 'business-trial' | 'plus-trial' | 'paid';

export function enterpriseSubscriptionTone(
  subscription?: EnterpriseModelPolicyState['subscription']
): EnterpriseSubscriptionTone | undefined {
  const group = enterpriseSubscriptionGroup(subscription);
  if (group === 'paid') return 'paid';
  if (group !== 'trial' || !subscription) return undefined;
  if (subscription.edition === 'business_standard') return 'business-trial';
  if (subscription.edition === 'enterprise_plus') return 'plus-trial';
  return undefined;
}
