export const WEB_EXECUTION_STAGES = [
  'validation',
  'authentication',
  'session',
  'upload',
  'generation',
  'parse',
  'delivery',
] as const;

const WEB_ANSWER_STATES = ['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'] as const;

type WebExecutionObservation = {
  upstream_http_status?: number;
  client_http_status?: number;
  answer_state?: (typeof WEB_ANSWER_STATES)[number];
  google_status?: string;
  google_reason?: string;
  submitted: boolean;
  output_started: boolean;
  contents: number;
  attachments: number;
  attachment_bytes: number;
  stages_ms: Partial<Record<(typeof WEB_EXECUTION_STAGES)[number], number>>;
  total_ms: number;
};

export type ExecutionObservation = {
  version: 1;
  attempt_no: number;
  request_model: string;
  thinking_level: string | null;
  thinking_budget: number | null;
  include_thoughts: boolean | null;
  upstream_request_model: string | null;
  upstream_canonical_model: string | null;
  response_model: string | null;
  response_model_sequence: string[];
  models_truncated: boolean;
  model_match: 'exact' | 'mapped' | 'different' | 'not_reported';
  upstream_ttfb_ms: number | null;
  first_summary_ms: number | null;
  first_answer_ms: number | null;
  first_tool_call_ms: number | null;
  upstream_result:
    | 'complete'
    | 'terminal_observed'
    | 'compatibility_end'
    | 'incomplete'
    | 'rejected'
    | 'unknown'
    | 'not_sent'
    | 'continuation_required';
  completion_basis:
    'candidate_finish' | 'prompt_block' | 'compat_tool_eof' | 'web_answer_state' | 'none';
  candidate_finishes: { index: number; reason: string }[];
  tail_verification: 'verified' | 'unverified' | 'failed';
  delivery_result: 'written' | 'write_failed' | 'cancelled' | 'not_tracked';
  usage_result: 'official_complete' | 'official_partial' | 'estimated' | 'not_reported';
  error: {
    code: string;
    stage: string;
    scope: string;
    http_status: number;
    send_state: string;
    generation_state: string;
    replay_safety: string;
    retry_after_ms: number | null;
  } | null;
  web?: WebExecutionObservation;
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
const nullableModel = (value: unknown) => value === null || boundedString(value);
const nullableTime = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

function normalizeWebObservation(value: unknown): WebExecutionObservation | undefined {
  const count = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const time = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const status = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 100 && n <= 599 ? n : undefined;
  const googleCode = (s: unknown) =>
    typeof s === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(s) ? s : undefined;
  if (
    !record(value) ||
    typeof value.submitted !== 'boolean' ||
    typeof value.output_started !== 'boolean' ||
    !count(value.contents) ||
    !count(value.attachments) ||
    !count(value.attachment_bytes) ||
    !time(value.total_ms) ||
    !record(value.stages_ms)
  )
    return undefined;
  const stages = value.stages_ms;
  const stagesMs: WebExecutionObservation['stages_ms'] = {};
  for (const stage of WEB_EXECUTION_STAGES) {
    const ms = stages[stage];
    if (ms === undefined) continue;
    if (!time(ms)) return undefined;
    stagesMs[stage] = ms;
  }
  return {
    upstream_http_status: status(value.upstream_http_status),
    client_http_status: status(value.client_http_status),
    answer_state: WEB_ANSWER_STATES.find((state) => state === value.answer_state),
    google_status: googleCode(value.google_status),
    google_reason: googleCode(value.google_reason),
    submitted: value.submitted,
    output_started: value.output_started,
    contents: value.contents,
    attachments: value.attachments,
    attachment_bytes: value.attachment_bytes,
    stages_ms: stagesMs,
    total_ms: value.total_ms,
  };
}

// Reject only the optional observation, retaining historical accounting data.
export function normalizeExecutionObservation(value: unknown): ExecutionObservation | undefined {
  if (!record(value) || value.version !== 1 || !boundedString(value.request_model))
    return undefined;
  if (
    typeof value.attempt_no !== 'number' ||
    !Number.isSafeInteger(value.attempt_no) ||
    value.attempt_no < 0
  )
    return undefined;
  if (
    !nullableModel(value.thinking_level) ||
    (value.include_thoughts !== null && typeof value.include_thoughts !== 'boolean') ||
    (value.thinking_budget !== null && !Number.isSafeInteger(value.thinking_budget))
  )
    return undefined;
  for (const key of ['upstream_request_model', 'upstream_canonical_model', 'response_model']) {
    if (!nullableModel(value[key])) return undefined;
  }
  for (const key of [
    'upstream_ttfb_ms',
    'first_summary_ms',
    'first_answer_ms',
    'first_tool_call_ms',
  ]) {
    if (!nullableTime(value[key])) return undefined;
  }
  const enums: Record<string, readonly string[]> = {
    model_match: ['exact', 'mapped', 'different', 'not_reported'],
    upstream_result: [
      'complete',
      'terminal_observed',
      'compatibility_end',
      'incomplete',
      'rejected',
      'unknown',
      'not_sent',
      'continuation_required',
    ],
    completion_basis: [
      'candidate_finish',
      'prompt_block',
      'compat_tool_eof',
      'web_answer_state',
      'none',
    ],
    tail_verification: ['verified', 'unverified', 'failed'],
    delivery_result: ['written', 'write_failed', 'cancelled', 'not_tracked'],
    usage_result: ['official_complete', 'official_partial', 'estimated', 'not_reported'],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (typeof value[key] !== 'string' || !allowed.includes(value[key])) return undefined;
  }
  if (
    typeof value.models_truncated !== 'boolean' ||
    !Array.isArray(value.response_model_sequence) ||
    value.response_model_sequence.length > 8 ||
    !value.response_model_sequence.every(boundedString)
  )
    return undefined;
  if (
    !Array.isArray(value.candidate_finishes) ||
    value.candidate_finishes.length > 128 ||
    !value.candidate_finishes.every(
      (item) =>
        record(item) &&
        Number.isInteger(item.index) &&
        (item.index as number) >= 0 &&
        (item.index as number) < 128 &&
        boundedString(item.reason)
    )
  )
    return undefined;
  if (value.error !== null) {
    if (!record(value.error)) return undefined;
    for (const key of ['code', 'stage', 'scope'])
      if (!boundedString(value.error[key])) return undefined;
    if (
      !Number.isInteger(value.error.http_status) ||
      (value.error.http_status as number) < 0 ||
      (value.error.http_status as number) > 599 ||
      !nullableTime(value.error.retry_after_ms)
    )
      return undefined;
    if (
      !['not_sent', 'possibly_sent', 'response_received'].includes(
        String(value.error.send_state)
      ) ||
      !['not_started', 'started', 'unknown'].includes(String(value.error.generation_state)) ||
      !['safe', 'unsafe'].includes(String(value.error.replay_safety))
    )
      return undefined;
  }
  // A new object isolates consumers from the backend response and cached rows.
  const keys = [
    'version',
    'attempt_no',
    'request_model',
    'thinking_level',
    'thinking_budget',
    'include_thoughts',
    'upstream_request_model',
    'upstream_canonical_model',
    'response_model',
    'response_model_sequence',
    'models_truncated',
    'model_match',
    'upstream_ttfb_ms',
    'first_summary_ms',
    'first_answer_ms',
    'first_tool_call_ms',
    'upstream_result',
    'completion_basis',
    'candidate_finishes',
    'tail_verification',
    'delivery_result',
    'usage_result',
    'error',
  ];
  const safe = Object.fromEntries(keys.map((key) => [key, value[key]]));
  const web = normalizeWebObservation(value.web);
  if (value.completion_basis === 'web_answer_state' && !web) return undefined;
  if (web) safe.web = web;
  safe.candidate_finishes = value.candidate_finishes.map((item) => ({
    index: item.index,
    reason: item.reason,
  }));
  if (record(value.error)) {
    const errorKeys = [
      'code',
      'stage',
      'scope',
      'http_status',
      'send_state',
      'generation_state',
      'replay_safety',
      'retry_after_ms',
    ];
    safe.error = Object.fromEntries(
      errorKeys.map((key) => [key, (value.error as Record<string, unknown>)[key]])
    );
  }
  return JSON.parse(JSON.stringify(safe)) as ExecutionObservation;
}
