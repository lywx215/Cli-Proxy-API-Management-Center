import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ExecutionObservationDetails } from '@/components/usage/ExecutionObservationDetails';
import { EnterpriseWebStatus } from '@/features/authFiles/enterpriseWeb/EnterpriseWebStatus';
import { normalizeWebInputLimits } from '@/services/api/enterpriseWebInputLimits';
import { collectUsageDetails, collectUsageDetailsWithEndpoint } from '@/utils/usage';
import {
  normalizeExecutionObservation,
  type ExecutionObservation,
} from '@/utils/usage/observation';
import en from '@/i18n/locales/en.json';
import cn from '@/i18n/locales/zh-CN.json';
import tw from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';
import ko from '@/i18n/locales/ko.json';

const observation = (): ExecutionObservation => ({
  version: 1,
  attempt_no: 1,
  request_model: 'alias',
  thinking_level: 'LOW',
  thinking_budget: null,
  include_thoughts: true,
  upstream_request_model: 'native-low',
  upstream_canonical_model: 'native',
  response_model: 'native',
  response_model_sequence: ['native'],
  models_truncated: false,
  model_match: 'mapped',
  upstream_ttfb_ms: 0,
  first_summary_ms: null,
  first_answer_ms: 12.5,
  first_tool_call_ms: null,
  upstream_result: 'terminal_observed',
  completion_basis: 'candidate_finish',
  candidate_finishes: [{ index: 0, reason: 'MAX_TOKENS' }],
  tail_verification: 'unverified',
  delivery_result: 'written',
  usage_result: 'official_partial',
  error: null,
});

const webObservation = (): ExecutionObservation => ({
  ...observation(),
  request_model: 'gemini-4-argon',
  upstream_result: 'incomplete',
  completion_basis: 'web_answer_state',
  tail_verification: 'failed',
  error: {
    code: 'stream_truncated_json',
    stage: 'parse',
    scope: 'request',
    http_status: 502,
    send_state: 'response_received',
    generation_state: 'started',
    replay_safety: 'unsafe',
    retry_after_ms: null,
  },
  web: {
    upstream_http_status: 200,
    client_http_status: 200,
    answer_state: 'SUCCEEDED',
    submitted: true,
    output_started: true,
    contents: 201,
    attachments: 1,
    attachment_bytes: 123,
    stages_ms: { parse: 0, delivery: 0.75 },
    total_ms: 21.7,
  },
});

test('Web observations preserve separate HTTP statuses and bounded stage evidence', () => {
  const source = webObservation();
  const raw = {
    ...source,
    web: {
      ...source.web,
      raw_response: 'PRIVATE-RESPONSE',
      stages_ms: { ...source.web?.stages_ms, PRIVATE_STAGE: 17 },
    },
  };
  const normalized = normalizeExecutionObservation(raw);
  expect(normalized?.web?.client_http_status).toBe(200);
  expect(normalized?.web?.upstream_http_status).toBe(200);
  expect(normalized?.error?.http_status).toBe(502);
  expect(normalized?.web?.stages_ms.parse).toBe(0);
  expect(JSON.stringify(normalized)).not.toContain('PRIVATE');
  expect(normalizeExecutionObservation({ ...source, web: undefined })).toBeUndefined();
});

test('observations preserve null and real zero, reject invalid optional data, and omit unknown fields', () => {
  const source = {
    ...observation(),
    raw_prompt: 'must not export',
    candidate_finishes: [{ index: 0, reason: 'STOP', raw_signature: 'must not export' }],
  };
  const normalized = normalizeExecutionObservation(source)!;
  expect(normalized.upstream_ttfb_ms).toBe(0);
  expect(normalized.first_summary_ms).toBeNull();
  expect(JSON.stringify(normalized)).not.toContain('must not export');
  normalized.response_model_sequence.push('other');
  expect(source.response_model_sequence).toEqual(['native']);
  for (const bad of [
    undefined,
    { ...observation(), version: 2 },
    { ...observation(), first_answer_ms: -1 },
    { ...observation(), first_summary_ms: undefined },
    { ...observation(), delivery_result: 'success' },
    { ...observation(), upstream_ttfb_ms: NaN },
  ])
    expect(normalizeExecutionObservation(bad)).toBeUndefined();
});

test('both usage projections retain observations and execution identity, while legacy rows remain absent', () => {
  const usage = {
    apis: {
      'POST /v1beta': {
        models: {
          alias: {
            details: [
              {
                timestamp: '2026-11-08T10:00:00Z',
                failed: false,
                execution_id: 'execution-a',
                trace_id: 'trace-a',
                observation: observation(),
                tokens: { total_tokens: 12 },
              },
              { timestamp: '2026-11-08T10:00:00Z', failed: true, tokens: { total_tokens: 5 } },
            ],
          },
        },
      },
    },
  };
  for (const rows of [collectUsageDetails(usage), collectUsageDetailsWithEndpoint(usage)]) {
    expect(rows[0].execution_id).toBe('execution-a');
    expect(rows[0].trace_id).toBe('trace-a');
    expect(rows[0].observation?.tail_verification).toBe('unverified');
    expect(rows[1].observation).toBeUndefined();
    expect(rows[1].failed).toBe(true);
  }
});

for (const [language, locale] of Object.entries({ en, 'zh-CN': cn, 'zh-TW': tw, ru, vi, ko })) {
  test(`observation details and legacy absence render without fallback in ${language}`, async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: language,
      fallbackLng: false,
      resources: { [language]: { translation: locale } },
      interpolation: { escapeValue: false },
    });
    const render = (o?: ExecutionObservation) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(ExecutionObservationDetails, {
            observation: o,
            executionId: 'execution-a',
            traceId: 'trace-a',
          })
        )
      );
    const html = render(observation());
    expect(html).toContain(locale.usage_stats.observation.tail_unverified);
    expect(html).toContain(locale.usage_stats.observation.not_observed);
    expect(html).toContain('0.00 ms');
    expect(html).not.toContain('usage_stats.observation.');
    expect(render()).toContain(locale.usage_stats.observation.not_recorded);
    const web = render(webObservation());
    expect(web).toContain(locale.usage_stats.observation.web_client_http);
    expect(web).toContain(locale.usage_stats.observation.web_upstream_http);
    expect(web).toContain(locale.usage_stats.observation.web_failures.truncated);
    expect(web).toContain(locale.usage_stats.observation.web_stages.parse);
    expect(web).toContain('trace-a');
    expect(web).not.toContain('usage_stats.observation.');
    const status = {
      enabled: true,
      historyMode: 'serialized-context',
      supportedHistoryModes: ['serialized-context'],
      maxConcurrent: 2,
      maxInflightBytes: 268435456,
      activeRequests: 0,
      inflightBytes: 0,
      draining: false,
      rejectedConcurrency: 0,
      rejectedMemory: 0,
    } as const;
    const renderStatus = (unlimited: boolean) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(EnterpriseWebStatus, {
            status: {
              ...status,
              supportedHistoryModes: [...status.supportedHistoryModes],
              historyCountPolicy: unlimited ? 'unlimited' : undefined,
              supportsModelHistoryInlineData: unlimited ? true : undefined,
              inputLimits: normalizeWebInputLimits({}, true, unlimited ? 'unlimited' : undefined),
            },
          })
        )
      );
    const current = renderStatus(true);
    const legacy = renderStatus(false);
    expect(current).toContain(locale.enterprise_web.history_count_unlimited);
    expect(current).toContain(locale.enterprise_web.model_history_attachments);
    expect(legacy).toContain('4129');
    expect(legacy).toContain(locale.enterprise_web.model_history_attachments_unknown);
    expect(legacy).not.toContain(locale.enterprise_web.history_count_unlimited);
  });
}
