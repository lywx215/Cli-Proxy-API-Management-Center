import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import { enterpriseCollectionFiles } from '@/features/authFiles/enterpriseAccounts';
import {
  enterpriseSubscriptionGroup,
  enterpriseSubscriptionUnknownReason,
  groupEnterpriseCollections,
} from '@/features/authFiles/enterpriseCollectionGroups';
import { GeminiEnterpriseAccount } from '@/features/authFiles/components/GeminiEnterpriseAccount';
import type { EnterpriseModelPolicyState } from '@/types/authFile';

type Subscription = EnterpriseModelPolicyState['subscription'];
type Entry = { id: string; subscription?: Subscription; disabled?: boolean };

const mixedEntries: Entry[] = [
  { id: 'missing' },
  {
    id: 'trial-business',
    subscription: { status: 'ok', edition: 'business_standard', freeTrial: true },
  },
  {
    id: 'paid-disabled',
    disabled: true,
    subscription: { status: 'ok', edition: 'enterprise_plus', freeTrial: false },
  },
  {
    id: 'trial-cached',
    subscription: { status: 'stale', edition: 'enterprise_plus', freeTrial: true },
  },
  {
    id: 'unassigned',
    subscription: { status: 'unassigned', edition: 'enterprise_plus', freeTrial: false },
  },
  {
    id: 'paid-cached',
    subscription: { status: 'stale', edition: 'business_standard', freeTrial: false },
  },
];

function parent(entries = mixedEntries, disabled = false) {
  return normalizeAuthFilesResponse({
    files: [
      {
        name: 'grouped-account.json',
        type: 'gemini-enterprise',
        email: 'grouped@example.invalid',
        auth_index: 'parent-index',
        disabled,
        gemini_enterprise: {
          account_id: 'grouped-account',
          revision: 1,
          collections: entries.map(({ id, subscription, disabled }, index) => ({
            binding_id: id,
            auth_index: id,
            revision: 1,
            project_id: '123456',
            project_name: 'Shared project',
            location: ['global', 'us', 'eu', 'au', 'ca', 'asia'][index],
            collection_id: 'default_collection',
            engine_id: 'fixture-engine',
            disabled,
            success: index + 1,
            failed: 0,
            settings: {},
            model_policy_state: subscription
              ? {
                  mode: 'auto',
                  effective_mode: 'catalog',
                  status: subscription.status === 'stale' ? 'stale' : 'ok',
                  subscription: {
                    status: subscription.status,
                    edition: subscription.edition,
                    free_trial: subscription.freeTrial,
                    reason: subscription.reason,
                  },
                }
              : undefined,
          })),
        },
      },
    ],
  }).files[0];
}

const groupIds = (file = parent()) =>
  groupEnterpriseCollections(enterpriseCollectionFiles(file)).map(({ kind, files }) => ({
    kind,
    ids: files.map((child) => child.authIndex),
  }));

const noOp = () => {};
const card = (file = parent()) =>
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
  });

describe('Enterprise application subscription groups', () => {
  test('groups confirmed paid, trial and unknown applications without losing regions or input order', () => {
    const files = Object.freeze(enterpriseCollectionFiles(parent()));
    const groups = groupEnterpriseCollections(files);
    expect(groupIds()).toEqual([
      { kind: 'paid', ids: ['paid-disabled', 'paid-cached'] },
      { kind: 'trial', ids: ['trial-business', 'trial-cached'] },
      { kind: 'unknown', ids: ['missing', 'unassigned'] },
    ]);
    expect(groups.flatMap((group) => group.files)).toHaveLength(files.length);
    expect(groups[0].files[0]).toBe(files[2]);
    expect(files.map((file) => file.authIndex)).toEqual(mixedEntries.map((entry) => entry.id));
    expect(groupIds(parent(mixedEntries, true))).toEqual(groupIds());
  });

  test('requires a verified trial flag, independently of edition colors and model overrides', () => {
    for (const status of ['ok', 'stale']) {
      expect(enterpriseSubscriptionGroup({ status, freeTrial: false })).toBe('paid');
      expect(
        enterpriseSubscriptionGroup({ status, freeTrial: true, edition: 'future_edition' })
      ).toBe('trial');
      expect(enterpriseSubscriptionGroup({ status, freeTrial: null })).toBe('unknown');
    }
    expect(enterpriseSubscriptionGroup()).toBe('unknown');
    for (const status of ['unknown', 'unassigned', 'inactive', 'conflict', 'expired', '']) {
      for (const freeTrial of [false, true, null]) {
        expect(enterpriseSubscriptionGroup({ status, freeTrial })).toBe('unknown');
      }
    }
  });

  test('omits empty sections and moves changed subscriptions without duplicating applications', () => {
    expect(groupEnterpriseCollections([])).toEqual([]);
    expect(groupIds(parent([{ id: 'pending' }]))).toEqual([{ kind: 'unknown', ids: ['pending'] }]);
    expect(
      groupIds(parent([{ id: 'pending', subscription: { status: 'ok', freeTrial: false } }]))
    ).toEqual([{ kind: 'paid', ids: ['pending'] }]);
  });

  test('retains concrete verification failures and supplies reasons for incomplete observations', () => {
    expect(
      enterpriseSubscriptionUnknownReason({
        status: 'unknown',
        freeTrial: null,
        reason: 'unknown_subscription_tier',
      })
    ).toBe('unknown_subscription_tier');
    expect(enterpriseSubscriptionUnknownReason()).toBe('subscription_unverified');
    for (const [status, reason] of [
      ['unassigned', 'license_unassigned'],
      ['inactive', 'subscription_inactive'],
      ['conflict', 'conflicting_subscriptions'],
      ['expired', 'subscription_inactive'],
      ['ok', 'subscription_type_unknown'],
      ['stale', 'subscription_type_unknown'],
    ]) {
      expect(enterpriseSubscriptionUnknownReason({ status, freeTrial: null })).toBe(reason);
    }
    expect(
      enterpriseSubscriptionUnknownReason({
        status: 'stale',
        freeTrial: true,
        reason: 'subscription_refresh_failed',
      })
    ).toBeUndefined();
  });
});

describe('Enterprise application group rendering', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
    test(`orders groups and hides complete trial rows with translated controls in ${locale}`, async () => {
      const translations = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      const i18n = createInstance();
      await i18n.init({ lng: locale, resources: { [locale]: { translation: translations } } });
      const markup = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, card()));
      expect(
        [...markup.matchAll(/data-subscription-group="([^"]+)"/g)].map((match) => match[1])
      ).toEqual(['paid', 'trial', 'unknown']);
      expect([...markup.matchAll(/data-binding-id="([^"]+)"/g)].map((match) => match[1])).toEqual([
        'paid-disabled',
        'paid-cached',
        'trial-business',
        'trial-cached',
        'missing',
        'unassigned',
      ]);
      const bodies = [...markup.matchAll(/<tbody id="([^"]+)"([^>]*)>([\s\S]*?)<\/tbody>/g)];
      expect(bodies).toHaveLength(3);
      bodies.forEach((body, index) => {
        const expanded = index !== 1;
        expect(markup).toContain(`aria-expanded="${expanded}" aria-controls="${body[1]}"`);
        expect(body[2].includes('hidden=""')).toBe(!expanded);
        expect(body[3].match(/<tr\b/g)).toHaveLength(4);
      });
      for (const kind of ['paid', 'trial', 'unknown']) {
        expect(markup).toContain(
          i18n.t('gemini_enterprise.collections.group_' + kind, { count: 2 })
        );
      }
      expect(markup).toContain(
        i18n.t('gemini_enterprise.collections.count', { projects: 1, collections: 6 })
      );
      expect(markup).toContain(translations.gemini_enterprise.collections.expand_group);
      expect(markup).toContain(translations.gemini_enterprise.collections.collapse_group);
      expect(markup).toContain(translations.gemini_enterprise.policy.reason_license_unassigned);
      expect(markup).toContain(
        translations.gemini_enterprise.policy.reason_subscription_unverified
      );
      expect(markup).toContain(translations.gemini_enterprise.policy.stale);
      expect(translations.gemini_enterprise.policy.reason_subscription_type_unknown).toBeTruthy();
      expect(markup).not.toContain('gemini_enterprise.');
    });
  }
});
