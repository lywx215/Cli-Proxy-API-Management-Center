import { describe, expect, test } from 'bun:test';
import type { AuthFileItem } from '@/types';
import {
  normalizeEnterpriseAccount,
  normalizeEnterpriseCarbonAdmission,
} from '@/services/api/enterpriseAccounts';
import { enterpriseCollectionFiles } from '@/features/authFiles/enterpriseAccounts';
import {
  enterpriseCarbonAdmission,
  enterpriseCarbonTargetIdentity,
} from '@/features/authFiles/enterpriseCarbon';
import { modelTestIdentity, type ModelTestResult } from '@/features/authFiles/modelTesting';
import { runCarbonApplicationTests } from '@/features/authFiles/enterpriseCarbonOperations';
import {
  carbonApplicationPermissionIdentity,
  carbonOperationScopeIdentity,
  confirmedCarbonSwitch,
  mergeCarbonTestResult,
  olderCarbonAccountSnapshot,
  protectCarbonAccountEvidence,
  synchronizeCarbonOperationRows,
  type CarbonOperationRow,
} from '@/features/authFiles/enterpriseCarbonOperationState';

const carbon = 'gemini-4-carbon';
function proof(id: string, minute = 1) {
  return {
    test_id: id,
    status: 'verified',
    http_status: 200,
    checked_at: `2026-11-07T15:${String(minute).padStart(2, '0')}:00Z`,
    upstream_model: carbon,
  };
}
function parent(count = 18): AuthFileItem {
  return {
    name: 'synthetic.json',
    type: 'gemini-enterprise',
    authIndex: 'root-index',
    email: 'synthetic@example.test',
    geminiEnterprise: normalizeEnterpriseAccount({
      account_id: 'account',
      revision: 10,
      client_id: 'client',
      has_refresh_token: true,
      carbon_authorization_revision: 0,
      carbon_registration_epoch: 22,
      carbon_admission_supported: true,
      collections: Array.from({ length: count }, (_, index) => ({
        binding_id: `binding-${index}`,
        auth_index: `index-${index}`,
        revision: 3,
        project_id: '123',
        location: 'global',
        collection_id: 'default_collection',
        engine_id: `app-${index}`,
        assistant_id: 'default_assistant',
        settings: { model_policy: 'catalog', priority: 1 },
        carbon_admission_supported: true,
        carbon_admission: {
          enabled: false,
          available: false,
          can_test: true,
          can_enable: false,
          reason: 'carbon_disabled',
        },
        model_policy_state: {
          mode: 'catalog',
          effective_mode: 'catalog',
          status: 'ok',
          catalog_known: true,
          allowed_models: null,
          excluded_models: [],
          global_excluded_models: [],
          enforced_allowed_models: ['gemini-4-argon', carbon, 'gemini-3-pro-image', 'veo-3.1'],
          effective_models: ['gemini-4-argon'],
          catalog_models: [{ id: 'gemini-4-argon', allowed: true }],
          subscription: {
            status: 'ok',
            edition: 'enterprise_plus',
            free_trial: false,
            state: 'ACTIVE',
          },
        },
      })),
    })!,
  };
}
function copy(file: AuthFileItem): AuthFileItem {
  return structuredClone(file);
}
function initialRows(file: AuthFileItem): CarbonOperationRow[] {
  return enterpriseCollectionFiles(file).map((child) => ({ file: child, state: 'pending' }));
}
function result(file: AuthFileItem, minute = 2): ModelTestResult {
  const id = `proof-${file.geminiEnterprise?.bindingId}-${minute}`;
  return {
    status: 'ok',
    model: carbon,
    authIndex: String(file.authIndex),
    checkedAt: proof(id, minute).checked_at,
    elapsedMs: 1,
    httpStatus: 200,
    bindingId: file.geminiEnterprise?.bindingId,
    expectedRevision: file.geminiEnterprise?.revision,
    revision: file.geminiEnterprise?.revision,
    carbonAdmissionSupported: true,
    carbonTestId: id,
    carbonAdmission: normalizeEnterpriseCarbonAdmission({
      enabled: false,
      available: false,
      can_test: true,
      can_enable: true,
      reason: 'carbon_disabled',
      test: proof(id, minute),
    }),
  };
}
function tested(count = 18): { account: AuthFileItem; rows: CarbonOperationRow[] } {
  let account = parent(count),
    rows = initialRows(account);
  for (const child of enterpriseCollectionFiles(account)) {
    const returned = result(child);
    const previous = account;
    account = mergeCarbonTestResult(account, child, returned);
    rows = synchronizeCarbonOperationRows(rows, previous, account).map((row) =>
      row.file.geminiEnterprise?.bindingId === child.geminiEnterprise?.bindingId
        ? { ...row, state: 'done', test: returned, reason: 'ok' }
        : row
    );
  }
  account.geminiEnterprise!.revision = 10 + count;
  rows = synchronizeCarbonOperationRows(rows, account, account);
  return { account, rows };
}
function switched(file: AuthFileItem, index = 0): AuthFileItem {
  const next = copy(file),
    account = next.geminiEnterprise!;
  account.revision! += 1;
  const child = account.collections![index];
  child.revision! += 1;
  child.settings = {
    ...child.settings,
    carbon_enabled: true,
    carbon_test_evidence: { test_id: child.carbonAdmission?.test?.testId },
  };
  child.carbonAdmission = { ...child.carbonAdmission!, enabled: true, available: true };
  child.modelPolicyState = {
    ...child.modelPolicyState!,
    status: 'ok',
    effectiveModels: ['gemini-4-argon', carbon],
    catalogModels: [...child.modelPolicyState!.catalogModels, { id: carbon, allowed: true }],
    carbonAdmissionSupported: true,
    carbonAdmission: child.carbonAdmission,
  };
  return next;
}

describe('Carbon batch authoritative account state', () => {
  test('preserves authorization revision zero without conflating absent or invalid fences', () => {
    expect(parent().geminiEnterprise).toMatchObject({
      carbonAuthorizationRevision: 0,
      carbonRegistrationEpoch: 22,
    });
    expect(normalizeEnterpriseAccount({})?.carbonAuthorizationRevision).toBeUndefined();
    expect(
      normalizeEnterpriseAccount({ carbon_authorization_revision: -1 })?.carbonAuthorizationRevision
    ).toBeUndefined();
    const missing = parent();
    delete missing.geminiEnterprise!.carbonAuthorizationRevision;
    expect(carbonOperationScopeIdentity(missing, 'test')).not.toBe(
      carbonOperationScopeIdentity(parent(), 'test')
    );
  });

  test('five successes among eighteen survive the normal proof-only root revision refresh', () => {
    let account = parent(),
      rows = initialRows(account);
    const initial = copy(account),
      scope = carbonOperationScopeIdentity(account, 'test');
    for (const child of enterpriseCollectionFiles(account).slice(0, 5)) {
      const returned = result(child),
        previous = account;
      account = mergeCarbonTestResult(account, child, returned);
      rows = synchronizeCarbonOperationRows(rows, previous, account).map((row) =>
        row.file.geminiEnterprise?.bindingId === child.geminiEnterprise?.bindingId
          ? { ...row, state: 'done', test: returned, reason: 'ok' }
          : row
      );
    }
    const refreshed = copy(account);
    refreshed.geminiEnterprise!.revision = 15;
    rows = synchronizeCarbonOperationRows(rows, account, refreshed);
    expect(carbonOperationScopeIdentity(refreshed, 'test')).toBe(scope);
    expect(carbonOperationScopeIdentity(refreshed, 'configure')).not.toBe(
      carbonOperationScopeIdentity(initial, 'configure')
    );
    expect(rows.filter((row) => row.test?.status === 'ok')).toHaveLength(5);
    expect(rows.some((row) => row.reason === 'application_changed' || row.saveFailed)).toBe(false);
    expect(rows.every((row) => row.file.geminiEnterprise?.accountRevision === 15)).toBe(true);
    expect(rows.slice(0, 5).every((row) => enterpriseCarbonAdmission(row.file)?.canEnable)).toBe(
      true
    );
    expect(rows.slice(5).every((row) => !enterpriseCarbonAdmission(row.file)?.canEnable)).toBe(
      true
    );
  });

  test('a legitimate first stale-to-verified retest updates the batch baseline and all eighteen run once', async () => {
    let account = parent(),
      rows = initialRows(account);
    account.geminiEnterprise!.collections![0].carbonAdmission = normalizeEnterpriseCarbonAdmission({
      enabled: false,
      available: false,
      can_test: true,
      can_enable: false,
      reason: 'configuration_changed',
      test: proof('old-proof', 1),
    });
    rows = initialRows(account);
    const targets = enterpriseCollectionFiles(account),
      called: string[] = [];
    let baseline = carbonOperationScopeIdentity(account, 'test');
    await runCarbonApplicationTests(
      targets,
      new AbortController().signal,
      async (child) => {
        expect(carbonOperationScopeIdentity(account, 'test')).toBe(baseline);
        called.push(child.geminiEnterprise!.bindingId!);
        return result(child, 3);
      },
      () => {},
      (child, returned) => {
        const previous = account;
        account = mergeCarbonTestResult(account, child, returned);
        baseline = carbonOperationScopeIdentity(account, 'test');
        rows = synchronizeCarbonOperationRows(rows, previous, account).map((row) =>
          row.file.geminiEnterprise?.bindingId === child.geminiEnterprise?.bindingId
            ? { ...row, state: 'done', test: returned, reason: 'ok' }
            : row
        );
      }
    );
    const refresh = copy(account);
    refresh.geminiEnterprise!.revision = 28;
    rows = synchronizeCarbonOperationRows(rows, account, refresh);
    expect(called).toHaveLength(18);
    expect(new Set(called).size).toBe(18);
    expect(
      rows.every(
        (row) =>
          row.state === 'done' &&
          row.test?.status === 'ok' &&
          !row.saveFailed &&
          row.reason === 'ok'
      )
    ).toBe(true);
    expect(
      rows.every(
        (row) =>
          enterpriseCarbonAdmission(row.file)?.canEnable &&
          !enterpriseCarbonAdmission(row.file)?.enabled
      )
    ).toBe(true);
  });

  test('manual switch confirmation accepts full settings changes and synchronizes all rows without claiming other saves failed', () => {
    const before = tested();
    before.account.geminiEnterprise!.collections!.forEach((child) => {
      child.settings.carbon_enabled = false;
    });
    before.rows = synchronizeCarbonOperationRows(before.rows, before.account, before.account);
    const target = before.rows[0].file,
      next = switched(before.account);
    const confirmed = enterpriseCollectionFiles(next)[0];
    expect(confirmedCarbonSwitch(target, confirmed, true)).toBe(true);
    before.rows[0] = { ...before.rows[0], saving: true, saveRequestedEnabled: true };
    const rows = synchronizeCarbonOperationRows(
      before.rows,
      before.account,
      next,
      new Set(['binding-0'])
    );
    expect(rows[0].file.geminiEnterprise?.revision).toBe(4);
    expect(enterpriseCarbonAdmission(rows[0].file)?.enabled).toBe(true);
    expect(rows.every((row) => row.file.geminiEnterprise?.accountRevision === 29)).toBe(true);
    expect(
      rows.every((row) => row.reason === 'ok' && !row.saveFailed && row.test?.status === 'ok')
    ).toBe(true);
    expect(
      rows
        .slice(1)
        .every(
          (row) =>
            enterpriseCarbonAdmission(row.file)?.canEnable &&
            !enterpriseCarbonAdmission(row.file)?.enabled
        )
    ).toBe(true);
    expect(olderCarbonAccountSnapshot(next, before.account)).toBe(true);
  });

  test('a fresh list acknowledging the pending PATCH does not abort its confirmation or poison sibling rows', () => {
    const { account, rows } = tested(3),
      next = switched(account);
    rows[0] = { ...rows[0], saving: true, saveRequestedEnabled: true };
    const refreshed = synchronizeCarbonOperationRows(rows, account, next);
    expect(refreshed[0].saving).toBe(true);
    expect(refreshed[0].saveFailed).toBe(false);
    expect(confirmedCarbonSwitch(rows[0].file, refreshed[0].file, true)).toBe(true);
    expect(
      refreshed.slice(1).some((row) => row.saveFailed || row.reason === 'application_changed')
    ).toBe(false);
    expect(olderCarbonAccountSnapshot(next, account)).toBe(true);
  });

  test('real binding, exclusion and authorization changes clear old successes and fail only an affected active save', () => {
    const { account, rows } = tested(3);
    rows[0] = { ...rows[0], saving: true, saveRequestedEnabled: true };
    const bindingChanged = copy(account);
    bindingChanged.geminiEnterprise!.revision! += 1;
    bindingChanged.geminiEnterprise!.collections![1].revision! += 1;
    const changedRows = synchronizeCarbonOperationRows(rows, account, bindingChanged);
    expect(changedRows[1].test).toBeUndefined();
    expect(changedRows[1].reason).toBe('application_changed');
    expect(changedRows[1].saveFailed).toBeFalsy();
    expect(changedRows[0].saving).toBe(true);
    expect(changedRows[2].test?.status).toBe('ok');
    const denied = copy(account);
    denied.geminiEnterprise!.collections![2].modelPolicyState!.globalExcludedModels = [carbon];
    expect(carbonOperationScopeIdentity(denied, 'test')).not.toBe(
      carbonOperationScopeIdentity(account, 'test')
    );
    const reauthorized = copy(account);
    reauthorized.geminiEnterprise!.carbonAuthorizationRevision = 1;
    const invalidated = synchronizeCarbonOperationRows(rows, account, reauthorized);
    expect(invalidated.every((row) => row.test === undefined && row.state === 'cancelled')).toBe(
      true
    );
    expect(invalidated[0].saveFailed).toBe(true);
    expect(invalidated.slice(1).some((row) => row.saveFailed)).toBe(false);
    expect(
      confirmedCarbonSwitch(
        rows[0].file,
        enterpriseCollectionFiles(switched(reauthorized))[0],
        true
      )
    ).toBe(false);
  });

  test('a service restart with lower runtime fences is accepted as a new scope, not permanently discarded as stale', () => {
    const { account, rows } = tested(2),
      restarted = copy(account);
    restarted.geminiEnterprise!.carbonRegistrationEpoch = 1;
    restarted.geminiEnterprise!.carbonAuthorizationRevision = 0;
    expect(olderCarbonAccountSnapshot(account, restarted)).toBe(false);
    expect(carbonOperationScopeIdentity(account, 'test')).not.toBe(
      carbonOperationScopeIdentity(restarted, 'test')
    );
    expect(
      synchronizeCarbonOperationRows(rows, account, restarted).every(
        (row) => row.reason === 'application_changed' && !row.test && !row.saveFailed
      )
    ).toBe(true);
    expect(
      olderCarbonAccountSnapshot(restarted, {
        ...restarted,
        geminiEnterprise: { ...restarted.geminiEnterprise, revision: 999 },
      })
    ).toBe(false);
  });

  test('explicit invalidation reasons block late successful results even with unchanged visible payload policy', () => {
    for (const reason of ['configuration_changed', 'binding_changed', 'authorization_changed']) {
      const { account, rows } = tested(1),
        changed = copy(account),
        target = rows[0].file;
      changed.geminiEnterprise!.collections![0].carbonAdmission = {
        ...changed.geminiEnterprise!.collections![0].carbonAdmission!,
        canEnable: false,
        reason,
      };
      const latest = enterpriseCollectionFiles(changed)[0];
      expect(carbonApplicationPermissionIdentity(target)).not.toBe(
        carbonApplicationPermissionIdentity(latest)
      );
      expect(carbonOperationScopeIdentity(account, 'test')).not.toBe(
        carbonOperationScopeIdentity(changed, 'test')
      );
      expect(mergeCarbonTestResult(changed, target, result(target, 5))).toBe(changed);
      expect(enterpriseCarbonAdmission(latest)?.canEnable).toBe(false);
      expect(synchronizeCarbonOperationRows(rows, account, changed)[0].test).toBeUndefined();
    }
  });

  test('older list evidence cannot replace an already accepted POST proof, but current proof invalidation is retained', () => {
    const account = parent(1),
      target = enterpriseCollectionFiles(account)[0];
    const completed = mergeCarbonTestResult(account, target, result(target, 5));
    const protectedView = protectCarbonAccountEvidence(completed, account);
    expect(
      enterpriseCarbonAdmission(enterpriseCollectionFiles(protectedView)[0])?.test?.testId
    ).toBe(result(target, 5).carbonTestId);
    const invalidated = copy(completed);
    invalidated.geminiEnterprise!.collections![0].carbonAdmission!.canEnable = false;
    invalidated.geminiEnterprise!.collections![0].carbonAdmission!.reason = 'configuration_changed';
    expect(
      enterpriseCarbonAdmission(
        enterpriseCollectionFiles(protectCarbonAccountEvidence(completed, invalidated))[0]
      )?.canEnable
    ).toBe(false);
    invalidated.geminiEnterprise!.collections![0].carbonAdmission!.test =
      normalizeEnterpriseCarbonAdmission({
        can_test: true,
        test: proof('older-but-invalidated', 1),
      })!.test;
    expect(
      enterpriseCarbonAdmission(
        enterpriseCollectionFiles(protectCarbonAccountEvidence(completed, invalidated))[0]
      )?.canEnable
    ).toBe(false);
    const newer = mergeCarbonTestResult(
      completed,
      enterpriseCollectionFiles(completed)[0],
      result(target, 6)
    );
    expect(
      mergeCarbonTestResult(newer, enterpriseCollectionFiles(newer)[0], result(target, 5))
    ).toBe(newer);
  });

  test('ordinary Enterprise single-application identities include fences while Web and other providers retain their identities', () => {
    const target = enterpriseCollectionFiles(parent(1))[0],
      changed = copy(target);
    changed.geminiEnterprise!.carbonAuthorizationRevision = 1;
    expect(enterpriseCarbonTargetIdentity(target)).not.toBe(
      enterpriseCarbonTargetIdentity(changed)
    );
    expect(modelTestIdentity(target)).not.toBe(modelTestIdentity(changed));
    for (const type of ['gemini-enterprise-web', 'gemini-cli'])
      expect(modelTestIdentity({ ...target, type })).toBe(modelTestIdentity({ ...changed, type }));
    const refresh = copy(target);
    refresh.geminiEnterprise!.expiry = '2030-01-01T00:00:00Z';
    refresh.geminiEnterprise!.accountRevision = 999;
    expect(enterpriseCarbonTargetIdentity(target)).toBe(enterpriseCarbonTargetIdentity(refresh));
    expect(carbonApplicationPermissionIdentity(target)).toBe(
      carbonApplicationPermissionIdentity(refresh)
    );
  });
});
