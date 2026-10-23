import { describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n';
import { normalizeAuthFileCooldowns } from '../src/services/api/authFileCooldowns';
import { authFilesApi } from '../src/services/api/authFiles';
import { apiClient } from '../src/services/api/client';
import { AuthFileCooldownSection } from '../src/features/authFiles/components/AuthFileCooldownSection';

const poolId = 'a'.repeat(64);
const raw = {
  scope: 'credential',
  reason: 'credential_quota',
  origin: 'shared_pool',
  feature: 'assistant_search',
  pool_id: poolId,
  pool_version: 7,
  related_auth_count: 3,
  phase: 'cooling',
  retry_at: '2026-10-24T07:00:00Z',
  remaining_seconds: 300,
  shared_reset_supported: true,
};
const normalize = (record: Record<string, unknown> = raw) =>
  normalizeAuthFileCooldowns([record], undefined, Date.now())!;
const render = (record: Record<string, unknown> = raw) =>
  renderToStaticMarkup(
    createElement(AuthFileCooldownSection, { snapshot: normalize(record), onReset: () => {} })
  );

describe('Enterprise shared quota contract', () => {
  test('retains credential scope and optional pool metadata', () => {
    expect(normalize().records?.[0]).toMatchObject({
      scope: 'credential',
      origin: 'shared_pool',
      poolId,
      poolVersion: 7,
      relatedAuthCount: 3,
    });
    expect(normalizeAuthFileCooldowns(undefined, undefined, 0)).toBeUndefined();
    expect(
      normalize({ ...raw, origin: '', pool_id: '', pool_version: 0 }).records?.[0].origin
    ).toBeUndefined();
  });

  test('represents pending/probing with zero seconds and rejects fabricated timers', () => {
    for (const phase of ['probe_pending', 'probing']) {
      expect(normalize({ ...raw, phase, remaining_seconds: 0 }).records?.[0].phase).toBe(phase);
      expect(normalize({ ...raw, phase, remaining_seconds: 30 }).records).toBeNull();
    }
    for (const record of [
      { ...raw, pool_id: '<script>' },
      { ...raw, pool_version: 0 },
      { ...raw, phase: 'restored' },
      { ...raw, remaining_seconds: 0 },
      { ...raw, feature: 'future_feature' },
      { ...raw, scope: 'model', model_key: 'model-a' },
      { ...raw, restriction_kind: 'future_kind' },
      { ...raw, restriction_scope: 'organization' },
    ]) {
      expect(normalize(record).records).toBeNull();
    }
  });

  test('shows verification status without claiming that quota recovered', () => {
    for (const phase of ['probe_pending', 'probing']) {
      const markup = render({ ...raw, phase, remaining_seconds: 0 });
      expect(markup).toContain(i18n.t(`auth_files.shared_quota_${phase}`));
      expect(markup).toContain(i18n.t('auth_files.shared_quota_all_text'));
      expect(markup).not.toContain(i18n.t('auth_files.cooldown_timer_elapsed'));
      expect(markup).toContain('<summary');
    }
  });

  test('only exposes the shared operation when the backend explicitly supports it', () => {
    expect(render()).toContain(i18n.t('auth_files.shared_quota_retry_button'));
    expect(render({ ...raw, shared_reset_supported: false })).not.toContain(
      i18n.t('auth_files.shared_quota_retry_button')
    );
    expect(render({ ...raw, shared_reset_supported: 'true' })).not.toContain(
      i18n.t('auth_files.shared_quota_retry_button')
    );
    expect(render({ ...raw, related_auth_count: undefined })).not.toContain(
      i18n.t('auth_files.shared_quota_retry_button')
    );
    expect(render({ ...raw, related_auth_count: undefined })).not.toContain(
      i18n.t('auth_files.shared_quota_related', { count: 1 })
    );
  });

  test('sends the selected version and pool as an explicit v8 operation', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      affected_auth_indexes: ['a', 'b', 'c'],
    });
    try {
      await authFilesApi.retrySharedQuota('a', poolId, 7);
      expect(post).toHaveBeenCalledWith('/routing/cooldown/reset', {
        auth_index: 'a',
        reset_scope: 'shared_pool',
        pool_id: poolId,
        pool_version: 7,
      });
    } finally {
      post.mockRestore();
    }
  });

  test('all six locales supply the full verification and impact wording', () => {
    const reference = i18n.getResource('en', 'translation', 'auth_files') as Record<string, string>;
    for (const lng of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const values = i18n.getResource(lng, 'translation', 'auth_files') as Record<string, string>;
      for (const key of Object.keys(reference).filter((key) => key.startsWith('shared_quota_'))) {
        expect(values[key]).toBeString();
        expect(i18n.t(`auth_files.${key}`, { lng, count: 3 })).not.toContain('{{');
      }
    }
  });
});
