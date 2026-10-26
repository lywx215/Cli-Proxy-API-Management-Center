import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { normalizeGeminiEnterpriseQuota } from '@/services/api/geminiEnterprise';
import { GeminiEnterpriseQuotaBody } from '@/features/authFiles/components/GeminiEnterpriseQuota';

const now = Date.now();
const pool = {
  tier: 'enterprise_plus',
  status: 'ok',
  limit: 10000,
  used: 6,
  remaining: 9994,
  usage_updated_at: new Date(now - 60_000).toISOString(),
};
const legacy = {
  status: 'ok',
  observed_at: new Date(now).toISOString(),
  period_start: new Date(now - 3_600_000).toISOString(),
  reset_at: new Date(now + 3_600_000).toISOString(),
  pools: [pool],
};

describe('standalone Enterprise quota compatibility', () => {
  test('accepts a legacy pool without requiring account or Collection fields', () => {
    const data = normalizeGeminiEnterpriseQuota(legacy);
    expect(data.selectedPool).toMatchObject({
      status: 'ok',
      limit: 10000,
      used: 6,
      remaining: 9994,
    });
    expect(data.accountId).toBeUndefined();
    expect(data.bindingId).toBeUndefined();
  });

  for (const status of ['partial', 'stale']) {
    test(`preserves ${status}, real zero and unknown fields`, () => {
      const data = normalizeGeminiEnterpriseQuota({
        ...legacy,
        status,
        pools: [{ ...pool, status, limit: null, used: 0 }],
      });
      expect(data.status).toBe(status);
      expect(data.selectedPool).toMatchObject({
        status,
        limit: null,
        used: 0,
        remaining: null,
      });
    });
  }

  for (const selection of [null, 'invalid', 0]) {
    test(`does not replace explicit unknown selection ${JSON.stringify(selection)}`, () => {
      expect(
        normalizeGeminiEnterpriseQuota({ ...legacy, selected_pool: selection }).selectedPool
      ).toBeNull();
    });
  }

  test('uses an explicit selection instead of inferring it from pools', () => {
    expect(
      normalizeGeminiEnterpriseQuota({
        ...legacy,
        selected_pool: { ...pool, tier: 'enterprise_standard', used: 0 },
      }).selectedPool
    ).toMatchObject({ tier: 'enterprise_standard', used: 0, remaining: 10000 });
  });

  test('keeps multiple editions without guessing a selected balance', () => {
    const data = normalizeGeminiEnterpriseQuota({
      ...legacy,
      pools: [pool, { ...pool, tier: 'enterprise_standard' }],
    });
    expect(data.pools).toHaveLength(2);
    expect(data.selectedPool).toBeNull();
  });

  test('does not infer usage from a remaining value or turn missing amounts into zero', () => {
    expect(
      normalizeGeminiEnterpriseQuota({
        ...legacy,
        pools: [{ ...pool, used: null, remaining: 1234 }],
      }).selectedPool
    ).toMatchObject({ limit: 10000, used: null, remaining: null });
  });

  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
    const translations = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
    const messages = translations.gemini_enterprise.quota;
    const render = async (raw: unknown) => {
      const i18n = createInstance();
      await i18n.init({ lng: locale, resources: { [locale]: { translation: translations } } });
      return renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(GeminiEnterpriseQuotaBody, {
            state: {
              loading: false,
              fetchedAtMs: now,
              data: normalizeGeminiEnterpriseQuota(raw),
            },
          })
        )
      );
    };

    test(`${locale}: shows legacy amounts and genuine zero`, async () => {
      expect(await render(legacy)).toContain((9994).toLocaleString(locale));
      const html = await render({ ...legacy, pools: [{ ...pool, used: 0 }] });
      expect(html).toContain('<dd>0</dd>');
      expect(html).toContain((10000).toLocaleString(locale));
      expect(html).not.toContain(messages.not_provided);
    });

    test(`${locale}: shows each known partial field and leaves unknowns unavailable`, async () => {
      const html = await render({
        ...legacy,
        status: 'partial',
        pools: [{ ...pool, status: 'partial', used: null }],
      });
      expect(html).toContain(`<dd>${(10000).toLocaleString(locale)}</dd>`);
      expect(html.split(messages.not_provided)).toHaveLength(3);
      expect(html).toContain(messages.partial);
      expect(html).not.toContain('<dd>0</dd>');
      expect(html).not.toContain((9994).toLocaleString(locale));
    });

    test(`${locale}: retains zero even when the limit is missing`, async () => {
      const html = await render({
        ...legacy,
        status: 'partial',
        pools: [{ ...pool, status: 'partial', limit: null, used: 0 }],
      });
      expect(html).toContain('<dd>0</dd>');
      expect(html.split(messages.not_provided)).toHaveLength(3);
    });

    for (const selected of [false, true]) {
      test(`${locale}: stale pool outranks partial snapshot with ${selected ? 'explicit' : 'legacy'} selection`, async () => {
        const stalePool = { ...pool, status: 'stale' };
        const html = await render({
          ...legacy,
          status: 'partial',
          pools: [stalePool],
          ...(selected ? { selected_pool: stalePool } : {}),
        });
        expect(html).toContain(messages.stale);
        expect(html).not.toContain(messages.partial);
        expect(html).toContain((9994).toLocaleString(locale));
        expect(html).not.toContain(messages.not_provided);
        expect(html).not.toContain('gemini_enterprise.quota.');
      });
    }

    test(`${locale}: expires stale readings before showing the stale warning`, async () => {
      const html = await render({
        ...legacy,
        status: 'stale',
        reset_at: new Date(now - 1).toISOString(),
        pools: [{ ...pool, status: 'stale' }],
      });
      expect(html).toContain(messages.no_data);
      expect(html).not.toContain(messages.stale);
      expect(html).not.toContain((9994).toLocaleString(locale));
    });

    test(`${locale}: explicit null keeps the balance unknown despite legacy pools`, async () => {
      const html = await render({ ...legacy, selected_pool: null });
      expect(html.split(messages.not_provided)).toHaveLength(4);
      expect(html).not.toContain((9994).toLocaleString(locale));
    });
  }
});
