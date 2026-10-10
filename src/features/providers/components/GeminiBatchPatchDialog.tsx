import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { isRecord } from '@/utils/helpers';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import styles from './GeminiResourcePanel.module.scss';

const FIELDS = ['base-url', 'proxy-url', 'headers', 'priority', 'weight'] as const;
type PatchField = (typeof FIELDS)[number];

interface GeminiBatchPatchDialogProps {
  onClose: () => void;
  onPreview: (scope: 'keys' | 'groups', changes: Record<string, unknown>) => void;
}

export function GeminiBatchPatchDialog({ onClose, onPreview }: GeminiBatchPatchDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const [scope, setScope] = useState<'keys' | 'groups'>('keys');
  const [fields, setFields] = useState<Set<PatchField>>(new Set());
  const [values, setValues] = useState<Record<PatchField, string>>({
    'base-url': '',
    'proxy-url': '',
    headers: '{}',
    priority: '0',
    weight: '1',
  });
  const [error, setError] = useState(false);

  const preview = () => {
    const changes: Record<string, unknown> = {};
    try {
      for (const field of fields) {
        if (
          (field === 'base-url' && scope !== 'groups') ||
          (field === 'weight' && scope !== 'keys')
        )
          continue;
        const value = values[field].trim();
        if (field === 'headers') {
          const headers: unknown = JSON.parse(value);
          if (
            !isRecord(headers) ||
            !Object.values(headers).every((entry) => typeof entry === 'string')
          )
            throw new Error();
          changes[field] = headers;
        } else if (field === 'priority' || field === 'weight') {
          const number = Number(value);
          if (
            !value ||
            !Number.isSafeInteger(number) ||
            (field === 'weight' && number > MAX_CREDENTIAL_WEIGHT)
          )
            throw new Error();
          changes[field] = number;
        } else {
          if (field === 'base-url' && value && !/^https?:\/\//i.test(value)) throw new Error();
          changes[field] = value;
        }
      }
      if (Object.keys(changes).length === 0) throw new Error();
      setError(false);
      onPreview(scope, changes);
    } catch {
      setError(true);
    }
  };

  return (
    <Modal
      open
      title={t('gemini_management.patch')}
      onClose={onClose}
      footer={<Button onClick={preview}>{t('gemini_management.preview')}</Button>}
    >
      <div className={styles.patchForm}>
        <label className={styles.field} htmlFor={`${id}-scope`}>
          {t('gemini_management.scope')}
          <Select
            id={`${id}-scope`}
            value={scope}
            ariaLabel={t('gemini_management.scope')}
            onChange={(value) => setScope(value as 'keys' | 'groups')}
            options={[
              { value: 'keys', label: t('gemini_management.keyScope') },
              { value: 'groups', label: t('gemini_management.groupScope') },
            ]}
          />
        </label>
        <p className={styles.message}>
          {t(scope === 'groups' ? 'gemini_management.groupWarning' : 'gemini_management.patchHint')}
        </p>
        {FIELDS.filter((field) => field !== (scope === 'keys' ? 'base-url' : 'weight')).map(
          (field) => (
            <div className={styles.patchField} key={field}>
              <SelectionCheckbox
                checked={fields.has(field)}
                label={t(`gemini_management.fields.${field}`)}
                onChange={(checked) =>
                  setFields((old) => {
                    const next = new Set(old);
                    if (checked) next.add(field);
                    else next.delete(field);
                    return next;
                  })
                }
              />
              {field === 'headers' ? (
                <textarea
                  className="input"
                  rows={3}
                  value={values[field]}
                  disabled={!fields.has(field)}
                  aria-label={t(`gemini_management.fields.${field}`)}
                  onChange={(event) =>
                    setValues((old) => ({ ...old, [field]: event.target.value }))
                  }
                />
              ) : (
                <input
                  className="input"
                  value={values[field]}
                  disabled={!fields.has(field)}
                  type={field === 'priority' || field === 'weight' ? 'number' : 'text'}
                  aria-label={t(`gemini_management.fields.${field}`)}
                  onChange={(event) =>
                    setValues((old) => ({ ...old, [field]: event.target.value }))
                  }
                />
              )}
            </div>
          )
        )}
        {error && (
          <p role="alert" className="error-box">
            {t('gemini_management.invalidPatch')}
          </p>
        )}
      </div>
    </Modal>
  );
}
