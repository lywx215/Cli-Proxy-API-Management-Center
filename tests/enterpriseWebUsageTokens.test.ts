import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { RequestEventsDetailsCard } from '@/components/usage/RequestEventsDetailsCard';
import { ModelStatsCard } from '@/components/usage/ModelStatsCard';
import { ApiDetailsCard } from '@/components/usage/ApiDetailsCard';
import { StatCards } from '@/components/usage/StatCards';
import { collectUsageDetails, getApiStats, getModelStats } from '@/utils/usage';
import {
  normalizeRequestTokenCounts,
  normalizeTokenEstimate,
} from '@/utils/usage/tokenAvailability';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';
import ko from '@/i18n/locales/ko.json';

const estimate = {
  source: 'local_gemma3_sentencepiece',
  input_text_tokens: 23,
  incomplete: true,
  response_complete: true,
};
const partial = {
  input_tokens: null,
  output_tokens: 7,
  reasoning_tokens: 3,
  cached_tokens: null,
  total_tokens: null,
  estimate,
};
const row = (tokens: Record<string, unknown>, provider = 'gemini-enterprise-web') => ({
  provider,
  source: `${provider}-synthetic.json`,
  timestamp: '2026-11-05T11:00:00Z',
  auth_index: 'fixture',
  latency_ms: 1250,
  failed: false,
  tokens,
});
const usage = {
  total_requests: 5,
  total_tokens: 0,
  apis: {
    fixture: {
      total_requests: 5,
      total_tokens: 0,
      models: {
        'web-estimate': { total_requests: 1, total_tokens: 0, details: [row(partial)] },
        'web-empty': { details: [row({ ...partial, output_tokens: 0, reasoning_tokens: null })] },
        'web-partial-response': {
          details: [
            {
              ...row({ ...partial, estimate: { ...estimate, response_complete: false } }),
              failed: true,
            },
          ],
        },
        'web-old': {
          details: [row({ input_tokens: 0, output_tokens: 0, total_tokens: 0 })],
        },
        'ordinary-enterprise': {
          details: [
            row(
              {
                input_tokens: 11,
                output_tokens: 5,
                reasoning_tokens: null,
                cached_tokens: null,
                total_tokens: 16,
              },
              'gemini-enterprise'
            ),
          ],
        },
      },
    },
  },
};

test('Web text subset and source survive normalization without filling totals', () => {
  const normalized = normalizeRequestTokenCounts(partial, 'gemini-enterprise-web');
  expect(normalized).toEqual(partial);
  expect(JSON.parse(JSON.stringify(normalized))).toEqual(partial);
  expect(
    normalizeRequestTokenCounts({ ...partial, total_tokens: 33 }, 'gemini-enterprise-web')
      .total_tokens
  ).toBeNull();
  expect(
    normalizeRequestTokenCounts({ output_tokens: 7 }, 'gemini-enterprise-web').total_tokens
  ).toBeNull();
  expect(collectUsageDetails(usage).find((r) => r.__modelName === 'web-estimate')?.tokens).toEqual(
    partial
  );
  expect(
    normalizeRequestTokenCounts({ input_tokens: 11, output_tokens: 5 }, 'gemini-enterprise')
      .total_tokens
  ).toBe(16);
  expect(
    normalizeRequestTokenCounts({ input_tokens: 11, output_tokens: 5 }, 'gemini-enterprise')
      .estimate
  ).toBeUndefined();
});

test('estimate metadata preserves real zero, rejects malformed sources and does not backfill old rows', () => {
  expect(normalizeTokenEstimate({ ...estimate, input_text_tokens: 0 })?.input_text_tokens).toBe(0);
  for (const input of [-1, NaN, Infinity, '23', 1.5, null, undefined]) {
    expect(
      normalizeTokenEstimate({ ...estimate, input_text_tokens: input })?.input_text_tokens
    ).toBeNull();
  }
  for (const value of [
    undefined,
    null,
    [],
    { ...estimate, source: 'unknown' },
    { ...estimate, incomplete: 'true' },
  ]) {
    expect(normalizeTokenEstimate(value)).toBeUndefined();
  }
  const old = normalizeRequestTokenCounts(
    { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    'gemini-enterprise-web'
  );
  expect(old.estimate).toBeUndefined();
  expect(old.total_tokens).toBeNull();
});

for (const [language, translation] of Object.entries({
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ru,
  vi,
  ko,
})) {
  test(`${language}: estimates, thought summaries, unknown media and partial responses are explicit`, async () => {
    const i18n = createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(RequestEventsDetailsCard, {
          usage,
          loading: false,
          geminiKeys: [],
          claudeConfigs: [],
          codexConfigs: [],
          vertexConfigs: [],
          openaiProviders: [],
        })
      )
    );
    const rows = [...markup.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    const counted = rows.find((r) => r.includes('web-estimate')) ?? '';
    const empty = rows.find((r) => r.includes('web-empty')) ?? '';
    const old = rows.find((r) => r.includes('web-old')) ?? '';
    const failed = rows.find((r) => r.includes('web-partial-response')) ?? '';
    const enterprise = rows.find((r) => r.includes('ordinary-enterprise')) ?? '';
    expect(counted).toContain('≈ 23');
    expect(counted).toContain('≈ 7');
    expect(counted).toContain('≈ 3');
    expect(counted).toContain(translation.usage_stats.web_tokens_estimated_source);
    expect(counted).toContain(translation.usage_stats.web_tokens_summary_hint);
    expect(counted).toContain(translation.usage_stats.web_tokens_incomplete);
    expect(counted).toContain('aria-label=');
    expect(counted.split(`<td>${translation.usage_stats.tokens_unavailable}</td>`)).toHaveLength(4);
    expect(empty).toContain('≈ 0');
    expect(empty.split(`<td>${translation.usage_stats.tokens_unavailable}</td>`)).toHaveLength(5);
    expect(old).not.toContain('≈');
    expect(old).not.toContain(translation.usage_stats.web_tokens_estimated_source);
    expect(failed).toContain(translation.usage_stats.web_tokens_partial_response);
    expect(failed).toContain(translation.stats.failure);
    expect(enterprise).not.toContain('≈');
    expect(enterprise).toContain('<td>16</td>');
    expect(markup).toContain(translation.usage_stats.web_input_text_tokens);
    expect(markup).toContain(translation.usage_stats.web_tokens_unavailable_hint);
    for (const key of Object.keys(en.usage_stats).filter(
      (key) => key.startsWith('web_token') || key === 'web_input_text_tokens'
    )) {
      expect((translation.usage_stats as Record<string, string>)[key]?.length).toBeGreaterThan(0);
    }
  });
}

test('partial estimates do not become complete aggregate usage or costs', async () => {
  const prices = { 'web-estimate': { prompt: 1, completion: 2, cache: 0 } };
  const models = getModelStats(usage, prices);
  const apis = getApiStats(usage, prices);
  expect(models.find((r) => r.model === 'web-estimate')?.tokensIncomplete).toBe(true);
  expect(apis[0].tokensIncomplete).toBe(true);
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ModelStatsCard, { modelStats: models, loading: false, hasPrices: true })
    )
  );
  const row =
    [...markup.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].find((m) => m[1].includes('web-estimate'))?.[1] ??
    '';
  expect(row).toContain(en.usage_stats.tokens_unavailable);
  expect(row).not.toContain('$0.00');
  for (const view of [
    createElement(ApiDetailsCard, { apiStats: apis, loading: false, hasPrices: true }),
    createElement(StatCards, {
      usage,
      loading: false,
      modelPrices: prices,
      nowMs: Date.parse('2026-11-05T11:01:00Z'),
      sparklines: { requests: null, tokens: null, rpm: null, tpm: null, cost: null },
    }),
  ]) {
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, view));
    expect(html).toContain(en.usage_stats.tokens_unavailable);
    expect(html).not.toContain('$0.00');
  }
});
