import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { EnterpriseModelPolicyState } from '@/types/authFile';
import {
  ENTERPRISE_MODEL_POLICIES,
  enterprisePolicyError,
  enterprisePolicyPreview,
  parseEnterpriseAllowedModels,
  type EnterprisePolicyDraft,
  type EnterprisePolicyField,
} from '../enterpriseModelPolicy';

export function EnterpriseModelPolicyStatus({
  snapshot,
  compact = false,
}: {
  snapshot?: EnterpriseModelPolicyState;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (!snapshot) return null;
  const subscription = snapshot.subscription;
  const timestamp = subscription.lastSuccessAt && Date.parse(subscription.lastSuccessAt);
  if (compact)
    return (
      <div className="hint" role="status">
        {[
          subscription.edition
            ? t('gemini_enterprise.policy.edition_' + subscription.edition, {
                defaultValue: subscription.edition,
              })
            : null,
          subscription.freeTrial === true ? t('gemini_enterprise.policy.trial') : null,
          t('gemini_enterprise.policy.mode_' + snapshot.effectiveMode, {
            defaultValue: snapshot.effectiveMode,
          }),
          snapshot.status === 'blocked'
            ? t('gemini_enterprise.policy.paused')
            : snapshot.status === 'stale'
              ? t('gemini_enterprise.policy.stale')
              : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    );
  return (
    <div className="hint" role="status">
      <div>
        {t('gemini_enterprise.policy.effective')}:{' '}
        {t('gemini_enterprise.policy.mode_' + snapshot.effectiveMode, {
          defaultValue: snapshot.effectiveMode,
        })}
      </div>
      {snapshot.mode === 'auto' && (
        <>
          <div>
            {t('gemini_enterprise.policy.subscription')}:{' '}
            {subscription.edition
              ? t('gemini_enterprise.policy.edition_' + subscription.edition, {
                  defaultValue: subscription.edition,
                })
              : t('gemini_enterprise.policy.unknown')}
          </div>
          {subscription.freeTrial !== null && (
            <div>
              {t(
                subscription.freeTrial
                  ? 'gemini_enterprise.policy.trial'
                  : 'gemini_enterprise.policy.paid'
              )}
            </div>
          )}
          {timestamp && Number.isFinite(timestamp) ? (
            <div>
              {t('gemini_enterprise.policy.checked')}: {new Date(timestamp).toLocaleString()}
            </div>
          ) : null}
          {snapshot.status === 'blocked' && <div>{t('gemini_enterprise.policy.paused')}</div>}
          {snapshot.status === 'stale' && <div>{t('gemini_enterprise.policy.stale')}</div>}
          {snapshot.reason && (
            <div>
              {t('gemini_enterprise.policy.reason_' + snapshot.reason, {
                defaultValue: snapshot.reason,
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function EnterpriseModelPolicyFields({
  draft,
  snapshot,
  excluded,
  disabled,
  onChange,
}: {
  draft: EnterprisePolicyDraft;
  snapshot?: EnterpriseModelPolicyState;
  excluded: string[];
  disabled: boolean;
  onChange: (field: EnterprisePolicyField, value: string | boolean) => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const allowedId = useId();
  const error = enterprisePolicyError(draft);
  const preview = enterprisePolicyPreview(draft, snapshot, excluded);
  const selected = parseEnterpriseAllowedModels(draft.allowedText);
  return (
    <fieldset className="form-group" disabled={disabled}>
      <legend id={labelId}>{t('gemini_enterprise.policy.label')}</legend>
      <Select
        value={draft.mode}
        options={ENTERPRISE_MODEL_POLICIES.map((mode) => ({
          value: mode,
          label: t('gemini_enterprise.policy.mode_' + mode),
        }))}
        disabled={disabled}
        ariaLabelledBy={labelId}
        fullWidth
        onChange={(value) => onChange('enterpriseModelPolicy', value)}
      />
      <p className="hint">{t('gemini_enterprise.policy.hint')}</p>
      <EnterpriseModelPolicyStatus snapshot={snapshot} />
      {draft.mode === 'custom' && (
        <>
          <label>{t('gemini_enterprise.policy.whitelist')}</label>
          <ToggleSwitch
            checked={draft.whitelistEnabled}
            disabled={disabled}
            ariaLabel={t('gemini_enterprise.policy.whitelist')}
            onChange={(value) => onChange('enterpriseWhitelistEnabled', value)}
          />
          {draft.whitelistEnabled && (
            <>
              <label htmlFor={allowedId}>{t('gemini_enterprise.policy.allowed')}</label>
              <textarea
                id={allowedId}
                className="input"
                rows={4}
                value={draft.allowedText}
                aria-invalid={Boolean(error)}
                disabled={disabled}
                onChange={(event) => onChange('enterpriseAllowedModelsText', event.target.value)}
              />
              <div className="hint">{t('gemini_enterprise.policy.allowed_hint')}</div>
              {error && <div className="error-box">{t(error)}</div>}
              {snapshot?.catalogModels.map((entry) => (
                <label key={entry.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(entry.id)}
                    disabled={
                      disabled ||
                      /^(?:auto|default)$|^auto-|-auto$/i.test(entry.id) ||
                      entry.displayName?.toLowerCase() === 'auto'
                    }
                    onChange={(event) =>
                      onChange(
                        'enterpriseAllowedModelsText',
                        (event.target.checked
                          ? [...selected, entry.id]
                          : selected.filter((id) => id !== entry.id)
                        ).join('\n')
                      )
                    }
                  />
                  <span>
                    {entry.displayName || entry.id} · {entry.id}
                  </span>
                </label>
              ))}
            </>
          )}
        </>
      )}
      <p className="hint">
        {t('gemini_enterprise.policy.preview')}:{' '}
        {preview === null
          ? t('gemini_enterprise.policy.catalog_pending')
          : preview.length
            ? preview.join(', ')
            : t('gemini_enterprise.policy.empty')}
      </p>
    </fieldset>
  );
}
