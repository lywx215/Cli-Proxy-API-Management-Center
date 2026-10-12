import type { GeminiTarget } from '@/services/api/geminiManagement';
import { isRecord } from '@/utils/helpers';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type GeminiRawRecord = Record<string, unknown>;
export type GeminiGroups = GeminiRawRecord[];

export const GEMINI_SHARED_FIELDS = [
  'priority',
  'prefix',
  'proxy-url',
  'headers',
  'models',
  'excluded-models',
  'disable-cooling',
  'request-retry',
  'request-scoped-errors',
] as const;
export const MAX_GEMINI_IMPORT_KEYS = 1000;

export interface GeminiKeyImport {
  keys: string[];
  duplicateCount: number;
  crossGroupCount: number;
  invalidLines: number[];
  tooMany: boolean;
}

export interface GeminiMergeCandidate {
  groupIndices: number[];
  keyCount: number;
  sourceKeyCounts: number[];
}

export interface GeminiMergeDiagnostic {
  groupIndex: number;
  reason: 'empty' | 'unknown-fields' | 'duplicate-identity' | 'group-settings' | 'key-settings';
  fields?: string[];
}

const sharedFields = new Set<string>(GEMINI_SHARED_FIELDS);
const readOnlyFields = new Set(['auth_index', 'auth-index']);
// Match the YAML schemas used by config_v8_extensions.go before moving records between groups.
const keySchemaFields = new Set(['api-key', 'weight', 'base-url', ...GEMINI_SHARED_FIELDS]);
const groupSchemaFields = new Set([...keySchemaFields, 'name', 'keys']);
const modelSchemaFields = new Set([
  'name',
  'alias',
  'display-name',
  'max-context-length',
  'force-mapping',
  'is-compat',
  'thinking',
]);
const thinkingSchemaFields = new Set(['min', 'max', 'zero-allowed', 'dynamic-allowed', 'levels']);
const errorRuleSchemaFields = new Set(['status', 'match', 'match-regexr', 'action']);
const hasOwn = (record: GeminiRawRecord, field: string) =>
  Object.prototype.hasOwnProperty.call(record, field);

const fail = (message: string): never => {
  throw new Error(message);
};

const clone = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
};

// Sort object fields for comparison, while retaining list order and absent/null differences.
const canonical = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const getGeminiGroupKeys = (group: GeminiRawRecord): GeminiRawRecord[] => {
  if (!Array.isArray(group.keys) || !group.keys.every(isRecord)) {
    return fail('Invalid Gemini group keys.');
  }
  return group.keys as GeminiRawRecord[];
};

const groupAt = (groups: GeminiGroups, index: number): GeminiRawRecord => {
  if (!Number.isInteger(index) || index < 0 || index >= groups.length || !isRecord(groups[index])) {
    return fail('Invalid Gemini group target.');
  }
  getGeminiGroupKeys(groups[index]);
  return groups[index];
};

const keyAt = (groups: GeminiGroups, target: GeminiTarget): GeminiRawRecord => {
  const keys = getGeminiGroupKeys(groupAt(groups, target.groupIndex));
  if (
    target.keyIndex === undefined ||
    !Number.isInteger(target.keyIndex) ||
    target.keyIndex < 0 ||
    target.keyIndex >= keys.length
  ) {
    return fail('Invalid Gemini key target.');
  }
  return keys[target.keyIndex];
};

export const getGeminiEffectiveKey = (
  group: GeminiRawRecord,
  key: GeminiRawRecord
): GeminiRawRecord => {
  const effective: GeminiRawRecord = {};
  for (const field of ['base-url', ...GEMINI_SHARED_FIELDS]) {
    if (hasOwn(group, field)) effective[field] = clone(group[field]);
  }
  for (const [field, value] of Object.entries(key)) {
    if (sharedFields.has(field) && (value === null || value === undefined)) continue;
    effective[field] = clone(value);
  }
  return effective;
};

export const getGeminiOverrideFields = (key: GeminiRawRecord): string[] =>
  GEMINI_SHARED_FIELDS.filter((field) => key[field] !== null && key[field] !== undefined);

export const parseGeminiKeyImport = (
  input: string,
  groups: GeminiGroups,
  targetGroupIndex: number
): GeminiKeyImport => {
  const targetKeys = new Set(
    getGeminiGroupKeys(groupAt(groups, targetGroupIndex)).map((key) => text(key['api-key']))
  );
  const otherKeys = new Set(
    groups.flatMap((group, index) =>
      index === targetGroupIndex ? [] : getGeminiGroupKeys(group).map((key) => text(key['api-key']))
    )
  );
  const result: GeminiKeyImport = {
    keys: [],
    duplicateCount: 0,
    crossGroupCount: 0,
    invalidLines: [],
    tooMany: false,
  };
  const seen = new Set<string>();
  let nonEmptyCount = 0;
  input.split(/\r\n|\n|\r/).forEach((line, index) => {
    const key = line.trim();
    if (!key) return;
    nonEmptyCount += 1;
    if (/\s/.test(key)) {
      result.invalidLines.push(index + 1);
      return;
    }
    if (targetKeys.has(key) || seen.has(key)) {
      result.duplicateCount += 1;
      return;
    }
    seen.add(key);
    result.keys.push(key);
    if (otherKeys.has(key)) result.crossGroupCount += 1;
  });
  result.tooMany = nonEmptyCount > MAX_GEMINI_IMPORT_KEYS;
  return result;
};

export const appendGeminiKeys = (
  groups: GeminiGroups,
  groupIndex: number,
  keys: string[]
): GeminiGroups => {
  const existing = getGeminiGroupKeys(groupAt(groups, groupIndex));
  if (keys.length > MAX_GEMINI_IMPORT_KEYS) return fail('Too many Gemini keys.');
  const seen = new Set(existing.map((key) => text(key['api-key'])));
  const additions = keys.map((value) => {
    const key = value.trim();
    if (!key || /\s/.test(key)) return fail('Invalid Gemini key import.');
    if (seen.has(key)) return fail('Duplicate Gemini key in the target group.');
    seen.add(key);
    return { 'api-key': key };
  });
  const next = clone(groups);
  next[groupIndex].keys = [...getGeminiGroupKeys(next[groupIndex]), ...additions];
  return next;
};

const validateChanges = (changes: GeminiRawRecord, keyOnly: boolean) => {
  for (const field of Object.keys(changes)) {
    if (
      !sharedFields.has(field) &&
      (keyOnly
        ? field !== 'weight' && field !== 'name' && field !== 'api-key'
        : field !== 'base-url' && field !== 'name')
    ) {
      fail('Invalid Gemini configuration field.');
    }
  }
};

const validateSharedFields = (fields: string[]) => {
  if (fields.some((field) => !sharedFields.has(field))) {
    fail('Only shared Gemini fields can restore inheritance.');
  }
};

export const patchGeminiGroups = (
  groups: GeminiGroups,
  groupIndices: number[],
  changes: GeminiRawRecord
): GeminiGroups => {
  if (!groupIndices.length) return fail('At least one Gemini group is required.');
  groupIndices.forEach((index) => groupAt(groups, index));
  validateChanges(changes, false);
  const next = clone(groups);
  for (const index of new Set(groupIndices)) Object.assign(next[index], clone(changes));
  return next;
};

export const patchGeminiKey = (
  groups: GeminiGroups,
  target: GeminiTarget,
  changes: GeminiRawRecord,
  inheritFields: string[] = []
): GeminiGroups => {
  keyAt(groups, target);
  validateChanges(changes, true);
  validateSharedFields(inheritFields);
  if (inheritFields.some((field) => hasOwn(changes, field))) {
    return fail('A Gemini field cannot be overridden and inherited together.');
  }
  const normalizedChanges = clone(changes);
  if (hasOwn(normalizedChanges, 'api-key')) {
    const value = normalizedChanges['api-key'];
    if (typeof value !== 'string' || !value.trim() || /\s/.test(value.trim())) {
      return fail('Invalid Gemini key replacement.');
    }
    normalizedChanges['api-key'] = value.trim();
  }
  const next = clone(groups);
  const key = keyAt(next, target);
  Object.assign(key, normalizedChanges);
  inheritFields.forEach((field) => delete key[field]);
  return next;
};

export const restoreGeminiInheritance = (
  groups: GeminiGroups,
  targets: GeminiTarget[],
  fields: string[]
): GeminiGroups => {
  if (!targets.length) return fail('At least one Gemini target is required.');
  validateSharedFields(fields);
  targets.forEach((target) => {
    if (target.keyIndex === undefined) groupAt(groups, target.groupIndex);
    else keyAt(groups, target);
  });
  const next = clone(groups);
  for (const target of targets) {
    const keys =
      target.keyIndex === undefined
        ? getGeminiGroupKeys(next[target.groupIndex])
        : [keyAt(next, target)];
    keys.forEach((key) => fields.forEach((field) => delete key[field]));
  }
  return next;
};

const groupDefaults = (group: GeminiRawRecord): GeminiRawRecord =>
  Object.fromEntries(
    Object.entries(group).filter(
      ([field]) => field !== 'name' && field !== 'keys' && !readOnlyFields.has(field)
    )
  );

const effectiveShared = (group: GeminiRawRecord, key: GeminiRawRecord): string => {
  const effective = getGeminiEffectiveKey(group, key);
  return canonical(
    Object.fromEntries(
      GEMINI_SHARED_FIELDS.filter((field) => hasOwn(effective, field)).map((field) => [
        field,
        effective[field],
      ])
    )
  );
};

// This mirrors the inputs to the backend's synthesized ID, without exposing a Key in errors.
export const geminiCredentialFingerprint = (
  group: GeminiRawRecord,
  key: GeminiRawRecord
): string => {
  const effective = getGeminiEffectiveKey(group, key);
  if (!text(effective['api-key'])) return fail('Missing Gemini credential identity.');
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        canonical([
          text(effective['api-key']),
          text(effective['base-url']),
          text(effective['proxy-url']),
          text(effective.prefix),
          effective.headers ?? {},
        ])
      )
    )
  );
};

const credentialCounts = (groups: GeminiGroups): Map<string, number> => {
  const counts = new Map<string, number>();
  groups.forEach((group) =>
    getGeminiGroupKeys(group).forEach((key) => {
      const identity = geminiCredentialFingerprint(group, key);
      counts.set(identity, (counts.get(identity) ?? 0) + 1);
    })
  );
  return counts;
};

const unknownGeminiFields = (group: GeminiRawRecord): string[] => {
  const fields: string[] = [];
  const inspect = (value: unknown, known: Set<string>, path: string, directIndexes = false) => {
    if (!isRecord(value)) return;
    for (const field of Object.keys(value)) {
      if (!known.has(field) && !(directIndexes && readOnlyFields.has(field))) {
        fields.push(`${path}${field}`);
      }
    }
  };
  const inspectOptions = (record: GeminiRawRecord, path: string) => {
    if (Array.isArray(record.models)) {
      record.models.forEach((model, index) => {
        const modelPath = `${path}models[${index}].`;
        inspect(model, modelSchemaFields, modelPath);
        if (isRecord(model)) inspect(model.thinking, thinkingSchemaFields, `${modelPath}thinking.`);
      });
    }
    if (Array.isArray(record['request-scoped-errors'])) {
      record['request-scoped-errors'].forEach((rule, index) =>
        inspect(rule, errorRuleSchemaFields, `${path}request-scoped-errors[${index}].`)
      );
    }
    // Headers is a business map, so its property names do not describe configuration fields.
  };
  inspect(group, groupSchemaFields, '', true);
  inspectOptions(group, '');
  getGeminiGroupKeys(group).forEach((key, index) => {
    const path = `keys[${index}].`;
    inspect(key, keySchemaFields, path, true);
    inspectOptions(key, path);
  });
  return fields.sort();
};

const shiftedUnknownFields = (unknownFields: string[][], firstRemoved: number): string[] =>
  unknownFields.flatMap((fields, index) =>
    index >= firstRemoved ? fields.map((field) => `groups[${index}].${field}`) : []
  );

const analyzeGeminiMerge = (groups: GeminiGroups) => {
  const unknownFields = groups.map(unknownGeminiFields);
  const counts = credentialCounts(groups);
  const info = groups.map((group, index) => {
    const keys = getGeminiGroupKeys(group);
    const signatures = new Set(keys.map((key) => effectiveShared(group, key)));
    return {
      index,
      keyCount: keys.length,
      defaults: canonical(groupDefaults(group)),
      shared: signatures.size === 1 ? [...signatures][0] : undefined,
      duplicate: keys.some((key) => counts.get(geminiCredentialFingerprint(group, key)) !== 1),
    };
  });
  const buckets = new Map<string, number[]>();
  info.forEach((group) => {
    if (
      !group.keyCount ||
      group.shared === undefined ||
      group.duplicate ||
      unknownFields[group.index].length
    )
      return;
    const signature = canonical([group.defaults, group.shared]);
    const indices = buckets.get(signature) ?? [];
    indices.push(group.index);
    buckets.set(signature, indices);
  });
  const lastUnknownGroup = unknownFields.reduce(
    (last, fields, index) => (fields.length ? index : last),
    -1
  );
  const candidates: GeminiMergeCandidate[] = [];
  for (const indices of buckets.values()) {
    // Removing a preceding group moves the owners of opaque options on later groups.
    // Keep those groups at their existing indices until the backend can confirm the move.
    const groupIndices = indices.filter(
      (index, position) => position === 0 || index > lastUnknownGroup
    );
    if (groupIndices.length < 2) continue;
    const sourceKeyCounts = groupIndices.map((index) => info[index].keyCount);
    candidates.push({
      groupIndices,
      keyCount: sourceKeyCounts.reduce((sum, count) => sum + count, 0),
      sourceKeyCounts,
    });
  }
  return { candidates, info, unknownFields };
};

const validateMerge = (groups: GeminiGroups, groupIndices: number[]) => {
  if (groupIndices.length < 2 || new Set(groupIndices).size !== groupIndices.length) {
    fail('At least two distinct Gemini groups are required.');
  }
  const selected = groupIndices.map((index) => groupAt(groups, index));
  if (selected.some((group) => !getGeminiGroupKeys(group).length)) {
    fail('Empty Gemini groups cannot be merged.');
  }
  const unknownFields = groups.map(unknownGeminiFields);
  const firstRemoved = [...groupIndices].sort((a, b) => a - b)[1];
  if (
    groupIndices.some((index) => unknownFields[index].length > 0) ||
    shiftedUnknownFields(unknownFields, firstRemoved).length > 0
  ) {
    fail('Unknown Gemini configuration fields prevent a safe merge.');
  }
  const defaults = canonical(groupDefaults(selected[0]));
  if (selected.some((group) => canonical(groupDefaults(group)) !== defaults)) {
    fail('Gemini group defaults differ.');
  }
  const shared = selected.flatMap((group) =>
    getGeminiGroupKeys(group).map((key) => effectiveShared(group, key))
  );
  if (new Set(shared).size > 1) fail('Gemini key settings differ.');
  const counts = credentialCounts(groups);
  if (
    selected.some((group) =>
      getGeminiGroupKeys(group).some(
        (key) => (counts.get(geminiCredentialFingerprint(group, key)) ?? 0) > 1
      )
    )
  ) {
    fail('Duplicate Gemini credential identity prevents a safe merge.');
  }
};

export const findGeminiMergeCandidates = (groups: GeminiGroups): GeminiMergeCandidate[] => {
  return analyzeGeminiMerge(groups).candidates;
};

export const getGeminiMergeDiagnostics = (groups: GeminiGroups): GeminiMergeDiagnostic[] => {
  const { candidates, info, unknownFields } = analyzeGeminiMerge(groups);
  const mergeable = new Set(candidates.flatMap((candidate) => candidate.groupIndices));
  return info.flatMap((group): GeminiMergeDiagnostic[] => {
    const groupIndex = group.index;
    if (mergeable.has(groupIndex)) return [];
    if (!group.keyCount) return [{ groupIndex, reason: 'empty' }];
    if (unknownFields[groupIndex].length) {
      return [{ groupIndex, reason: 'unknown-fields', fields: unknownFields[groupIndex] }];
    }
    if (group.duplicate) return [{ groupIndex, reason: 'duplicate-identity' }];
    if (group.shared === undefined) return [{ groupIndex, reason: 'key-settings' }];
    const sameDefaults = info.filter(
      (peer) => peer.index !== groupIndex && peer.keyCount > 0 && peer.defaults === group.defaults
    );
    const sameSettings = sameDefaults.filter((peer) => peer.shared === group.shared);
    const opaquePeers = sameSettings.flatMap((peer) =>
      unknownFields[peer.index].map((field) => `groups[${peer.index}].${field}`)
    );
    const safePeer = sameSettings.find(
      (peer) => !peer.duplicate && !unknownFields[peer.index].length
    );
    const shiftedFields = safePeer
      ? shiftedUnknownFields(unknownFields, Math.max(groupIndex, safePeer.index))
      : [];
    if (opaquePeers.length || shiftedFields.length) {
      return [
        {
          groupIndex,
          reason: 'unknown-fields',
          fields: [...new Set([...opaquePeers, ...shiftedFields])].sort(),
        },
      ];
    }
    if (sameSettings.some((peer) => peer.duplicate)) {
      return [{ groupIndex, reason: 'duplicate-identity' }];
    }
    return [{ groupIndex, reason: sameDefaults.length ? 'key-settings' : 'group-settings' }];
  });
};

export const mergeGeminiGroups = (groups: GeminiGroups, groupIndices: number[]): GeminiGroups => {
  validateMerge(groups, groupIndices);
  const selected = [...groupIndices].sort((a, b) => a - b);
  const indices = new Set(selected);
  const before = [...credentialCounts(groups).entries()].sort(([a], [b]) => a.localeCompare(b));
  const next = clone(groups);
  next[selected[0]].keys = selected.flatMap((index) => getGeminiGroupKeys(next[index]));
  const merged = next.filter((_, index) => index === selected[0] || !indices.has(index));
  const after = [...credentialCounts(merged).entries()].sort(([a], [b]) => a.localeCompare(b));
  if (canonical(before) !== canonical(after))
    fail('Gemini credential identity changed during merge.');
  return merged;
};

const groupTargetIdentity = (group: GeminiRawRecord): string =>
  canonical([
    hasOwn(group, 'name') ? group.name : undefined,
    getGeminiGroupKeys(group)
      .map((key) => canonical(key['api-key']))
      .sort(),
  ]);

export const rebaseGeminiTargets = (
  beforeGroups: GeminiGroups,
  afterGroups: GeminiGroups,
  targets: GeminiTarget[]
): GeminiTarget[] =>
  targets.map((target) => {
    const beforeGroup = groupAt(beforeGroups, target.groupIndex);
    const signature = groupTargetIdentity(beforeGroup);
    const matches = afterGroups.flatMap((group, index) =>
      groupTargetIdentity(group) === signature ? [index] : []
    );
    if (matches.length !== 1) return fail('Gemini group identity is missing or ambiguous.');
    const groupIndex = matches[0];
    if (target.keyIndex === undefined) return { groupIndex };
    const beforeKey = keyAt(beforeGroups, target);
    const keySignature = canonical([beforeKey['api-key'], beforeKey.name]);
    const keyMatches = getGeminiGroupKeys(afterGroups[groupIndex]).flatMap((key, index) =>
      canonical([key['api-key'], key.name]) === keySignature ? [index] : []
    );
    if (keyMatches.length !== 1) return fail('Gemini key identity is missing or ambiguous.');
    return { groupIndex, keyIndex: keyMatches[0] };
  });
