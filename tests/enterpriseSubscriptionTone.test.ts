import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { enterpriseSubscriptionTone } from '@/features/authFiles/enterpriseSubscriptionTone';
import { GeminiEnterpriseAccount } from '@/features/authFiles/components/GeminiEnterpriseAccount';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import type { EnterpriseModelPolicyState } from '@/types/authFile';

type Subscription = EnterpriseModelPolicyState['subscription'];

describe('Enterprise subscription row appearance', () => {
  test('distinguishes confirmed trials and gives paid subscriptions precedence in every edition', () => {
    for (const status of ['ok', 'stale']) {
      expect(
        enterpriseSubscriptionTone({ status, edition: 'business_standard', freeTrial: true })
      ).toBe('business-trial');
      expect(
        enterpriseSubscriptionTone({ status, edition: 'enterprise_plus', freeTrial: true })
      ).toBe('plus-trial');
      for (const edition of [
        'business_standard',
        'enterprise_plus',
        'enterprise_standard',
        'edu',
      ]) {
        expect(enterpriseSubscriptionTone({ status, edition, freeTrial: false })).toBe('paid');
      }
    }
  });

  test('does not color missing, unverified, revoked or expired subscription observations', () => {
    expect(enterpriseSubscriptionTone()).toBeUndefined();
    for (const status of ['unknown', 'conflict', 'unassigned', 'inactive', 'expired', '']) {
      for (const freeTrial of [true, false, null]) {
        expect(
          enterpriseSubscriptionTone({ status, edition: 'enterprise_plus', freeTrial })
        ).toBeUndefined();
      }
    }
    expect(
      enterpriseSubscriptionTone({ status: 'ok', edition: 'enterprise_plus', freeTrial: null })
    ).toBeUndefined();
    expect(
      enterpriseSubscriptionTone({ status: 'ok', edition: 'enterprise_standard', freeTrial: true })
    ).toBeUndefined();
  });

  test('keeps each mixed-account collection and its request row together regardless of routing state', async () => {
    const observations: { id: string; subscription?: Subscription; disabled?: boolean }[] = [
      {
        id: 'business',
        subscription: { status: 'ok', edition: 'business_standard', freeTrial: true },
      },
      { id: 'plus', subscription: { status: 'ok', edition: 'enterprise_plus', freeTrial: true } },
      {
        id: 'paid-business',
        subscription: { status: 'ok', edition: 'business_standard', freeTrial: false },
        disabled: true,
      },
      {
        id: 'cached',
        subscription: { status: 'stale', edition: 'enterprise_plus', freeTrial: false },
      },
      {
        id: 'unknown',
        subscription: { status: 'unknown', edition: 'enterprise_plus', freeTrial: false },
      },
      { id: 'legacy' },
    ];
    const file = normalizeAuthFilesResponse({
      files: [
        {
          name: 'mixed-appearance-fixture.json',
          type: 'gemini-enterprise',
          email: 'appearance@example.invalid',
          disabled: true,
          gemini_enterprise: {
            account_id: 'appearance-account',
            account_management_supported: true,
            collections: observations.map(({ id, subscription, disabled }, index) => ({
              binding_id: id,
              revision: 1,
              auth_index: id,
              project_id: String(100 + index),
              location: 'global',
              collection_id: 'default_collection',
              engine_id: 'appearance-engine',
              disabled,
              settings: { model_policy: 'custom', allowed_models: [] },
              model_policy_state: subscription
                ? {
                    mode: 'custom',
                    effective_mode: 'custom',
                    status: 'ok',
                    allowed_models: [],
                    catalog_known: true,
                    catalog_models: [],
                    effective_models: [],
                    subscription: {
                      status: subscription.status,
                      edition: subscription.edition,
                      free_trial: subscription.freeTrial,
                    },
                  }
                : undefined,
            })),
          },
        },
      ],
    }).files[0];
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: {} });
    const noOp = () => {};
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(GeminiEnterpriseAccount, {
          file,
          selected: false,
          disableControls: true,
          deleting: null,
          statusUpdating: {},
          manualRefreshing: {},
          onShowModels: noOp,
          onDownload: noOp,
          onManualRefresh: noOp,
          onOpenPrefixProxyEditor: noOp,
          onDelete: noOp,
          onToggleStatus: noOp,
          onToggleSelect: noOp,
        })
      )
    );
    const rows = [...markup.matchAll(/<tr\b[^>]*>/g)].map(([row]) => row);
    const expected = ['business-trial', 'plus-trial', 'paid', 'paid', undefined, undefined];
    observations.forEach(({ id }, index) => {
      const rowIndex = rows.findIndex((row) => row.includes(`data-binding-id="${id}"`));
      expect(rowIndex).toBeGreaterThanOrEqual(0);
      for (const row of rows.slice(rowIndex, rowIndex + 2)) {
        if (expected[index]) expect(row).toContain(`data-subscription-tone="${expected[index]}"`);
        else expect(row).not.toContain('data-subscription-tone');
      }
    });
    expect(markup.match(/data-subscription-tone=/g)).toHaveLength(8);
  });
});
