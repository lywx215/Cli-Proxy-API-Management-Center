import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import type { EnterpriseModelPolicyState } from '@/types/authFile';
import {
  catalogModelIDs,
  ENTERPRISE_MEDIA_CATALOG,
  enterpriseCatalogError,
  enterpriseCatalogPreview,
  enterpriseDefaultCatalog,
  type EnterpriseCatalogDraft,
  type EnterpriseCatalogField,
} from '../enterpriseCatalog';
import type { EnterprisePolicyDraft } from '../enterpriseModelPolicy';

export function EnterpriseCatalogStatus({
  snapshot,
  source,
}: {
  snapshot?: EnterpriseModelPolicyState;
  source?: string;
}) {
  const { t } = useTranslation();
  const state = snapshot?.catalogState;
  const current = source ?? state?.source;
  if (!current) return null;
  return (
    <div className="hint" role="status">
      <div>
        {t('gemini_enterprise.catalog.source')}:{' '}
        {t('gemini_enterprise.catalog.source_' + current, { defaultValue: current })}
      </div>
      {state?.lastSuccessAt && (
        <div>
          {t('gemini_enterprise.catalog.last_success')}:{' '}
          {new Date(state.lastSuccessAt).toLocaleString()}
        </div>
      )}
      {state?.lastError && (
        <div>
          {t('gemini_enterprise.discovery.error_' + state.lastError.code, {
            defaultValue: t('gemini_enterprise.discovery.error_discovery_failed'),
          })}
        </div>
      )}
      {(current === 'default' || current === 'custom') && (
        <div>{t('gemini_enterprise.catalog.unconfirmed')}</div>
      )}
    </div>
  );
}

export function EnterpriseCatalogFields({
  draft,
  policy,
  snapshot,
  excluded,
  disabled,
  onChange,
}: {
  draft: EnterpriseCatalogDraft;
  policy: EnterprisePolicyDraft;
  snapshot?: EnterpriseModelPolicyState;
  excluded: string[];
  disabled: boolean;
  onChange: (field: EnterpriseCatalogField, value: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const error = enterpriseCatalogError(draft);
  const preview = enterpriseCatalogPreview(draft, policy, snapshot, excluded);
  const selected = catalogModelIDs(draft.text);
  return (
    <fieldset className="form-group" disabled={disabled}>
      <legend>{t('gemini_enterprise.catalog.label')}</legend>
      <Select
        value={draft.mode}
        fullWidth
        ariaLabel={t('gemini_enterprise.catalog.label')}
        disabled={disabled}
        options={(['default', 'custom', 'disabled'] as const).map((mode) => ({
          value: mode,
          label: t('gemini_enterprise.catalog.mode_' + mode),
        }))}
        onChange={(value) => onChange('enterpriseCatalogMode', value)}
      />
      <p className="hint">{t('gemini_enterprise.catalog.hint')}</p>
      <p className="hint">
        {t('gemini_enterprise.catalog.defaults')}:{' '}
        {enterpriseDefaultCatalog(snapshot).join(', ') || t('gemini_enterprise.policy.unknown')}
      </p>
      {draft.mode === 'custom' && (
        <>
          <label htmlFor={id}>{t('gemini_enterprise.catalog.models')}</label>
          <textarea
            id={id}
            className="input"
            rows={5}
            value={draft.text}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange('enterpriseCatalogModels', event.target.value)}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {ENTERPRISE_MEDIA_CATALOG.map((model) => (
              <Button
                key={model}
                size="sm"
                variant="secondary"
                disabled={disabled || selected.includes(model)}
                onClick={() => onChange('enterpriseCatalogModels', [...selected, model].join('\n'))}
              >
                {t('gemini_enterprise.catalog.add_model', { model })}
              </Button>
            ))}
          </div>
          <p className="hint">{t('gemini_enterprise.catalog.media_hint')}</p>
        </>
      )}
      {error && (
        <p className="error-box" role="alert">
          {t(error)}
        </p>
      )}
      <p className="hint">
        {t('gemini_enterprise.policy.preview')}:{' '}
        {preview === null
          ? t('gemini_enterprise.policy.catalog_pending')
          : preview.length
            ? preview.join(', ')
            : t('gemini_enterprise.policy.empty')}
      </p>
      <EnterpriseCatalogStatus snapshot={snapshot} />
    </fieldset>
  );
}
