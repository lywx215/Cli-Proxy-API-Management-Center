import { parse } from 'yaml';
import { isRecord } from '@/utils/helpers';
import {
  enterpriseWebApi,
  EnterpriseWebClientError,
  type EnterpriseWebSettings,
} from '@/services/api/geminiEnterpriseWeb';
import {
  normalizeWebInputLimits,
  sameWebInputLimits,
} from '@/services/api/enterpriseWebInputLimits';

function webConfig(yaml: string): Record<string, unknown> {
  const root: unknown = parse(yaml);
  if (!isRecord(root) || !isRecord(root.upstream)) return {};
  const web = root.upstream['gemini-enterprise-web'];
  return isRecord(web) ? web : {};
}

// Unrelated saves must not introduce a Web dependency or persist default fields.
export async function verifyEnterpriseWebConfigChange(
  before: string,
  after: string,
  phase: 'before' | 'after'
) {
  const old = webConfig(before);
  const next = webConfig(after);
  const keys = ['enabled', 'max-concurrent', 'max-inflight-bytes', 'history-mode'] as const;
  const ccKey = 'cookie-cc-polling-enabled';
  const ccChanged = old[ccKey] !== next[ccKey];
  const fingerprint = (value: unknown) =>
    JSON.stringify(
      isRecord(value)
        ? Object.keys(value)
            .sort()
            .map((key) => [key, value[key]])
        : value
    );
  const limitsChanged = fingerprint(old['input-limits']) !== fingerprint(next['input-limits']);
  if (!ccChanged && !limitsChanged && !keys.some((key) => old[key] !== next[key])) return;
  const modeChanged = old['history-mode'] !== next['history-mode'];
  if (phase === 'before' && !ccChanged && !modeChanged && !limitsChanged) return;
  if (ccChanged && next[ccKey] !== undefined && typeof next[ccKey] !== 'boolean')
    throw new EnterpriseWebClientError('cc_polling_invalid');
  const nextLimits = next['input-limits'] ?? {};
  if (limitsChanged && !normalizeWebInputLimits(nextLimits, true, 'unlimited'))
    throw new EnterpriseWebClientError('invalid_input_limits');
  const actual = await enterpriseWebApi.status();
  if (ccChanged && actual.cookieCCPollingEnabled === undefined)
    throw new EnterpriseWebClientError('cc_polling_unsupported');
  if (limitsChanged && !actual.inputLimits)
    throw new EnterpriseWebClientError('input_limits_unsupported');
  const expectedLimits = normalizeWebInputLimits(nextLimits, true, actual.historyCountPolicy);
  if (limitsChanged && !expectedLimits) throw new EnterpriseWebClientError('invalid_input_limits');
  const mode = next['history-mode'] ?? 'single-turn';
  if (
    modeChanged &&
    (!actual.historyMode || !actual.supportedHistoryModes?.some((value) => value === mode))
  )
    throw new EnterpriseWebClientError('history_unsupported');
  if (phase === 'before') return;
  const expected: Omit<EnterpriseWebSettings, 'historyMode'> = {
    enabled: next.enabled === true,
    maxConcurrent: Number(next['max-concurrent'] ?? 2) || 2,
    maxInflightBytes: Number(next['max-inflight-bytes'] ?? 268435456) || 268435456,
  };
  if (
    actual.enabled !== expected.enabled ||
    actual.maxConcurrent !== expected.maxConcurrent ||
    actual.maxInflightBytes !== expected.maxInflightBytes ||
    (ccChanged && actual.cookieCCPollingEnabled !== (next[ccKey] === true)) ||
    (limitsChanged &&
      expectedLimits &&
      actual.inputLimits &&
      !sameWebInputLimits(expectedLimits, actual.inputLimits)) ||
    (modeChanged && actual.historyMode !== mode)
  )
    throw new EnterpriseWebClientError('settings_not_effective');
}
