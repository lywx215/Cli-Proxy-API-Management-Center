import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ApiKeyRateLimitConfig, ApiKeyRateLimitOverride } from '@/types/visualConfig';
import { makeClientId } from '@/types/visualConfig';
import styles from './Blocks.module.scss';

export const ApiKeyRateLimitEditor = memo(function ApiKeyRateLimitEditor({
  value,
  disabled,
  onChange,
  errorId,
}: {
  value: ApiKeyRateLimitConfig;
  disabled?: boolean;
  onChange: (next: ApiKeyRateLimitConfig) => void;
  errorId?: string;
}) {
  const { t } = useTranslation();
  const overrideItems = value.overrides || [];

  const addOverride = () => {
    onChange({
      ...value,
      overrides: [...overrideItems, { id: makeClientId(), apiKey: '', rpm: '' }],
    });
  };

  const removeOverride = (index: number) => {
    onChange({
      ...value,
      overrides: overrideItems.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  const updateOverride = (index: number, patch: Partial<ApiKeyRateLimitOverride>) => {
    onChange({
      ...value,
      overrides: overrideItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      ),
    });
  };

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <div className={styles.stringListRow} style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
            disabled={disabled}
          />
          {t('config_management.visual.api_keys.rate_limit_enabled')}
        </label>
      </div>

      <div className={styles.stringListRow} style={{ marginBottom: 16 }}>
        <input
          className="input"
          placeholder={t('config_management.visual.api_keys.rate_limit_default_rpm_placeholder')}
          value={value.defaultRpm}
          type="number"
          onChange={(event) => onChange({ ...value, defaultRpm: event.target.value })}
          disabled={disabled || !value.enabled}
          aria-describedby={errorId}
        />
      </div>

      <div className={styles.blockHeaderRow} style={{ marginBottom: 8 }}>
        <label style={{ margin: 0 }}>
          {t('config_management.visual.api_keys.rate_limit_overrides')}
        </label>
        <Button size="sm" onClick={addOverride} disabled={disabled || !value.enabled}>
          {t('config_management.visual.common.add')}
        </Button>
      </div>

      {overrideItems.length === 0 ? (
        <div className={styles.emptyState}>
          {t('config_management.visual.api_keys.rate_limit_overrides_empty')}
        </div>
      ) : (
        <div className="item-list">
          {overrideItems.map((item, index) => (
            <div
              key={item.id}
              className={styles.stringListRow}
              style={{ marginBottom: 8, alignItems: 'center' }}
            >
              <input
                className="input"
                style={{ flex: 2 }}
                placeholder={t('config_management.visual.api_keys.input_placeholder')}
                value={item.apiKey}
                onChange={(event) => updateOverride(index, { apiKey: event.target.value })}
                disabled={disabled || !value.enabled}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                type="number"
                placeholder={t('config_management.visual.api_keys.rate_limit_rpm')}
                value={item.rpm}
                onChange={(event) => updateOverride(index, { rpm: event.target.value })}
                disabled={disabled || !value.enabled}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeOverride(index)}
                disabled={disabled || !value.enabled}
              >
                {t('config_management.visual.common.delete')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
