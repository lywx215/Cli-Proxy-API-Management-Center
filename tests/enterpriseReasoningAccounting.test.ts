import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { RequestEventsDetailsCard } from '@/components/usage/RequestEventsDetailsCard';
import {
  collectUsageDetails,
  collectUsageDetailsWithEndpoint,
  calculateCost,
  calculateTotalCost,
  calculateRecentPerMinuteRates,
  calculateTokenBreakdown,
  getApiStats,
  getModelStats,
  buildDailyTokenBreakdown,
  buildDailyCostSeries,
  type UsageDetail,
} from '@/utils/usage';
import en from '@/i18n/locales/en.json';

const model = 'gemini-3.8-flash';
const prices = { [model]: { prompt: 1, completion: 2, cache: 0.1 } };
const detail = (
  reasoning: number | null = 50,
  provider: string | undefined = 'gemini-enterprise'
) => ({
  timestamp: new Date(Date.now() - 1000).toISOString(),
  source: 'account-without-filename@example.invalid',
  auth_index: 'synthetic-collection',
  provider,
  latency_ms: 2400,
  failed: false,
  tokens: {
    input_tokens: 1000,
    output_tokens: 100,
    reasoning_tokens: reasoning,
    cached_tokens: null,
    total_tokens: 1100 + (reasoning ?? 0),
  },
});
const usage = (row = detail()) => ({
  apis: {
    'POST /v1/chat/completions': {
      total_requests: 1,
      total_tokens: row.tokens.total_tokens,
      models: {
        [model]: { total_requests: 1, total_tokens: row.tokens.total_tokens, details: [row] },
      },
    },
  },
});

test('Enterprise provider and separate token buckets survive all normalization paths', () => {
  const data = usage();
  for (const rows of [collectUsageDetails(data), collectUsageDetailsWithEndpoint(data)]) {
    expect(rows[0].provider).toBe('gemini-enterprise');
    expect(rows[0].tokens).toEqual({
      input_tokens: 1000,
      output_tokens: 100,
      reasoning_tokens: 50,
      cached_tokens: null,
      total_tokens: 1150,
    });
  }
  expect(calculateRecentPerMinuteRates(1, data).tokenCount).toBe(1150);
  expect(calculateTokenBreakdown(data).reasoningTokens).toBe(50);
  expect(buildDailyTokenBreakdown(data).dataByCategory.reasoning).toEqual([50]);
  expect(buildDailyTokenBreakdown(data).dataByCategory.output).toEqual([100]);
});

test('Enterprise charges body and reasoning once consistently across summaries and charts', () => {
  const data = usage();
  const cost = 0.0013;
  const row = collectUsageDetails(data)[0];
  expect(calculateCost(row, prices)).toBeCloseTo(cost, 12);
  expect(calculateTotalCost(data, prices)).toBeCloseTo(cost, 12);
  expect(getApiStats(data, prices)[0].totalCost).toBeCloseTo(cost, 12);
  expect(getModelStats(data, prices)[0].cost).toBeCloseTo(cost, 12);
  expect(buildDailyCostSeries(data, prices).data[0]).toBeCloseTo(cost, 12);
});

test('reasoning null and genuine zero remain distinct without charging missing reasoning', () => {
  for (const value of [null, 0]) {
    const data = usage(detail(value));
    const row = collectUsageDetails(data)[0];
    expect(row.tokens.reasoning_tokens).toBe(value);
    expect(row.tokens.cached_tokens).toBeNull();
    expect(row.tokens.total_tokens).toBe(1100);
    expect(calculateCost(row, prices)).toBeCloseTo(0.0012, 12);
    expect(buildDailyTokenBreakdown(data).dataByCategory.reasoning).toEqual([value]);
  }
});

test('provider metadata never changes other or historical provider charges', () => {
  for (const provider of [undefined, 'gemini', 'codex', 'claude', 'openai-compatibility']) {
    const row = { ...detail(50), provider, __modelName: model } as UsageDetail;
    expect(calculateCost(row, prices)).toBeCloseTo(0.0012, 12);
  }
});

test('request rows show separate reasoning without a live credential lookup or provenance badge', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(RequestEventsDetailsCard, {
        usage: usage(),
        loading: false,
        geminiKeys: [],
        claudeConfigs: [],
        codexConfigs: [],
        vertexConfigs: [],
        openaiProviders: [],
      })
    )
  );
  const row = markup.match(/<tr>[^]*?gemini-3\.8-flash[^]*?<\/tr>/)?.[0] ?? '';
  expect(row).toContain('<td>1,000</td>');
  expect(row).toContain('<td>100</td>');
  expect(row).toContain('<td>50</td>');
  expect(row).toContain('<td>1,150</td>');
  expect(row).toContain(en.usage_stats.tokens_unavailable);
  expect(markup).toContain(en.usage_stats.enterprise_tokens_unavailable_hint);
  expect(row).not.toContain('≈');
  expect(row).not.toContain('estimated');
});
