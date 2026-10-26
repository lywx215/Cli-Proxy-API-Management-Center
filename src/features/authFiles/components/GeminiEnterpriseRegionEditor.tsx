import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { apiClient } from '@/services/api/client';
import { geminiEnterpriseApi } from '@/services/api/geminiEnterprise';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { AuthFileItem } from '@/types';
import {
  enterpriseResources,
  enterpriseRegionEndpoint,
  enterpriseRegionOptions,
  sameEnterpriseResources,
  validEnterpriseResources,
} from '../enterpriseResources';
import styles from './GeminiEnterpriseBinding.module.scss';

export function GeminiEnterpriseRegionEditor({
  file,
  disabled,
  onSaved,
}: {
  file: AuthFileItem;
  disabled: boolean;
  onSaved?: (file: AuthFileItem) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const regionId = useId();
  const expected = enterpriseResources(file.geminiEnterprise);
  const [value, setValue] = useState(expected);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const locked = disabled || busy;

  const save = async () => {
    if (locked || !validEnterpriseResources(value) || sameEnterpriseResources(value, expected))
      return;
    const controller = new AbortController();
    request.current = controller;
    const revision = apiClient.getConnectionRevision();
    const current = () =>
      !controller.signal.aborted && revision === apiClient.getConnectionRevision();
    setBusy(true);
    setError('');
    try {
      await geminiEnterpriseApi.updateResources(file, value, expected, controller.signal);
      if (!current()) return;
      useNotificationStore
        .getState()
        .showNotification(t('gemini_enterprise.region_saved'), 'success');
      setEditing(false);
      await onSaved?.(file);
    } catch (cause) {
      if (!current()) return;
      const code = cause && typeof cause === 'object' && 'apiCode' in cause ? cause.apiCode : '';
      const key =
        code === 'credential_changed'
          ? 'region_conflict'
          : code === 'credential_unavailable'
            ? 'region_authorization_error'
            : code === 'runtime_sync_failed'
              ? 'region_sync_error'
              : 'region_error';
      setError(t(`gemini_enterprise.${key}`));
    } finally {
      if (current()) setBusy(false);
    }
  };

  return (
    <div className={styles.regionEditor}>
      <div className={styles.regionRow}>
        <label htmlFor={regionId}>{t('gemini_enterprise.region_endpoint')}</label>
        <Select
          id={regionId}
          value={value.location}
          options={enterpriseRegionOptions(expected.location)}
          ariaLabel={t('gemini_enterprise.region_endpoint')}
          size="sm"
          disabled={locked || Boolean(file.geminiEnterprise?.bindingId)}
          onChange={(location) => {
            setValue((previous) => ({ ...previous, location }));
            setEditing(true);
            setError('');
          }}
        />
        {!editing && (
          <Button size="sm" variant="ghost" disabled={locked} onClick={() => setEditing(true)}>
            {t('gemini_enterprise.edit_resources')}
          </Button>
        )}
      </div>
      <p className={styles.endpoint}>{enterpriseRegionEndpoint(value.location)}</p>
      {editing && (
        <div className={styles.resourceForm}>
          <p className={styles.hint}>
            {t(
              file.geminiEnterprise?.bindingId
                ? 'gemini_enterprise.collection_binding_hint'
                : 'gemini_enterprise.region_hint'
            )}
          </p>
          {(['projectId', 'engineId'] as const).map((field) => (
            <Input
              key={field}
              label={t(`gemini_enterprise.fields.${field}`)}
              value={value[field]}
              disabled={
                locked || (Boolean(file.geminiEnterprise?.bindingId) && field === 'projectId')
              }
              required
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                setValue((previous) => ({ ...previous, [field]: event.target.value }))
              }
            />
          ))}
          <details>
            <summary>{t('gemini_enterprise.resource_advanced')}</summary>
            {(['collectionId', 'assistantId'] as const).map((field) => (
              <Input
                key={field}
                label={t(`gemini_enterprise.fields.${field}`)}
                value={value[field]}
                disabled={
                  locked || (Boolean(file.geminiEnterprise?.bindingId) && field === 'collectionId')
                }
                required
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  setValue((previous) => ({ ...previous, [field]: event.target.value }))
                }
              />
            ))}
          </details>
          <div className={styles.regionActions}>
            <Button
              size="sm"
              loading={busy}
              disabled={
                locked ||
                !validEnterpriseResources(value) ||
                sameEnterpriseResources(value, expected)
              }
              onClick={() => void save()}
            >
              {t('gemini_enterprise.validate_save')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setValue(expected);
                setEditing(false);
                setError('');
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
      {busy && <p role="status">{t('gemini_enterprise.region_validating')}</p>}
      {error && (
        <p role="alert" className={styles.regionError}>
          {error}
        </p>
      )}
    </div>
  );
}
