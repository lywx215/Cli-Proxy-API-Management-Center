import { isRecord } from '@/utils/helpers';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { GEMINI_SHARED_FIELDS, getGeminiGroupKeys } from '../geminiGroups';

export type GeminiDialogField = (typeof GEMINI_SHARED_FIELDS)[number] | 'name' | 'base-url';
export type GeminiDialogValues = Record<GeminiDialogField, string>;
export type GeminiModelMode = 'keep' | 'catalog' | 'custom';
export interface GeminiModelDraft {
  name: string;
  alias: string;
  metadata: string;
}

export const GEMINI_DIALOG_FIELD_LABELS: Record<GeminiDialogField, string> = {
  name: 'name',
  'base-url': 'baseUrl',
  'proxy-url': 'proxyUrl',
  prefix: 'prefix',
  models: 'models',
  headers: 'headers',
  'excluded-models': 'excludedModels',
  priority: 'priority',
  'request-retry': 'requestRetry',
  'disable-cooling': 'disableCooling',
  'request-scoped-errors': 'requestScopedErrors',
};

export const readGeminiDialogValues = (record: Record<string, unknown>): GeminiDialogValues => {
  const read = (field: GeminiDialogField): string => {
    const value = record[field];
    if (field === 'disable-cooling') return typeof value === 'boolean' ? String(value) : 'default';
    if (field === 'headers') return JSON.stringify(value ?? {}, null, 2);
    if (field === 'request-scoped-errors') return JSON.stringify(value ?? [], null, 2);
    if (field === 'models') return '';
    if (field === 'excluded-models')
      return Array.isArray(value) ? value.map(String).join('\n') : '';
    return value === undefined || value === null ? '' : String(value);
  };
  return Object.fromEntries(
    Object.keys(GEMINI_DIALOG_FIELD_LABELS).map((field) => [
      field,
      read(field as GeminiDialogField),
    ])
  ) as GeminiDialogValues;
};

export const readGeminiModelDrafts = (models: unknown): GeminiModelDraft[] =>
  Array.isArray(models)
    ? models.filter(isRecord).map((model) => {
        const metadata = { ...model };
        delete metadata.name;
        delete metadata.alias;
        return {
          name: String(model.name ?? ''),
          alias: String(model.alias ?? ''),
          metadata: JSON.stringify(metadata, null, 2),
        };
      })
    : [];

export const buildGeminiModelDrafts = (drafts: GeminiModelDraft[]): Record<string, unknown>[] => {
  const seen = new Set<string>();
  if (drafts.length === 0) throw new Error('models');
  return drafts.map((draft) => {
    const name = draft.name.trim();
    const alias = draft.alias.trim();
    const metadata: unknown = JSON.parse(draft.metadata || '{}');
    if (!name || !isRecord(metadata)) throw new Error('models');
    const publicName = (alias || name).toLowerCase();
    if (seen.has(publicName)) throw new Error('models');
    seen.add(publicName);
    return { ...metadata, name, alias };
  });
};

export const parseGeminiDialogField = (field: GeminiDialogField, value: string): unknown => {
  const trimmed = value.trim();
  if (field === 'name') {
    if (!trimmed) throw new Error(field);
    return trimmed;
  }
  if (field === 'priority' || field === 'request-retry') {
    if (!trimmed) return null;
    if (!/^[+-]?\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed)))
      throw new Error(field);
    return Number(trimmed);
  }
  if (field === 'disable-cooling') {
    if (value === 'default') return null;
    if (value !== 'true' && value !== 'false') throw new Error(field);
    return value === 'true';
  }
  if (field === 'headers') {
    const parsed: unknown = JSON.parse(trimmed || '{}');
    if (!isRecord(parsed) || !Object.values(parsed).every((item) => typeof item === 'string'))
      throw new Error(field);
    return parsed;
  }
  if (field === 'request-scoped-errors') {
    const parsed: unknown = JSON.parse(trimmed || '[]');
    if (!Array.isArray(parsed) || !parsed.every(isRecord)) throw new Error(field);
    return parsed;
  }
  if (field === 'excluded-models')
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  if (field === 'base-url' && trimmed) {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error(field);
  }
  return trimmed;
};

export const buildGeminiDialogPatch = (
  values: GeminiDialogValues,
  fields: Iterable<GeminiDialogField>,
  modelMode: GeminiModelMode,
  models: GeminiModelDraft[]
): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === 'models') {
      if (modelMode === 'keep') continue;
      changes.models = modelMode === 'catalog' ? [] : buildGeminiModelDrafts(models);
    } else changes[field] = parseGeminiDialogField(field, values[field]);
  }
  return changes;
};

export const getGeminiGroupDialogImpacts = (
  groups: Record<string, unknown>[],
  fields: Iterable<string>
): Record<string, { inherited: number; overridden: number }> => {
  const impacts: Record<string, { inherited: number; overridden: number }> = {};
  for (const field of fields) {
    if (field === 'name') continue;
    const keys = groups.flatMap(getGeminiGroupKeys);
    const overridden = field === 'base-url' ? 0 : keys.filter((key) => key[field] != null).length;
    impacts[field] = { inherited: keys.length - overridden, overridden };
  }
  return impacts;
};

export const parseGeminiDialogWeight = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!/^[+-]?\d+$/.test(trimmed) || !Number.isSafeInteger(value) || value > MAX_CREDENTIAL_WEIGHT)
    throw new Error('weight');
  return value;
};

export const buildGeminiKeyDialogPatch = ({
  values,
  touched,
  overrides,
  modelMode,
  models,
  weight,
  weightTouched,
  apiKey,
}: {
  values: GeminiDialogValues;
  touched: ReadonlySet<GeminiDialogField>;
  overrides: ReadonlySet<GeminiDialogField>;
  modelMode: GeminiModelMode;
  models: GeminiModelDraft[];
  weight: string;
  weightTouched: boolean;
  apiKey: string;
}): { changes: Record<string, unknown>; inheritFields: string[] } => {
  const fields = [...touched].filter((field) => overrides.has(field));
  for (const field of fields) {
    if (
      ((field === 'priority' || field === 'request-retry') && !values[field].trim()) ||
      (field === 'disable-cooling' && values[field] === 'default')
    )
      throw new Error(field);
  }
  const changes = buildGeminiDialogPatch(values, fields, modelMode, models);
  const inheritFields = [...touched].filter((field) => !overrides.has(field));
  if (weightTouched) changes.weight = parseGeminiDialogWeight(weight);
  const key = apiKey.trim();
  if (key) {
    if (/\s/.test(key)) throw new Error('api-key');
    changes['api-key'] = key;
  }
  return { changes, inheritFields };
};

export const maskGeminiImportKey = (key: string): string =>
  key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••••••';
