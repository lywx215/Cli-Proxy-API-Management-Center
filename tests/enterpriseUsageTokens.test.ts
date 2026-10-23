import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { RequestEventsDetailsCard } from '@/components/usage/RequestEventsDetailsCard';
import {
  isRequestTokenUsageAvailable,
  reportedRequestTokenValue,
} from '@/components/usage/requestTokenAvailability';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';
import ko from '@/i18n/locales/ko.json';

describe('Enterprise request token availability', () => {
  test('does not interpret Enterprise default zero counts as reported usage', () => {
    expect(isRequestTokenUsageAvailable('gemini-enterprise', 'custom.json', [0, 0, 0, 0, 0])).toBe(
      false
    );
    expect(isRequestTokenUsageAvailable(' GEMINI_ENTERPRISE ', '', [0])).toBe(false);
  });

  test('preserves future reported counts in any token bucket', () => {
    for (let bucket = 0; bucket < 5; bucket += 1) {
      const counts = [0, 0, 0, 0, 0];
      counts[bucket] = 1;
      expect(isRequestTokenUsageAvailable('gemini-enterprise', '', counts)).toBe(true);
    }
  });

  test('recognizes historical credentials before the auth file lookup completes', () => {
    for (const source of ['gemini-enterprise-fixture.json', 't:gemini-enterprise-fixture.json']) {
      expect(isRequestTokenUsageAvailable('', source, [0, 0, 0, 0, 0])).toBe(false);
    }
  });

  test('preserves other providers and trusts explicit credential types over filenames', () => {
    expect(isRequestTokenUsageAvailable('codex', 'codex-fixture.json', [0])).toBe(true);
    expect(isRequestTokenUsageAvailable('', 't:codex-fixture.json', [0])).toBe(true);
    expect(isRequestTokenUsageAvailable('claude', 'gemini-enterprise-fixture.json', [0])).toBe(
      true
    );
  });

  test('exports missing usage as null while preserving genuine numeric zero', () => {
    expect(JSON.stringify({ tokens: reportedRequestTokenValue(0, false) })).toBe('{"tokens":null}');
    expect(reportedRequestTokenValue(0, true)).toBe(0);
    expect(reportedRequestTokenValue(42, true)).toBe(42);
  });
});

const zeroTokens = {
  input_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  cached_tokens: 0,
  total_tokens: 0,
};

const detail = (source: string, tokens = zeroTokens) => ({
  timestamp: '2026-10-23T05:29:21Z',
  source,
  auth_index: 'fixture',
  latency_ms: 4050,
  tokens,
  failed: false,
});

const usage = {
  apis: {
    fixture: {
      models: {
        'enterprise-unreported': { details: [detail('gemini-enterprise-fixture.json')] },
        'other-zero': { details: [detail('codex-fixture.json')] },
        'enterprise-reported': {
          details: [
            detail('gemini-enterprise-fixture.json', {
              ...zeroTokens,
              input_tokens: 2,
              output_tokens: 3,
              total_tokens: 5,
            }),
          ],
        },
      },
    },
  },
};

for (const [language, translation] of Object.entries({
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ru,
  vi,
  ko,
})) {
  test(`${language}: missing tokens are distinct from zero without losing request results or latency`, async () => {
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
    const rows = [...markup.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
    const unreported = rows.find((row) => row.includes('enterprise-unreported')) ?? '';
    const otherZero = rows.find((row) => row.includes('other-zero')) ?? '';
    const reported = rows.find((row) => row.includes('enterprise-reported')) ?? '';
    const missingLabel = translation.usage_stats.tokens_unavailable;
    expect(unreported.split(`<td>${missingLabel}</td>`)).toHaveLength(6);
    expect(unreported).not.toContain('<td>0</td>');
    expect(unreported).toContain(translation.stats.success);
    expect(unreported).toContain('4.05');
    expect(otherZero.match(/<td>0<\/td>/g)).toHaveLength(5);
    expect(reported).toContain('<td>2</td>');
    expect(reported).toContain('<td>3</td>');
    expect(reported).toContain('<td>5</td>');
    expect(reported).not.toContain(missingLabel);
    expect(markup).toContain(translation.usage_stats.enterprise_tokens_unavailable_hint);
  });
}
