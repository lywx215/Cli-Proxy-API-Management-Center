import type { AuthFileItem, GeminiEnterpriseAccount } from '@/types';
import type { GoogleHydrogenConfigureResult } from '@/services/api/enterpriseHydrogen';
import type { ModelTestResult } from './modelTesting';
import { enterpriseCollectionFiles, enterpriseCollectionIdentity } from './enterpriseAccounts';
import { enterpriseHydrogenAdmission } from './enterpriseHydrogen';
import { enterpriseHydrogenAccountIdentity } from './enterpriseHydrogenOperations';

export type HydrogenOperationRow = {
  file: AuthFileItem;
  state: 'pending' | 'running' | 'done' | 'cancelled';
  configure?: GoogleHydrogenConfigureResult;
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

export function hydrogenAuthorizationIdentity(file: AuthFileItem): string {
  const account = file.geminiEnterprise;
  const fenced =
    account?.hydrogenAuthorizationRevision !== undefined &&
    account.hydrogenRegistrationEpoch !== undefined;
  return JSON.stringify(
    ordered([
      file.name,
      file.type || file.provider,
      account?.accountAuthIndex ?? String(file.authIndex ?? ''),
      account?.accountId,
      file.email,
      account?.clientId,
      account?.hasRefreshToken,
      account?.hydrogenAuthorizationRevision,
      account?.hydrogenRegistrationEpoch,
      // An older backend cannot distinguish a proof write from a reauthorization.
      fenced ? undefined : accountRevision(file),
    ])
  );
}

export function hydrogenApplicationConfigurationIdentity(file: AuthFileItem): string {
  const policy = file.geminiEnterprise?.modelPolicyState;
  const subscription = policy?.subscription;
  return JSON.stringify(
    ordered([
      hydrogenAuthorizationIdentity(file),
      enterpriseCollectionIdentity(file),
      Boolean(file.disabled),
      Boolean(file.geminiEnterprise?.effectiveDisabled),
      Boolean(file.geminiEnterprise?.missing),
      file.geminiEnterprise?.settings &&
        Object.fromEntries(
          Object.entries(file.geminiEnterprise.settings).filter(
            ([key]) =>
              ![
                'hydrogen_enabled',
                'hydrogen_test_evidence',
                'enterprise_hydrogen_evidence',
                'hydrogen_admission',
                'hydrogen_admission_supported',
                'model_policy_state',
                'hydrogen_authorization_revision',
                'hydrogen_registration_epoch',
              ].includes(key)
          )
        ),
      policy && {
        mode: policy.mode,
        effectiveMode: policy.effectiveMode,
        allModelsEnabled: policy.allModelsEnabled,
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

export function hydrogenApplicationPermissionIdentity(file: AuthFileItem): string {
  const admission = enterpriseHydrogenAdmission(file);
  const invalidReason = [
    'configuration_changed',
    'binding_changed',
    'authorization_changed',
    'hydrogen_configuration_changed',
    'hydrogen_binding_changed',
    'hydrogen_authorization_changed',
  ].includes(admission?.reason ?? '')
    ? admission?.reason
    : admission?.test?.status === 'verified' && admission.canTest && !admission.canEnable
      ? 'evidence_invalid'
      : undefined;
  return JSON.stringify([
    hydrogenApplicationConfigurationIdentity(file),
    admission?.canTest,
    admission?.canTest ? invalidReason : admission?.reason,
  ]);
}

export function hydrogenOperationScopeIdentity(
  file: AuthFileItem,
  mode: 'configure' | 'test'
): string {
  return JSON.stringify([
    hydrogenAuthorizationIdentity(file),
    Boolean(file.disabled),
    mode === 'configure' ? enterpriseHydrogenAccountIdentity(file) : undefined,
    enterpriseCollectionFiles(file)
      .map((child) => [
        child.geminiEnterprise?.bindingId,
        hydrogenApplicationPermissionIdentity(child),
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  ]);
}

export function olderHydrogenAccountSnapshot(current: AuthFileItem, incoming: AuthFileItem): boolean {
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
    previous?.hydrogenRegistrationEpoch !== next?.hydrogenRegistrationEpoch ||
    previous?.hydrogenAuthorizationRevision !== next?.hydrogenAuthorizationRevision ||
    current.email !== incoming.email ||
    previous?.clientId !== next?.clientId
  )
    return false;
  const before = accountRevision(current),
    after = accountRevision(incoming);
  return before !== undefined && after !== undefined && after < before;
}

function olderEvidence(current: AuthFileItem, incoming: AuthFileItem): boolean {
  const before = enterpriseHydrogenAdmission(current)?.test;
  const after = enterpriseHydrogenAdmission(incoming)?.test;
  if (!before || before.testId === after?.testId) return false;
  return !after || Date.parse(after.checkedAt) < Date.parse(before.checkedAt);
}

function explicitHydrogenInvalidation(file: AuthFileItem): boolean {
  return [
    'configuration_changed',
    'binding_changed',
    'authorization_changed',
    'hydrogen_configuration_changed',
    'hydrogen_binding_changed',
    'hydrogen_authorization_changed',
  ].includes(enterpriseHydrogenAdmission(file)?.reason ?? '');
}

export function protectHydrogenAccountEvidence(
  current: AuthFileItem,
  incoming: AuthFileItem
): AuthFileItem {
  if (hydrogenAuthorizationIdentity(current) !== hydrogenAuthorizationIdentity(incoming))
    return incoming;
  const previous = new Map(
    enterpriseCollectionFiles(current).map((child) => [child.geminiEnterprise?.bindingId, child])
  );
  const retained = new Map<string, AuthFileItem>();
  enterpriseCollectionFiles(incoming).forEach((child) => {
    const before = previous.get(child.geminiEnterprise?.bindingId);
    if (
      before &&
      hydrogenApplicationConfigurationIdentity(before) ===
        hydrogenApplicationConfigurationIdentity(child) &&
      !explicitHydrogenInvalidation(child) &&
      olderEvidence(before, child)
    )
      retained.set(child.geminiEnterprise?.bindingId ?? '', before);
  });
  if (!retained.size) return incoming;
  const account = incoming.geminiEnterprise!;
  const withEvidence = (value: GeminiEnterpriseAccount, before: AuthFileItem) => ({
    ...value,
    hydrogenAdmissionSupported: before.geminiEnterprise?.hydrogenAdmissionSupported,
    hydrogenAdmission: enterpriseHydrogenAdmission(before),
    modelPolicyState: value.modelPolicyState
      ? {
          ...value.modelPolicyState,
          hydrogenAdmissionSupported: before.geminiEnterprise?.hydrogenAdmissionSupported,
          hydrogenAdmission: enterpriseHydrogenAdmission(before),
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

export function mergeHydrogenTestResult(
  current: AuthFileItem,
  target: AuthFileItem,
  result: ModelTestResult
): AuthFileItem {
  if (!result.hydrogenAdmission || result.hydrogenAdmissionSupported !== true) return current;
  const latest = enterpriseCollectionFiles(current).find(
    (child) => child.geminiEnterprise?.bindingId === target.geminiEnterprise?.bindingId
  );
  if (
    !latest ||
    hydrogenApplicationPermissionIdentity(latest) !== hydrogenApplicationPermissionIdentity(target)
  )
    return current;
  const returned = {
    ...latest,
    geminiEnterprise: { ...latest.geminiEnterprise, hydrogenAdmission: result.hydrogenAdmission },
  };
  if (olderEvidence(latest, returned)) return current;
  const update = (account: GeminiEnterpriseAccount) => ({
    ...account,
    hydrogenAdmissionSupported: true,
    hydrogenAdmission: result.hydrogenAdmission,
    modelPolicyState: account.modelPolicyState
      ? {
          ...account.modelPolicyState,
          hydrogenAdmissionSupported: true,
          hydrogenAdmission: result.hydrogenAdmission,
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

export function confirmedHydrogenSwitch(
  target: AuthFileItem,
  current: AuthFileItem,
  enabled: boolean
): boolean {
  const revision = target.geminiEnterprise?.revision;
  if (
    revision === undefined ||
    current.geminiEnterprise?.revision !== revision + 1 ||
    enterpriseHydrogenAdmission(current)?.enabled !== enabled
  )
    return false;
  if (
    enabled &&
    enterpriseHydrogenAdmission(current)?.test?.testId !==
      enterpriseHydrogenAdmission(target)?.test?.testId
  )
    return false;
  const expected = {
    ...target,
    geminiEnterprise: { ...target.geminiEnterprise, revision: current.geminiEnterprise.revision },
  };
  return (
    hydrogenApplicationPermissionIdentity(expected) === hydrogenApplicationPermissionIdentity(current)
  );
}

function unavailableRowFile(file: AuthFileItem): AuthFileItem {
  const admission = enterpriseHydrogenAdmission(file);
  return {
    ...file,
    geminiEnterprise: {
      ...file.geminiEnterprise,
      hydrogenAdmission: admission
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

export function synchronizeHydrogenOperationRows(
  rows: HydrogenOperationRow[],
  previous: AuthFileItem,
  current: AuthFileItem,
  confirmedBindings: ReadonlySet<string> = new Set()
): HydrogenOperationRow[] {
  const authorizationChanged =
    hydrogenAuthorizationIdentity(previous) !== hydrogenAuthorizationIdentity(current) ||
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
          confirmedHydrogenSwitch(row.file, latest, row.saveRequestedEnabled)));
    const changed =
      authorizationChanged ||
      !latest ||
      (!confirmed &&
        hydrogenApplicationPermissionIdentity(row.file) !==
          hydrogenApplicationPermissionIdentity(latest));
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
