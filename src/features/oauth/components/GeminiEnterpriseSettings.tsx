import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  GEMINI_ENTERPRISE_CALLBACK_URL,
  GEMINI_ENTERPRISE_FIELDS,
} from '@/services/api/geminiEnterprise';
import type { useGeminiEnterpriseConfig } from '../hooks/useGeminiEnterpriseConfig';
import { isGeminiEnterpriseApplicationField } from '../geminiEnterprise';
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
          <fieldset
            disabled={locked || config.saving || !config.configured}
            className={styles.fields}
          >
            <legend className={styles.legend}>{t('gemini_enterprise.settings_title')}</legend>
            {GEMINI_ENTERPRISE_FIELDS.filter(
              (field) => !isGeminiEnterpriseApplicationField(field)
            ).map((field) => (
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
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={locked || config.startDisabled || !config.dirty}
              loading={config.saving}
              onClick={() => void config.save()}
            >
              {t('gemini_enterprise.save')}
            </Button>
            <Button variant="secondary" disabled={locked || config.saving} onClick={config.retry}>
              {t('gemini_enterprise.reload')}
            </Button>
          </div>
          {config.configured && !config.dirty && !Object.keys(config.errors).length && (
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
