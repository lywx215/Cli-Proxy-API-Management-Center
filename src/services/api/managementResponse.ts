import { isRecord } from '@/utils/helpers';

export class InvalidManagementResponseError extends Error {
  constructor() {
    super('The configured address did not return a Management API JSON object');
    this.name = 'InvalidManagementResponseError';
  }
}

export function requireManagementObject(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidManagementResponseError();
}
