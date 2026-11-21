import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { IconChevronDown, IconChevronUp } from '@/components/ui/icons';
import type { EnterpriseRoutingPatch } from '@/services/api/geminiEnterprise';
import type { EnterpriseCredentialRouting } from '@/types/authFile';
import {
  DEFAULT_CREDENTIAL_WEIGHT,
  MAX_CREDENTIAL_WEIGHT,
  readCredentialWeight,
} from '@/utils/credentialWeight';
import { parsePriorityValue } from '../constants';
import styles from './GeminiEnterpriseRouting.module.scss';

const maxPriority = 1_000_000;

export type EnterpriseWeightMode =
  'quota_balancing' | 'weighted_round_robin' | 'round_robin' | 'fill_first';

type RoutingDraft = { revision: number; priority: string; weight: string };

export function GeminiEnterpriseRouting({
  values,
  revision,
  scope,
  weightMode,
  disabled,
  saving,
  onSave,
}: {
  values: EnterpriseCredentialRouting;
  revision?: number;
  scope: 'account' | 'collection';
  weightMode: EnterpriseWeightMode;
  disabled: boolean;
  saving: boolean;
  onSave: (fields: EnterpriseRoutingPatch) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<RoutingDraft | null>(null);
  const formId = useId();
  const collection = scope === 'collection';
  const notEditable = disabled || saving || !revision;
  const storedPriority = values.priorityInherited ? null : values.priority;
  const storedWeight = values.weightInherited ? null : values.weight;
  const priority = draft?.priority.trim()
    ? parsePriorityValue(draft.priority)
    : collection
      ? null
      : 0;
  const weight = draft?.weight.trim()
    ? readCredentialWeight(draft.weight)
    : collection
      ? null
      : DEFAULT_CREDENTIAL_WEIGHT;
  const priorityValid =
    priority === null || (priority !== undefined && Math.abs(priority) <= maxPriority);
  const weightValid = weight === null || (weight !== undefined && weight >= 0);
  const stale = draft !== null && draft.revision !== revision;
  const weightHint = t('gemini_enterprise.routing.weight_' + weightMode);
  const fields: EnterpriseRoutingPatch = {
    ...(priority !== storedPriority ? { priority } : {}),
    ...(weight !== storedWeight ? { weight } : {}),
  };
  const reset: EnterpriseRoutingPatch = collection
    ? { priority: null, weight: null }
    : { priority: 0, weight: DEFAULT_CREDENTIAL_WEIGHT };
  const canReset = storedPriority !== reset.priority || storedWeight !== reset.weight;
  const canSave = priorityValid && weightValid && Object.keys(fields).length > 0;
  const change = (key: 'priority' | 'weight', value: string) =>
    setDraft((previous) => previous && { ...previous, [key]: value });
  const close = () => setDraft(null);
  const saveDraft = async (patch: EnterpriseRoutingPatch) => {
    if (!notEditable && !stale && (await onSave(patch))) close();
  };
  const stepWeight = weight ?? values.weight;
  const format = (value: number) => value.toLocaleString(i18n.resolvedLanguage);
  const source =
    values.priorityInherited && values.weightInherited
      ? 'inherited'
      : values.priorityInherited || values.weightInherited
        ? 'partly_inherited'
        : 'overridden';
  const name = t('gemini_enterprise.routing.' + scope);
  return (
    <div className={styles.routing} role="group" aria-label={name} data-enterprise-routing={scope}>
      <div className={styles.priority}>
        <span className={styles.metric} aria-live="polite" title={t('auth_files.priority_hint')}>
          {t('auth_files.priority_display')} <strong>{format(values.priority)}</strong>
        </span>
        {([1, -1] as const).map((step) => {
          const label = t(
            'gemini_enterprise.routing.' + (step > 0 ? 'raise_priority' : 'lower_priority')
          );
          const next = values.priority + step;
          const Icon = step > 0 ? IconChevronUp : IconChevronDown;
          return (
            <Button
              className={styles.step}
              key={step}
              type="button"
              size="sm"
              variant="ghost"
              disabled={notEditable || Math.abs(next) > maxPriority}
              aria-label={label}
              title={label}
              onClick={() => void onSave({ priority: next })}
            >
              <Icon size={13} aria-hidden />
            </Button>
          );
        })}
      </div>
      <span className={styles.metric} aria-live="polite" title={weightHint}>
        {t('auth_files.weight_display')} <strong>{format(values.weight)}</strong>
      </span>
      <Button
        className={styles.adjust}
        type="button"
        size="sm"
        variant="secondary"
        aria-haspopup="dialog"
        disabled={notEditable}
        onClick={() => {
          if (!revision) return;
          setDraft({
            revision,
            priority: storedPriority === null ? '' : String(storedPriority),
            weight: storedWeight === null ? '' : String(storedWeight),
          });
        }}
      >
        {t('gemini_enterprise.routing.adjust')}
      </Button>
      {collection && (
        <span className={styles.source}>{t('gemini_enterprise.routing.' + source)}</span>
      )}
      <Modal
        open={draft !== null}
        onClose={close}
        closeDisabled={saving}
        title={name}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={notEditable || stale || !canReset}
              onClick={() => void saveDraft(reset)}
            >
              {t('gemini_enterprise.routing.' + (collection ? 'follow_account' : 'reset_defaults'))}
            </Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={saving}
              disabled={notEditable || stale || !canSave}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void saveDraft(fields);
          }}
        >
          <Input
            label={t('auth_files.priority_label')}
            value={draft?.priority ?? ''}
            inputMode="numeric"
            placeholder={collection ? t('gemini_enterprise.routing.inherited') : '0'}
            hint={t('auth_files.priority_hint')}
            error={priorityValid ? undefined : t('gemini_enterprise.routing.priority_bounds')}
            disabled={notEditable || stale}
            onChange={(event) => change('priority', event.target.value)}
          />
          <Input
            label={t('auth_files.weight_label')}
            className={styles.weightInput}
            value={draft?.weight ?? ''}
            inputMode="numeric"
            placeholder={
              collection
                ? t('gemini_enterprise.routing.inherited')
                : String(DEFAULT_CREDENTIAL_WEIGHT)
            }
            hint={weightHint}
            error={weightValid ? undefined : t('gemini_enterprise.routing.weight_bounds')}
            disabled={notEditable || stale}
            onChange={(event) => change('weight', event.target.value)}
            rightElement={
              <div className={styles.weightStepper}>
                {([-1, 1] as const).map((step) => {
                  const label = t(
                    'gemini_enterprise.routing.' + (step > 0 ? 'raise_weight' : 'lower_weight')
                  );
                  const next = stepWeight + step;
                  return (
                    <Button
                      key={step}
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={label}
                      title={label}
                      disabled={notEditable || stale || next < 0 || next > MAX_CREDENTIAL_WEIGHT}
                      onClick={() => change('weight', String(next))}
                    >
                      {step > 0 ? '+' : '−'}
                    </Button>
                  );
                })}
              </div>
            }
          />
          {collection && (
            <p className="hint">{t('gemini_enterprise.routing.inherit_input_hint')}</p>
          )}
          {stale && <p role="alert">{t('gemini_enterprise.region_conflict')}</p>}
        </form>
      </Modal>
    </div>
  );
}
