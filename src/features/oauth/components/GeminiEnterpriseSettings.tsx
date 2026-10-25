import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { enterpriseRegionOptions } from '@/features/authFiles/enterpriseResources';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { GEMINI_ENTERPRISE_CALLBACK_URL } from '@/services/api/geminiEnterprise';
import type { useGeminiEnterpriseConfig } from '../hooks/useGeminiEnterpriseConfig';
import styles from './GeminiEnterpriseSettings.module.scss';

export function GeminiEnterpriseSettings({
  config,
  locked,
}: {
  config: ReturnType<typeof useGeminiEnterpriseConfig>;
  locked: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.settings} aria-label={t('gemini_enterprise.settings_title')}>
      <p className={styles.hint}>{t('gemini_enterprise.settings_hint')}</p>
      <p className={styles.callback}>
        {t('gemini_enterprise.redirect_label')} <code>{GEMINI_ENTERPRISE_CALLBACK_URL}</code>
      </p>
      {config.loading ? (
        <p role="status">{t('gemini_enterprise.loading')}</p>
      ) : (
        <>
          <fieldset disabled={locked || !config.configured} className={styles.fields}>
            <legend className={styles.legend}>{t('gemini_enterprise.settings_title')}</legend>
            {(['engineId', 'assistantId'] as const).map((field) => (
              <Input
                key={field}
                label={t(`gemini_enterprise.fields.${field}`)}
                value={config.value[field]}
                required={field === 'engineId'}
                autoComplete="off"
                spellCheck={false}
                hint={t(
                  `gemini_enterprise.${field === 'engineId' ? 'engine_hint' : 'assistant_hint'}`
                )}
                placeholder={field === 'assistantId' ? 'default_assistant' : 'gemini-enterprise-…'}
                error={
                  config.errors[field]
                    ? t(`gemini_enterprise.validation.${config.errors[field]}`)
                    : undefined
                }
                onChange={(event) => config.setField(field, event.target.value)}
              />
            ))}
          </fieldset>
          <p className={styles.hint}>{t('gemini_enterprise.auto_resources_hint')}</p>
          <ToggleSwitch
            checked={config.manualResources}
            onChange={config.setManualResources}
            disabled={locked || !config.configured}
            label={t('gemini_enterprise.manual_resources')}
          />
          {config.manualResources && (
            <fieldset disabled={locked || !config.configured} className={styles.fields}>
              <legend className={styles.legend}>{t('gemini_enterprise.manual_resources')}</legend>
              <label>{t('gemini_enterprise.fields.location')}</label>
              <Select
                value={config.value.location}
                options={enterpriseRegionOptions(config.value.location)}
                disabled={locked || !config.configured}
                ariaLabel={t('gemini_enterprise.fields.location')}
                onChange={(location) => config.setField('location', location)}
              />
              {(['projectId', 'collectionId'] as const).map((field) => (
                <Input
                  key={field}
                  label={t(`gemini_enterprise.fields.${field}`)}
                  value={config.value[field]}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  error={
                    config.errors[field]
                      ? t(`gemini_enterprise.validation.${config.errors[field]}`)
                      : undefined
                  }
                  onChange={(event) => config.setField(field, event.target.value)}
                />
              ))}
            </fieldset>
          )}
          <div className={styles.actions}>
            <Button variant="secondary" disabled={locked || config.loading} onClick={config.retry}>
              {t('gemini_enterprise.reload')}
            </Button>
          </div>
          {config.configured && !Object.keys(config.errors).length && (
            <p role="status" className={styles.hint}>
              {t('gemini_enterprise.ready')}
            </p>
          )}
        </>
      )}
      {config.error && (
        <p role="alert" className={styles.error}>
          {config.error}
        </p>
      )}
    </section>
  );
}
