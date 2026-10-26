import type { AuthFileItem } from '@/types';
import { isModelExcluded, type AuthFileModelItem } from './constants';
import { enterpriseCollectionIdentity } from './enterpriseAccounts';
import { cooldownRemainingSeconds } from './cooldowns';
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
  bindingId?: string;
  revision?: number;
};
export type ModelTestState = {
  state: ModelTestStatus | 'running' | 'cancelled';
  result?: ModelTestResult;
  cooldownUntilMs?: number;
};

export function sanitizeModelTestMessage(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(
      /((?:access_token|refresh_token|client_secret|api_key|authorization)["']?\s*[:=]\s*["']?)[^\s,"'<>]+/gi,
      '$1[redacted]'
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g, '[redacted]')
    .split('')
    .filter(
      (character) =>
        character.charCodeAt(0) >= 32 ||
        character === '\n' ||
        character === '\r' ||
        character === '\t'
    )
    .join('')
    .slice(0, 4096);
}

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
    !file.geminiEnterprise?.effectiveDisabled &&
    !file.geminiEnterprise?.collections &&
    (!file.geminiEnterprise?.bindingId || file.geminiEnterprise.revision !== undefined) &&
    String(file.authIndex ?? '').trim() &&
    validEnterpriseResources(enterpriseResources(file.geminiEnterprise))
  );
}

export function modelTestIdentity(file: AuthFileItem): string {
  return JSON.stringify([
    enterpriseCollectionIdentity(file),
    file.type || file.provider || '',
    Boolean(file.disabled),
    Boolean(file.geminiEnterprise?.effectiveDisabled),
    serializeEnterpriseResources(enterpriseResources(file.geminiEnterprise)),
  ]);
}

export function cancelModelTest(state: ModelTestState): ModelTestState {
  if (state.state !== 'running') return state;
  return state.result ? { ...state, state: state.result.status } : { state: 'cancelled' };
}

export function isEnterpriseModelExcluded(file: AuthFileItem, model: string): boolean {
  const settings = file.geminiEnterprise?.settings ?? file;
  const patterns = settings.excluded_models ?? settings['excluded-models'];
  return isModelExcluded(model, 'gemini-enterprise', {
    'gemini-enterprise': Array.isArray(patterns)
      ? patterns.filter((value): value is string => typeof value === 'string')
      : [],
  });
}

export function enterpriseModelCooldown(
  file: AuthFileItem,
  model: string,
  state?: ModelTestState,
  now = Date.now()
): number {
  const snapshot = file.cooldownSnapshot;
  const remaining = (snapshot?.records ?? [])
    .filter((record) => record.scope === 'credential' || record.modelKey === model)
    .map((record) => cooldownRemainingSeconds(record, snapshot!.receivedAtMs, now));
  return Math.max(0, ...remaining, Math.ceil(((state?.cooldownUntilMs ?? 0) - now) / 1000));
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
  onResult: (model: string, result: ModelTestResult) => void,
  shouldSkip: (model: string) => boolean = () => false
): Promise<void> {
  for (const model of [...new Set(models)]) {
    if (signal.aborted) return;
    if (shouldSkip(model)) continue;
    onStart(model);
    const result = await testModel(model);
    if (signal.aborted) return;
    onResult(model, result);
    if (shouldStopModelTests(result)) return;
  }
}
