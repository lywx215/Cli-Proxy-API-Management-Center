import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Collapsible } from '@/components/ui/Collapsible';
import {
  GEMINI_SHARED_FIELDS,
  getGeminiEffectiveKey,
  parseGeminiKeyImport,
  rebaseGeminiTargets,
} from '../geminiGroups';
import {
  buildGeminiDialogPatch,
  buildGeminiKeyDialogPatch,
  GEMINI_DIALOG_FIELD_LABELS,
  getGeminiGroupDialogImpacts,
  maskGeminiImportKey,
  readGeminiDialogValues,
  readGeminiModelDrafts,
  type GeminiDialogField,
  type GeminiDialogValues,
  type GeminiModelDraft,
  type GeminiModelMode,
} from './GeminiGroupDialogDraft';
import styles from './GeminiGroupDialogs.module.scss';

interface DialogProps {
  disabled?: boolean;
  error?: string;
  conflict?: boolean;
  onClose: () => void;
  onReload: () => Promise<void>;
}

export interface GeminiKeyImportDialogProps extends DialogProps {
  groups: Record<string, unknown>[];
  initialGroupIndex?: number;
  onSave: (groupIndex: number, keys: string[]) => Promise<void>;
}
export interface GeminiGroupEditorDialogProps extends DialogProps {
  group?: Record<string, unknown>;
  /** All target groups for bulk edits; drafts are initialized from group only. */
  groups?: Record<string, unknown>[];
  allowNameChange?: boolean;
  affectedKeys?: number;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
}
export interface GeminiKeyInheritanceDialogProps extends DialogProps {
  group: Record<string, unknown>;
  keyEntry: Record<string, unknown>;
  onSave: (changes: Record<string, unknown>, inheritFields: string[]) => Promise<void>;
}

function DialogNotice({
  error,
  conflict,
  disabled,
  onReload,
}: Pick<DialogProps, 'error' | 'conflict' | 'disabled' | 'onReload'>) {
  const { t } = useTranslation();
  return (
    <>
      {conflict && (
        <div className={styles.notice} role="alert">
          <p>{t('gemini_groups.conflictDraft')}</p>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={onReload}>
            {t('gemini_groups.reload')}
          </Button>
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          <p>{error === 'save' ? t('gemini_groups.saveFailed') : error}</p>
          {!conflict && (
            <Button variant="secondary" size="sm" disabled={disabled} onClick={onReload}>
              {t('gemini_groups.reload')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export function GeminiKeyImportDialog({
  groups,
  initialGroupIndex = 0,
  disabled,
  error,
  conflict,
  onClose,
  onReload,
  onSave,
}: GeminiKeyImportDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const [target, setTarget] = useState(() => ({ groups, groupIndex: initialGroupIndex }));
  const [text, setText] = useState('');
  const [previewGroups, setPreviewGroups] = useState<Record<string, unknown>[] | null>(null);
  const [localError, setLocalError] = useState<'file' | 'save' | null>(null);
  const [busy, setBusy] = useState(false);
  const groupIndex = useMemo(() => {
    if (target.groups === groups) return groups[target.groupIndex] ? target.groupIndex : null;
    try {
      return rebaseGeminiTargets(target.groups, groups, [{ groupIndex: target.groupIndex }])[0]
        .groupIndex;
    } catch {
      return null;
    }
  }, [groups, target]);
  const result = useMemo(() => {
    if (groupIndex !== null) {
      try {
        return parseGeminiKeyImport(text, groups, groupIndex);
      } catch {
        /* Invalid snapshots are not import targets. */
      }
    }
    return { keys: [], duplicateCount: 0, crossGroupCount: 0, invalidLines: [], tooMany: false };
  }, [text, groups, groupIndex]);
  const targetChanged = groupIndex === null && groups.length > 0;
  const previewed = previewGroups === groups;
  const unavailable = disabled || busy;
  const blocked =
    groupIndex === null ||
    targetChanged ||
    result.tooMany ||
    result.invalidLines.length > 0 ||
    !result.keys.length;
  const reload = async () => {
    setPreviewGroups(null);
    setLocalError(null);
    try {
      await onReload();
    } catch {
      setLocalError('save');
    }
  };
  const save = async () => {
    if (blocked || conflict || unavailable || groupIndex === null) return;
    if (!previewed) {
      setPreviewGroups(groups);
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await onSave(groupIndex, result.keys);
    } catch {
      setLocalError('save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      width={720}
      title={t('gemini_groups.importTitle')}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={unavailable || blocked || conflict} loading={busy} onClick={save}>
            {t(previewed ? 'common.save' : 'gemini_groups.preview')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.hint}>{t('gemini_groups.importHint')}</p>
        {!groups.length && <p role="status">{t('gemini_groups.noGroup')}</p>}
        <label className={styles.field} htmlFor={`${id}-group`}>
          <span>{t('gemini_groups.targetGroup')}</span>
          <Select
            id={`${id}-group`}
            value={groupIndex === null ? '' : String(groupIndex)}
            disabled={unavailable || !groups.length}
            ariaLabel={t('gemini_groups.targetGroup')}
            options={groups.map((group, index) => ({
              value: String(index),
              label: String(group.name ?? `#${index + 1}`),
            }))}
            onChange={(value) => {
              const index = Number(value);
              setTarget({ groups, groupIndex: index });
              setPreviewGroups(null);
            }}
          />
        </label>
        <label className={styles.field} htmlFor={`${id}-keys`}>
          <span>{t('gemini_groups.pasteKeys')}</span>
          <textarea
            id={`${id}-keys`}
            rows={7}
            className={styles.keyInput}
            value={text}
            autoComplete="off"
            spellCheck={false}
            disabled={unavailable}
            onChange={(event) => {
              setText(event.target.value);
              setPreviewGroups(null);
              setLocalError(null);
            }}
          />
        </label>
        <label className={styles.fileButton}>
          <span>{t('gemini_groups.uploadTxt')}</span>
          <input
            type="file"
            accept=".txt,text/plain"
            disabled={unavailable}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (!file.name.toLowerCase().endsWith('.txt') || file.size > 1024 * 1024) {
                setLocalError('file');
                return;
              }
              try {
                setText(await file.text());
                setPreviewGroups(null);
                setLocalError(null);
              } catch {
                setLocalError('file');
              }
            }}
          />
        </label>
        <p className={styles.hint}>{t('gemini_groups.importLimit')}</p>
        <div className={styles.summary} aria-live="polite">
          <span>{t('gemini_groups.ready', { count: result.keys.length })}</span>
          <span>{t('gemini_groups.duplicates', { count: result.duplicateCount })}</span>
          <span>{t('gemini_groups.invalid', { count: result.invalidLines.length })}</span>
          <span>{t('gemini_groups.crossGroup', { count: result.crossGroupCount })}</span>
        </div>
        {result.crossGroupCount > 0 && (
          <p className={styles.notice}>{t('gemini_groups.crossGroupHint')}</p>
        )}
        {result.tooMany && (
          <p className="error-box" role="alert">
            {t('gemini_groups.tooMany')}
          </p>
        )}
        {result.invalidLines.length > 0 && (
          <p className="error-box" role="alert">
            {t('gemini_groups.invalid', { count: result.invalidLines.length })}:{' '}
            {result.invalidLines.slice(0, 20).join(', ')}
          </p>
        )}
        {localError === 'file' && (
          <p className="error-box" role="alert">
            {t('gemini_groups.invalidFile')}
          </p>
        )}
        {targetChanged && (
          <p className="error-box" role="alert">
            {t('gemini_groups.conflictDraft')}
          </p>
        )}
        {previewed && (
          <div className={styles.preview}>
            <strong>{t('gemini_groups.previewTitle')}</strong>
            <ul>
              {result.keys.slice(0, 20).map((key, index) => (
                <li key={index}>
                  <code>{maskGeminiImportKey(key)}</code>
                </li>
              ))}
            </ul>
            {result.keys.length > 20 && (
              <p>{t('gemini_groups.remainingPreview', { count: result.keys.length - 20 })}</p>
            )}
          </div>
        )}
        <DialogNotice
          error={error || (localError === 'save' ? 'save' : undefined)}
          conflict={conflict}
          disabled={unavailable}
          onReload={reload}
        />
      </div>
    </Modal>
  );
}

interface SharedEditorProps {
  field: GeminiDialogField;
  values: GeminiDialogValues;
  onChange: (field: GeminiDialogField, value: string) => void;
  modelMode: GeminiModelMode;
  onModelMode: (mode: GeminiModelMode) => void;
  models: GeminiModelDraft[];
  onModels: (models: GeminiModelDraft[]) => void;
  disabled?: boolean;
  allowDefaultValue?: boolean;
}

function SharedEditor({
  field,
  values,
  onChange,
  modelMode,
  onModelMode,
  models,
  onModels,
  disabled,
  allowDefaultValue = true,
}: SharedEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const label = t(`gemini_groups.field.${GEMINI_DIALOG_FIELD_LABELS[field]}`);
  if (field === 'models')
    return (
      <div className={styles.field}>
        <span>{label}</span>
        <Select
          value={modelMode}
          disabled={disabled}
          ariaLabel={t('gemini_groups.modelsMode')}
          options={(['keep', 'catalog', 'custom'] as const).map((mode) => ({
            value: mode,
            label: t(
              `gemini_groups.models${mode === 'keep' ? 'Keep' : mode === 'catalog' ? 'Catalog' : 'Custom'}`
            ),
          }))}
          onChange={(value) => onModelMode(value as GeminiModelMode)}
        />
        {modelMode === 'custom' && (
          <>
            <div className={styles.modelLabels} aria-hidden="true">
              <span>{t('gemini_groups.modelName')}</span>
              <span>{t('gemini_groups.modelAlias')}</span>
            </div>
            {models.map((model, index) => (
              <div className={styles.model} key={index}>
                <div className={styles.modelRow}>
                  <input
                    className="input"
                    value={model.name}
                    disabled={disabled}
                    aria-label={t('gemini_groups.modelName')}
                    onChange={(event) =>
                      onModels(
                        models.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, name: event.target.value } : row
                        )
                      )
                    }
                  />
                  <input
                    className="input"
                    value={model.alias}
                    disabled={disabled}
                    aria-label={t('gemini_groups.modelAlias')}
                    onChange={(event) =>
                      onModels(
                        models.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, alias: event.target.value } : row
                        )
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label={t('gemini_groups.removeModel')}
                    onClick={() => onModels(models.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    ×
                  </Button>
                </div>
                <Collapsible label={t('gemini_groups.modelAdvanced')}>
                  <textarea
                    className={styles.jsonInput}
                    rows={4}
                    value={model.metadata}
                    disabled={disabled}
                    aria-label={t('gemini_groups.modelAdvanced')}
                    onChange={(event) =>
                      onModels(
                        models.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, metadata: event.target.value } : row
                        )
                      )
                    }
                  />
                </Collapsible>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => onModels([...models, { name: '', alias: '', metadata: '{}' }])}
            >
              {t('gemini_groups.addModel')}
            </Button>
          </>
        )}
      </div>
    );
  if (field === 'disable-cooling')
    return (
      <div className={styles.field}>
        <span>{label}</span>
        <Select
          value={values[field]}
          disabled={disabled}
          ariaLabel={label}
          options={[
            { value: 'default', label: t('gemini_groups.coolingDefault') },
            { value: 'false', label: t('gemini_groups.coolingEnabled') },
            { value: 'true', label: t('gemini_groups.coolingDisabled') },
          ].filter((option) => allowDefaultValue || option.value !== 'default')}
          onChange={(value) => onChange(field, value)}
        />
      </div>
    );
  const multiline = ['headers', 'request-scoped-errors', 'excluded-models'].includes(field);
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          id={id}
          rows={field === 'excluded-models' ? 3 : 5}
          className={styles.jsonInput}
          value={values[field]}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onChange(field, event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="input"
          value={values[field]}
          disabled={disabled}
          type={field === 'priority' || field === 'request-retry' ? 'number' : 'text'}
          required={!allowDefaultValue && (field === 'priority' || field === 'request-retry')}
          placeholder={
            !allowDefaultValue && (field === 'priority' || field === 'request-retry')
              ? '0'
              : undefined
          }
          onChange={(event) => onChange(field, event.target.value)}
        />
      )}
      {multiline && field !== 'excluded-models' && (
        <small className={styles.hint}>{t('gemini_groups.jsonHint')}</small>
      )}
    </label>
  );
}

export function GeminiGroupEditorDialog({
  group,
  groups,
  allowNameChange = true,
  affectedKeys,
  disabled,
  error,
  conflict,
  onClose,
  onReload,
  onSave,
}: GeminiGroupEditorDialogProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState(() => readGeminiDialogValues(group ?? {}));
  const [touched, setTouched] = useState<Set<GeminiDialogField>>(new Set());
  const [models, setModels] = useState(() => readGeminiModelDrafts(group?.models));
  const [modelMode, setModelMode] = useState<GeminiModelMode>('keep');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const unavailable = disabled || busy;
  const impacts = preview
    ? getGeminiGroupDialogImpacts(groups ?? (group ? [group] : []), Object.keys(preview))
    : {};
  const touch = (field: GeminiDialogField) => {
    setTouched((old) => new Set(old).add(field));
    setPreview(null);
    setInvalid(false);
  };
  const reload = async () => {
    setPreview(null);
    setFailed(false);
    try {
      await onReload();
    } catch {
      setFailed(true);
    }
  };
  const save = async () => {
    if (unavailable || conflict) return;
    if (!preview) {
      try {
        const fields = new Set([...touched].filter((field) => allowNameChange || field !== 'name'));
        if (!group && allowNameChange) fields.add('name');
        const changes = buildGeminiDialogPatch(values, fields, modelMode, models);
        if (!Object.keys(changes).length) {
          setInvalid(true);
          return;
        }
        setPreview(changes);
        setInvalid(false);
      } catch {
        setInvalid(true);
      }
      return;
    }
    const changes = { ...preview };
    if (!allowNameChange) delete changes.name;
    if (!Object.keys(changes).length) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      await onSave(changes);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      width={760}
      title={t(group ? 'gemini_groups.editGroupTitle' : 'gemini_groups.createGroupTitle')}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={unavailable || conflict} loading={busy} onClick={save}>
            {t(preview ? 'common.save' : 'gemini_groups.preview')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.hint}>{t('gemini_groups.groupHint')}</p>
        {!allowNameChange && (
          <div className={styles.notice}>
            <p>{t('gemini_groups.groupNameBulkHint')}</p>
            <p>{t('gemini_groups.bulkFirstGroupHint')}</p>
          </div>
        )}
        {(['name', 'base-url', ...GEMINI_SHARED_FIELDS] as GeminiDialogField[])
          .filter((field) => allowNameChange || field !== 'name')
          .map((field) => (
            <SharedEditor
              key={field}
              field={field}
              values={values}
              disabled={unavailable}
              modelMode={modelMode}
              models={models}
              onChange={(target, value) => {
                setValues((old) => ({ ...old, [target]: value }));
                touch(target);
              }}
              onModelMode={(mode) => {
                setModelMode(mode);
                touch('models');
              }}
              onModels={(next) => {
                setModels(next);
                touch('models');
              }}
            />
          ))}
        {invalid && (
          <p className="error-box" role="alert">
            {t('gemini_groups.invalidConfig')}
          </p>
        )}
        {preview && (
          <div className={styles.preview}>
            <strong>{t('gemini_groups.previewTitle')}</strong>
            <p>{t('gemini_groups.changedFields', { count: Object.keys(preview).length })}</p>
            {affectedKeys !== undefined && (
              <p>{t('gemini_groups.affectedKeys', { count: affectedKeys })}</p>
            )}
            <ul>
              {Object.keys(preview).map((field) => (
                <li key={field}>
                  {t(
                    `gemini_groups.field.${GEMINI_DIALOG_FIELD_LABELS[field as GeminiDialogField]}`
                  )}
                  {impacts[field] && (
                    <small className={styles.impact}>
                      {t('gemini_groups.fieldImpact', impacts[field])}
                    </small>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogNotice
          error={error || (failed ? 'save' : undefined)}
          conflict={conflict}
          disabled={unavailable}
          onReload={reload}
        />
      </div>
    </Modal>
  );
}

export function GeminiKeyInheritanceDialog({
  group,
  keyEntry,
  disabled,
  error,
  conflict,
  onClose,
  onReload,
  onSave,
}: GeminiKeyInheritanceDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const [values, setValues] = useState(() =>
    readGeminiDialogValues(getGeminiEffectiveKey(group, keyEntry))
  );
  const [overrides, setOverrides] = useState(
    () =>
      new Set(
        GEMINI_SHARED_FIELDS.filter(
          (field) => keyEntry[field] !== undefined && keyEntry[field] !== null
        )
      )
  );
  const [touched, setTouched] = useState<Set<GeminiDialogField>>(new Set());
  const [models, setModels] = useState(() =>
    readGeminiModelDrafts(getGeminiEffectiveKey(group, keyEntry).models)
  );
  const [modelMode, setModelMode] = useState<GeminiModelMode>(() =>
    keyEntry.models == null
      ? 'keep'
      : Array.isArray(keyEntry.models) && keyEntry.models.length
        ? 'custom'
        : 'catalog'
  );
  const [weight, setWeight] = useState(String(keyEntry.weight ?? ''));
  const [weightTouched, setWeightTouched] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [preview, setPreview] = useState<{
    changes: Record<string, unknown>;
    inheritFields: string[];
  } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const unavailable = disabled || busy;
  const touch = (field: GeminiDialogField) => {
    setTouched((old) => new Set(old).add(field));
    setPreview(null);
    setInvalid(false);
  };
  const reload = async () => {
    setPreview(null);
    setFailed(false);
    try {
      await onReload();
    } catch {
      setFailed(true);
    }
  };
  const save = async () => {
    if (unavailable || conflict) return;
    if (!preview) {
      try {
        const { changes, inheritFields } = buildGeminiKeyDialogPatch({
          values,
          touched,
          overrides,
          modelMode,
          models,
          weight,
          weightTouched,
          apiKey,
        });
        if (!Object.keys(changes).length && !inheritFields.length) {
          setInvalid(true);
          return;
        }
        setPreview({ changes, inheritFields });
        setInvalid(false);
      } catch {
        setInvalid(true);
      }
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      await onSave(preview.changes, preview.inheritFields);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      width={760}
      title={t('gemini_groups.inheritanceTitle')}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={unavailable || conflict} loading={busy} onClick={save}>
            {t(preview ? 'common.save' : 'gemini_groups.preview')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.hint}>{t('gemini_groups.inheritanceHint')}</p>
        <p className={styles.notice}>
          {String(group.name ?? '')} ·{' '}
          <code>{maskGeminiImportKey(String(keyEntry['api-key'] ?? ''))}</code>
        </p>
        <div className={styles.field}>
          <span>{t('gemini_groups.field.baseUrl')}</span>
          <code>{String(group['base-url'] ?? '')}</code>
          <small className={styles.hint}>{t('gemini_groups.baseUrlGroupOnly')}</small>
        </div>
        {GEMINI_SHARED_FIELDS.map((field) => (
          <div className={styles.inheritanceField} key={field}>
            <div className={styles.inheritanceHeader}>
              <strong>{t(`gemini_groups.field.${GEMINI_DIALOG_FIELD_LABELS[field]}`)}</strong>
              <Select
                value={overrides.has(field) ? 'override' : 'inherit'}
                disabled={unavailable}
                ariaLabel={t(`gemini_groups.field.${GEMINI_DIALOG_FIELD_LABELS[field]}`)}
                options={[
                  { value: 'inherit', label: t('gemini_groups.inherit') },
                  { value: 'override', label: t('gemini_groups.override') },
                ]}
                onChange={(mode) => {
                  setOverrides((old) => {
                    const next = new Set(old);
                    if (mode === 'inherit') next.delete(field);
                    else next.add(field);
                    return next;
                  });
                  if (field === 'models' && mode === 'override')
                    setModelMode(models.length ? 'custom' : 'catalog');
                  if (
                    field === 'disable-cooling' &&
                    mode === 'override' &&
                    values[field] === 'default'
                  )
                    setValues((old) => ({ ...old, [field]: 'false' }));
                  touch(field);
                }}
              />
            </div>
            {overrides.has(field) && (
              <SharedEditor
                field={field}
                values={values}
                modelMode={modelMode}
                models={models}
                disabled={unavailable}
                allowDefaultValue={false}
                onChange={(target, value) => {
                  setValues((old) => ({ ...old, [target]: value }));
                  touch(target);
                }}
                onModelMode={(mode) => {
                  setModelMode(mode);
                  touch('models');
                }}
                onModels={(next) => {
                  setModels(next);
                  touch('models');
                }}
              />
            )}
          </div>
        ))}
        <label className={styles.field} htmlFor={`${id}-weight`}>
          <span>{t('gemini_groups.field.weight')}</span>
          <input
            id={`${id}-weight`}
            className="input"
            type="number"
            value={weight}
            disabled={unavailable}
            placeholder="1"
            onChange={(event) => {
              setWeight(event.target.value);
              setWeightTouched(true);
              setPreview(null);
            }}
          />
        </label>
        <label className={styles.field} htmlFor={`${id}-key`}>
          <span>{t('gemini_groups.field.apiKey')}</span>
          <div className={styles.secretRow}>
            <input
              id={`${id}-key`}
              className="input"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              disabled={unavailable}
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              placeholder={t('gemini_groups.keyUnchanged')}
              onChange={(event) => {
                setApiKey(event.target.value);
                setPreview(null);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={unavailable}
              onClick={() => setShowKey((old) => !old)}
            >
              {t(showKey ? 'gemini_groups.hideKey' : 'gemini_groups.showKey')}
            </Button>
          </div>
        </label>
        {invalid && (
          <p className="error-box" role="alert">
            {t('gemini_groups.invalidConfig')}
          </p>
        )}
        {preview && (
          <div className={styles.preview}>
            <strong>{t('gemini_groups.previewTitle')}</strong>
            <p>
              {t('gemini_groups.changedFields', { count: Object.keys(preview.changes).length })}
            </p>
            <p>{t('gemini_groups.inheritedFields', { count: preview.inheritFields.length })}</p>
          </div>
        )}
        <DialogNotice
          error={error || (failed ? 'save' : undefined)}
          conflict={conflict}
          disabled={unavailable}
          onReload={reload}
        />
      </div>
    </Modal>
  );
}
