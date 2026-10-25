import type { AuthFileItem } from '@/types';
import type { AuthFileModelItem } from './constants';
import {
  enterpriseResources,
  serializeEnterpriseResources,
  validEnterpriseResources,
} from './enterpriseResources';
import type { EnterpriseResources } from './enterpriseResources';

export type ModelTestStatus = 'ok' | 'failed' | 'cooling' | 'unavailable';
export type ModelTestResult = {
  status: ModelTestStatus;
  model: string;
  authIndex: string;
  resources: EnterpriseResources;
  checkedAt: string;
  elapsedMs: number;
  httpStatus: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
};
export type ModelTestState = {
  state: ModelTestStatus | 'running' | 'cancelled';
  result?: ModelTestResult;
};

export function isEnterpriseTextModel(model: AuthFileModelItem): boolean {
  return !/(?:image|video|audio|speech|tts|embedding|imagen|veo|lyria)/i.test(
    `${model.id} ${model.type ?? ''}`
  );
}

export function canTestEnterpriseFile(file: AuthFileItem | null): boolean {
  return Boolean(
    file &&
    (file.type || file.provider) === 'gemini-enterprise' &&
    !file.disabled &&
    String(file.authIndex ?? '').trim() &&
    validEnterpriseResources(enterpriseResources(file.geminiEnterprise))
  );
}

export function modelTestIdentity(file: AuthFileItem): string {
  return JSON.stringify([
    file.name,
    String(file.authIndex ?? ''),
    file.type || file.provider || '',
    Boolean(file.disabled),
    serializeEnterpriseResources(enterpriseResources(file.geminiEnterprise)),
  ]);
}

export function shouldStopModelTests(result: ModelTestResult): boolean {
  return (
    result.status !== 'cooling' &&
    (result.httpStatus === 401 ||
      result.httpStatus === 429 ||
      result.httpStatus === 409 ||
      result.status === 'unavailable')
  );
}

// A batch owns one signal and awaits each complete result before starting another call.
export async function runSerialModelTests(
  models: readonly string[],
  signal: AbortSignal,
  testModel: (model: string) => Promise<ModelTestResult>,
  onStart: (model: string) => void,
  onResult: (model: string, result: ModelTestResult) => void
): Promise<void> {
  for (const model of [...new Set(models)]) {
    if (signal.aborted) return;
    onStart(model);
    const result = await testModel(model);
    if (signal.aborted) return;
    onResult(model, result);
    if (shouldStopModelTests(result)) return;
  }
}
