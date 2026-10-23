import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { StatCards } from '@/components/usage/StatCards';
import {
  buildDailyTokenBreakdown,
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
} from '@/utils/usage';
import en from '@/i18n/locales/en.json';

const fixture = {
  total_requests: 1,
  total_tokens: 15,
  apis: {
    fixture: {
      models: {
        enterprise: {
          details: [
            {
              timestamp: '2026-10-23T05:29:21Z',
              source: 'gemini-enterprise-fixture.json',
              auth_index: 'fixture',
              failed: false,
              tokens: {
                input_tokens: 12,
                output_tokens: 3,
                reasoning_tokens: null,
                cached_tokens: null,
                total_tokens: 15,
              },
            },
          ],
        },
      },
    },
  },
};

describe('Enterprise token statistics', () => {
  test('counts known usage and charges no cache discount or hidden reasoning', () => {
    const [detail] = collectUsageDetails(fixture);
    expect(detail.tokens.reasoning_tokens).toBeNull();
    expect(detail.tokens.cached_tokens).toBeNull();
    expect(extractTotalTokens(detail)).toBe(15);
    expect(
      calculateCost(detail, { enterprise: { prompt: 1, completion: 2, cache: 0.1 } })
    ).toBeCloseTo(0.000018, 10);
    expect(JSON.parse(JSON.stringify(detail.tokens))).toEqual(
      fixture.apis.fixture.models.enterprise.details[0].tokens
    );
    const series = buildDailyTokenBreakdown(fixture);
    expect(series.dataByCategory.reasoning).toEqual([null]);
    expect(series.dataByCategory.cached).toEqual([null]);
    expect(series.availableCategories.sort()).toEqual(['input', 'output']);
  });

  test('summary keeps unknown thinking and cache while including total and TPM', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(StatCards, {
          usage: fixture,
          loading: false,
          modelPrices: {},
          nowMs: Date.parse('2026-10-23T05:30:00Z'),
          sparklines: { requests: null, tokens: null, rpm: null, tpm: null, cost: null },
        })
      )
    );
    expect(markup.split(en.usage_stats.tokens_unavailable)).toHaveLength(3);
    expect(markup).toContain('15');
    expect(markup).toContain('0.5');
    expect(markup).not.toContain('≈');
  });
});
