import type { AuthFileItem, GeminiEnterpriseAccount } from '@/types';
import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { enterpriseRevision, normalizeEnterpriseAccount } from './enterpriseAccounts';
import { InvalidManagementResponseError, requireManagementObject } from './managementResponse';
import { isRecord } from '@/utils/helpers';
import {
  enterpriseCollectionFiles,
  enterpriseCollectionIdentity,
} from '@/features/authFiles/enterpriseAccounts';
import { validHydrogenConfigurationApplication } from '@/features/authFiles/enterpriseHydrogenOperations';
import {
  enterpriseResources,
  serializeEnterpriseResources,
} from '@/features/authFiles/enterpriseResources';

export type GoogleHydrogenConfigureStatus =
  'configured' | 'unchanged' | 'verification_required' | 'failed' | 'changed';
export type GoogleHydrogenConfigureResult = {
  bindingId: string;
  authIndex: string;
  expectedRevision: number;
  revision?: number;
  status: GoogleHydrogenConfigureStatus;
  reason?: string;
  httpStatus?: number;
};
export type GoogleHydrogenConfigureResponse = {
  snapshotId: string;
  results: GoogleHydrogenConfigureResult[];
  account?: GeminiEnterpriseAccount;
};

export function normalizeGoogleHydrogenConfigureResponse(
  value: unknown
): GoogleHydrogenConfigureResponse {
  requireManagementObject(value);
  if (
    value.google_hydrogen_configure_supported !== true ||
    typeof value.snapshot_id !== 'string' ||
    !value.snapshot_id.trim() ||
    value.snapshot_id.length > 512 ||
    !Array.isArray(value.applications)
  )
    throw new InvalidManagementResponseError();
  const results = value.applications.map((entry): GoogleHydrogenConfigureResult => {
    if (
      !isRecord(entry) ||
      typeof entry.binding_id !== 'string' ||
      !entry.binding_id ||
      typeof entry.auth_index !== 'string' ||
      !entry.auth_index ||
      enterpriseRevision(entry.expected_revision) === undefined ||
      !['configured', 'unchanged', 'verification_required', 'failed', 'changed'].includes(
        String(entry.status)
      )
    )
      throw new InvalidManagementResponseError();
    return {
      bindingId: entry.binding_id,
      authIndex: entry.auth_index,
      expectedRevision: enterpriseRevision(entry.expected_revision)!,
      revision: enterpriseRevision(entry.revision),
      status: entry.status as GoogleHydrogenConfigureStatus,
      reason: typeof entry.reason === 'string' ? entry.reason : undefined,
      httpStatus: enterpriseRevision(entry.http_status),
    };
  });
  return {
    snapshotId: value.snapshot_id,
    results,
    account: normalizeEnterpriseAccount(value.gemini_enterprise),
  };
}

export const enterpriseHydrogenApi = {
  async configureGoogle(
    file: AuthFileItem,
    applications: AuthFileItem[],
    signal: AbortSignal,
    snapshotId?: string
  ): Promise<GoogleHydrogenConfigureResponse> {
    const assertConnection = guardConfigConnection();
    if (
      !file.geminiEnterprise?.googleHydrogenConfigureSupported ||
      !file.geminiEnterprise.accountId ||
      file.geminiEnterprise.revision === undefined ||
      !String(file.authIndex ?? '') ||
      !applications.length ||
      applications.length > 5 ||
      (file.type || file.provider) !== 'gemini-enterprise' ||
      applications.some(
        (application) =>
          !validHydrogenConfigurationApplication(application) ||
          !enterpriseCollectionFiles(file).some(
            (imported) =>
              enterpriseCollectionIdentity(imported) === enterpriseCollectionIdentity(application)
          )
      )
    )
      throw new InvalidManagementResponseError();
    const response = normalizeGoogleHydrogenConfigureResponse(
      await apiClient.post(
        '/credentials/gemini-enterprise/hydrogen/configure-google',
        {
          name: file.name,
          account_id: file.geminiEnterprise.accountId,
          auth_index: String(file.authIndex),
          expected_revision: file.geminiEnterprise.revision,
          ...(snapshotId ? { snapshot_id: snapshotId } : {}),
          applications: applications.map((application) => ({
            binding_id: application.geminiEnterprise?.bindingId,
            auth_index: String(application.authIndex ?? ''),
            expected_revision: application.geminiEnterprise?.revision,
            expected: serializeEnterpriseResources(
              enterpriseResources(application.geminiEnterprise)
            ),
          })),
        },
        { signal, timeout: 0 }
      )
    );
    assertConnection();
    signal.throwIfAborted();
    if (
      (snapshotId && response.snapshotId !== snapshotId) ||
      response.results.length !== applications.length ||
      new Set(response.results.map((entry) => entry.bindingId)).size !== applications.length ||
      response.results.some(
        (entry) =>
          !applications.some(
            (application) =>
              entry.bindingId === application.geminiEnterprise?.bindingId &&
              entry.authIndex === String(application.authIndex) &&
              entry.expectedRevision === application.geminiEnterprise.revision
          )
      )
    )
      throw new InvalidManagementResponseError();
    if (
      response.account?.accountId &&
      response.account.accountId !== file.geminiEnterprise.accountId
    )
      throw new InvalidManagementResponseError();
    return response;
  },
};
