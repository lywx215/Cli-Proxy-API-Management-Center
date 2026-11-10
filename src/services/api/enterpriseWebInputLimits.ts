import { isRecord } from '@/utils/helpers';

// Keep this contract aligned with backend GeminiEnterpriseWebInputLimits.
const LEGACY_HISTORY_LIMITS = [
  ['max-contents', 200, 10000],
  ['max-segments', 4129, 100000],
] as const;

const WEB_INPUT_LIMITS = [
  ['max-text-bytes', 4 * 1048576, 64 * 1048576],
  ['max-user-parts', 256, 65536],
  ['max-model-parts', 4096, 65536],
  ['max-system-parts', 256, 65536],
  ['max-attachments', 12, 128],
  ['max-attachment-bytes', 50 * 1048576, 512 * 1048576],
  ['max-request-bytes', 68 * 1048576, 1024 * 1048576],
  ['max-json-object-fields', 256, 4096],
  ['max-tool-depth', 64, 256],
  ['max-tool-nodes', 100000, 1000000],
  ['max-tool-array-entries', 4096, 65536],
  ['max-generation-config-bytes', 1048576, 64 * 1048576],
] as const;

export type WebHistoryCountPolicy = 'unlimited';
export type WebInputLimits = Record<(typeof WEB_INPUT_LIMITS)[number][0], number> &
  Partial<Record<(typeof LEGACY_HISTORY_LIMITS)[number][0], number>>;

// Runtime status must be explicit. Only YAML/config reads may fill omitted or
// zero fields with backend defaults; unknown backend fields are left intact on save.
export function normalizeWebInputLimits(
  raw: unknown,
  configDefaults = false,
  historyCountPolicy?: WebHistoryCountPolicy
): WebInputLimits | undefined {
  if (!isRecord(raw)) return undefined;
  const result = {} as WebInputLimits;
  const fields =
    historyCountPolicy === 'unlimited'
      ? WEB_INPUT_LIMITS
      : [...WEB_INPUT_LIMITS, ...LEGACY_HISTORY_LIMITS];
  for (const [key, fallback, maximum] of fields) {
    const value =
      configDefaults && (raw[key] === undefined || raw[key] === 0) ? fallback : raw[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
      return undefined;
    result[key] = value;
  }
  if (historyCountPolicy === 'unlimited') return result;
  const segments = result['max-segments']!;
  if (configDefaults && (raw['max-contents'] === undefined || raw['max-contents'] === 0)) {
    result['max-contents'] = Math.min(result['max-contents']!, segments);
  }
  return segments >= result['max-contents']! ? result : undefined;
}

export function sameWebInputLimits(a: WebInputLimits, b: WebInputLimits): boolean {
  return [...WEB_INPUT_LIMITS, ...LEGACY_HISTORY_LIMITS].every(([key]) => a[key] === b[key]);
}
