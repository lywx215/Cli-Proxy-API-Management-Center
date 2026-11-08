import type { AuthFileItem, GeminiEnterpriseAccount } from '@/types';
import type { GoogleCarbonConfigureResult } from '@/services/api/enterpriseCarbon';
import type { ModelTestResult } from './modelTesting';
import { enterpriseCollectionFiles, enterpriseCollectionIdentity } from './enterpriseAccounts';
import { enterpriseCarbonAdmission } from './enterpriseCarbon';
import { enterpriseCarbonAccountIdentity } from './enterpriseCarbonOperations';

export type CarbonOperationRow = {
  file: AuthFileItem;
  state: 'pending' | 'running' | 'done' | 'cancelled';
  configure?: GoogleCarbonConfigureResult;
  test?: ModelTestResult;
  reason?: string;
  saving?: boolean;
  saveFailed?: boolean;
  saveRequestedEnabled?: boolean;
};

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, ordered(source[key])])
    );
  }
  return value;
}

function accountRevision(file: AuthFileItem): number | undefined {
  return file.geminiEnterprise?.bindingId
    ? file.geminiEnterprise.accountRevision
    : file.geminiEnterprise?.revision;
}

export function carbonAuthorizationIdentity(file: AuthFileItem): string {
  const account = file.geminiEnterprise;
  const fenced =
    account?.carbonAuthorizationRevision !== undefined &&
    account.carbonRegistrationEpoch !== undefined;
  return JSON.stringify(
    ordered([
      file.name,
      file.type || file.provider,
      account?.accountAuthIndex ?? String(file.authIndex ?? ''),
      account?.accountId,
      file.email,
      account?.clientId,
      account?.hasRefreshToken,
      account?.carbonAuthorizationRevision,
      account?.carbonRegistrationEpoch,
      // An older backend cannot distinguish a proof write from a reauthorization.
      fenced ? undefined : accountRevision(file),
    ])
  );
}

export function carbonApplicationConfigurationIdentity(file: AuthFileItem): string {
  const policy = file.geminiEnterprise?.modelPolicyState;
  const subscription = policy?.subscription;
  return JSON.stringify(
    ordered([
      carbonAuthorizationIdentity(file),
      enterpriseCollectionIdentity(file),
      Boolean(file.disabled),
      Boolean(file.geminiEnterprise?.effectiveDisabled),
      Boolean(file.geminiEnterprise?.missing),
      file.geminiEnterprise?.settings &&
        Object.fromEntries(
          Object.entries(file.geminiEnterprise.settings).filter(
            ([key]) =>
              ![
                'carbon_enabled',
                'carbon_test_evidence',
                'enterprise_carbon_evidence',
                'carbon_admission',
                'carbon_admission_supported',
                'model_policy_state',
                'carbon_authorization_revision',
                'carbon_registration_epoch',
              ].includes(key)
          )
        ),
      policy && {
        mode: policy.mode,
        effectiveMode: policy.effectiveMode,
        allowedModels: policy.allowedModels,
        excludedModels: policy.excludedModels,
        globalExcludedModels: policy.globalExcludedModels,
        enforcedAllowedModels: policy.enforcedAllowedModels,
        enforcedExcludedModels: policy.enforcedExcludedModels,
        enforcedReason: policy.enforcedReason,
        imageGenerationDisabled: policy.imageGenerationDisabled,
        subscription: subscription && {
          status:
            subscription.status === 'ok' || subscription.status === 'stale'
              ? 'confirmed'
              : subscription.status,
          edition: subscription.edition,
          freeTrial: subscription.freeTrial,
          state: subscription.state,
          reason:
            subscription.status === 'ok' || subscription.status === 'stale'
              ? undefined
              : subscription.reason,
        },
      },
    ])
  );
}

export function carbonApplicationPermissionIdentity(file: AuthFileItem): string {
  const admission = enterpriseCarbonAdmission(file);
  const invalidReason = [
    'configuration_changed',
    'binding_changed',
    'authorization_changed',
    'carbon_configuration_changed',
    'carbon_binding_changed',
    'carbon_authorization_changed',
  ].includes(admission?.reason ?? '')
    ? admission?.reason
    : admission?.test?.status === 'verified' && admission.canTest && !admission.canEnable
      ? 'evidence_invalid'
      : undefined;
  return JSON.stringify([
    carbonApplicationConfigurationIdentity(file),
    admission?.canTest,
    admission?.canTest ? invalidReason : admission?.reason,
  ]);
}

export function carbonOperationScopeIdentity(
  file: AuthFileItem,
  mode: 'configure' | 'test'
): string {
  return JSON.stringify([
    carbonAuthorizationIdentity(file),
    Boolean(file.disabled),
    mode === 'configure' ? enterpriseCarbonAccountIdentity(file) : undefined,
    enterpriseCollectionFiles(file)
      .map((child) => [
        child.geminiEnterprise?.bindingId,
        carbonApplicationPermissionIdentity(child),
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  ]);
}

export function olderCarbonAccountSnapshot(current: AuthFileItem, incoming: AuthFileItem): boolean {
  if (
    current.name !== incoming.name ||
    String(current.authIndex) !== String(incoming.authIndex) ||
    current.geminiEnterprise?.accountId !== incoming.geminiEnterprise?.accountId
  )
    return false;
  const previous = current.geminiEnterprise;
  const next = incoming.geminiEnterprise;
  // Runtime fences have no ordering across service restarts.
  if (
    previous?.carbonRegistrationEpoch !== next?.carbonRegistrationEpoch ||
    previous?.carbonAuthorizationRevision !== next?.carbonAuthorizationRevision ||
    current.email !== incoming.email ||
    previous?.clientId !== next?.clientId
  )
    return false;
  const before = accountRevision(current),
    after = accountRevision(incoming);
  return before !== undefined && after !== undefined && after < before;
}

function olderEvidence(current: AuthFileItem, incoming: AuthFileItem): boolean {
  const before = enterpriseCarbonAdmission(current)?.test;
  const after = enterpriseCarbonAdmission(incoming)?.test;
  if (!before || before.testId === after?.testId) return false;
  return !after || Date.parse(after.checkedAt) < Date.parse(before.checkedAt);
}

function explicitCarbonInvalidation(file: AuthFileItem): boolean {
  return [
    'configuration_changed',
    'binding_changed',
    'authorization_changed',
    'carbon_configuration_changed',
    'carbon_binding_changed',
    'carbon_authorization_changed',
  ].includes(enterpriseCarbonAdmission(file)?.reason ?? '');
}

export function protectCarbonAccountEvidence(
  current: AuthFileItem,
  incoming: AuthFileItem
): AuthFileItem {
  if (carbonAuthorizationIdentity(current) !== carbonAuthorizationIdentity(incoming))
    return incoming;
  const previous = new Map(
    enterpriseCollectionFiles(current).map((child) => [child.geminiEnterprise?.bindingId, child])
  );
  const retained = new Map<string, AuthFileItem>();
  enterpriseCollectionFiles(incoming).forEach((child) => {
    const before = previous.get(child.geminiEnterprise?.bindingId);
    if (
      before &&
      carbonApplicationConfigurationIdentity(before) ===
        carbonApplicationConfigurationIdentity(child) &&
      !explicitCarbonInvalidation(child) &&
      olderEvidence(before, child)
    )
      retained.set(child.geminiEnterprise?.bindingId ?? '', before);
  });
  if (!retained.size) return incoming;
  const account = incoming.geminiEnterprise!;
  const withEvidence = (value: GeminiEnterpriseAccount, before: AuthFileItem) => ({
    ...value,
    carbonAdmissionSupported: before.geminiEnterprise?.carbonAdmissionSupported,
    carbonAdmission: enterpriseCarbonAdmission(before),
    modelPolicyState: value.modelPolicyState
      ? {
          ...value.modelPolicyState,
          carbonAdmissionSupported: before.geminiEnterprise?.carbonAdmissionSupported,
          carbonAdmission: enterpriseCarbonAdmission(before),
        }
      : undefined,
  });
  if (!account.collections)
    return {
      ...incoming,
      geminiEnterprise: withEvidence(account, retained.values().next().value!),
    };
  return {
    ...incoming,
    geminiEnterprise: {
      ...account,
      collections: account.collections.map((child) =>
        retained.has(child.bindingId)
          ? { ...child, ...withEvidence(child, retained.get(child.bindingId)!) }
          : child
      ),
    },
  };
}

export function mergeCarbonTestResult(
  current: AuthFileItem,
  target: AuthFileItem,
  result: ModelTestResult
): AuthFileItem {
  if (!result.carbonAdmission || result.carbonAdmissionSupported !== true) return current;
  const latest = enterpriseCollectionFiles(current).find(
    (child) => child.geminiEnterprise?.bindingId === target.geminiEnterprise?.bindingId
  );
  if (
    !latest ||
    carbonApplicationPermissionIdentity(latest) !== carbonApplicationPermissionIdentity(target)
  )
    return current;
  const returned = {
    ...latest,
    geminiEnterprise: { ...latest.geminiEnterprise, carbonAdmission: result.carbonAdmission },
  };
  if (olderEvidence(latest, returned)) return current;
  const update = (account: GeminiEnterpriseAccount) => ({
    ...account,
    carbonAdmissionSupported: true,
    carbonAdmission: result.carbonAdmission,
    modelPolicyState: account.modelPolicyState
      ? {
          ...account.modelPolicyState,
          carbonAdmissionSupported: true,
          carbonAdmission: result.carbonAdmission,
        }
      : undefined,
  });
  const account = current.geminiEnterprise!;
  if (!account.collections) return { ...current, geminiEnterprise: update(account) };
  return {
    ...current,
    geminiEnterprise: {
      ...account,
      collections: account.collections.map((child) =>
        child.bindingId === target.geminiEnterprise?.bindingId
          ? { ...child, ...update(child) }
          : child
      ),
    },
  };
}

export function confirmedCarbonSwitch(
  target: AuthFileItem,
  current: AuthFileItem,
  enabled: boolean
): boolean {
  const revision = target.geminiEnterprise?.revision;
  if (
    revision === undefined ||
    current.geminiEnterprise?.revision !== revision + 1 ||
    enterpriseCarbonAdmission(current)?.enabled !== enabled
  )
    return false;
  if (
    enabled &&
    enterpriseCarbonAdmission(current)?.test?.testId !==
      enterpriseCarbonAdmission(target)?.test?.testId
  )
    return false;
  const expected = {
    ...target,
    geminiEnterprise: { ...target.geminiEnterprise, revision: current.geminiEnterprise.revision },
  };
  return (
    carbonApplicationPermissionIdentity(expected) === carbonApplicationPermissionIdentity(current)
  );
}

function unavailableRowFile(file: AuthFileItem): AuthFileItem {
  const admission = enterpriseCarbonAdmission(file);
  return {
    ...file,
    geminiEnterprise: {
      ...file.geminiEnterprise,
      carbonAdmission: admission
        ? {
            ...admission,
            available: false,
            canTest: false,
            canEnable: false,
            reason: 'binding_changed',
          }
        : undefined,
    },
  };
}

export function synchronizeCarbonOperationRows(
  rows: CarbonOperationRow[],
  previous: AuthFileItem,
  current: AuthFileItem,
  confirmedBindings: ReadonlySet<string> = new Set()
): CarbonOperationRow[] {
  const authorizationChanged =
    carbonAuthorizationIdentity(previous) !== carbonAuthorizationIdentity(current) ||
    Boolean(previous.disabled) !== Boolean(current.disabled);
  const children = new Map(
    enterpriseCollectionFiles(current).map((child) => [child.geminiEnterprise?.bindingId, child])
  );
  return rows.map((row) => {
    const key = row.file.geminiEnterprise?.bindingId ?? '';
    const latest = children.get(key);
    const confirmed =
      latest &&
      !authorizationChanged &&
      (confirmedBindings.has(key) ||
        (row.saveRequestedEnabled !== undefined &&
          confirmedCarbonSwitch(row.file, latest, row.saveRequestedEnabled)));
    const changed =
      authorizationChanged ||
      !latest ||
      (!confirmed &&
        carbonApplicationPermissionIdentity(row.file) !==
          carbonApplicationPermissionIdentity(latest));
    if (changed)
      return {
        ...row,
        file: latest ?? unavailableRowFile(row.file),
        state: 'cancelled',
        test: undefined,
        configure: row.configure
          ? { ...row.configure, status: 'changed', reason: 'credential_changed' }
          : undefined,
        reason: 'application_changed',
        saving: false,
        saveRequestedEnabled: undefined,
        saveFailed: row.saving ? true : row.saveFailed,
      };
    return { ...row, file: latest, ...(confirmed ? { saveFailed: false } : {}) };
  });
}
