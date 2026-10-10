import { useTranslation } from 'react-i18next';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import { SettingList, TextSetting, ToggleSetting } from '../fields/FieldPrimitives';
import { getValidationMessage } from '../blocks/shared';

const Icon = CONFIG_TAB_ICONS.streaming;

/** 05 流式传输：keepalive 与 bootstrap 重试；nonstream-keepalive-interval 是顶层 YAML 键。 */
export function SectionStreaming({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const { streaming } = values;
  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );
  // 0 / 空即关闭：输入框内右侧标「已禁用」，校验出错时让位给错误信息。
  const disabledBadge = t('config_management.visual.sections.streaming.disabled');
  const isKeepaliveOff = !keepaliveError && Number(streaming.keepaliveSeconds) <= 0;
  const isNonstreamKeepaliveOff =
    !nonstreamKeepaliveError && Number(streaming.nonstreamKeepaliveInterval) <= 0;

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.streaming}
      icon={<Icon size={16} />}
      title={t('config_management.visual.sections.streaming.title')}
      description={t('config_management.visual.sections.streaming.description')}
      animateIn={animateIn}
    >
      <SettingList>
        <TextSetting
          fieldId="streamingKeepaliveSeconds"
          size="sm"
          label={t('config_management.visual.sections.streaming.keepalive_seconds')}
          description={t('config_management.visual.sections.streaming.keepalive_hint')}
          type="number"
          placeholder="0"
          value={streaming.keepaliveSeconds}
          onChange={(keepaliveSeconds) =>
            onChange({ streaming: { ...streaming, keepaliveSeconds } })
          }
          disabled={disabled}
          error={keepaliveError}
          adornment={isKeepaliveOff ? disabledBadge : undefined}
        />
        <TextSetting
          fieldId="streamingBootstrapRetries"
          size="sm"
          label={t('config_management.visual.sections.streaming.bootstrap_retries')}
          description={t('config_management.visual.sections.streaming.bootstrap_hint')}
          type="number"
          placeholder="1"
          value={streaming.bootstrapRetries}
          onChange={(bootstrapRetries) =>
            onChange({ streaming: { ...streaming, bootstrapRetries } })
          }
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.['streaming.bootstrapRetries'])}
        />
      </SettingList>

      <SettingList>
        <TextSetting
          fieldId="streamingNonstreamKeepalive"
          size="sm"
          label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
          description={t('config_management.visual.sections.streaming.nonstream_keepalive_hint')}
          type="number"
          placeholder="0"
          value={streaming.nonstreamKeepaliveInterval}
          onChange={(nonstreamKeepaliveInterval) =>
            onChange({ streaming: { ...streaming, nonstreamKeepaliveInterval } })
          }
          disabled={disabled}
          error={nonstreamKeepaliveError}
          adornment={isNonstreamKeepaliveOff ? disabledBadge : undefined}
        />
      </SettingList>
      <SettingList
        title={t('config_management.visual.sections.speed_throttle.title')}
        description={t('config_management.visual.sections.speed_throttle.description')}
      >
        <ToggleSetting
          fieldId="speedThrottle"
          label={t('config_management.visual.sections.speed_throttle.enable_title')}
          description={t('config_management.visual.sections.speed_throttle.enable_desc')}
          checked={values.speedThrottle.enabled}
          disabled={disabled}
          onChange={(enabled) => onChange({ speedThrottle: { ...values.speedThrottle, enabled } })}
        />
        <TextSetting
          fieldId="speedThrottleMaxConcurrent"
          type="number"
          size="sm"
          label={t('config_management.visual.sections.speed_throttle.max_concurrent')}
          value={values.speedThrottle.maxConcurrent}
          disabled={disabled || !values.speedThrottle.enabled}
          onChange={(maxConcurrent) =>
            onChange({ speedThrottle: { ...values.speedThrottle, maxConcurrent } })
          }
        />
        <TextSetting
          fieldId="speedThrottleQueueSize"
          type="number"
          size="sm"
          label={t('config_management.visual.sections.speed_throttle.queue_size')}
          value={values.speedThrottle.queueSize}
          disabled={disabled || !values.speedThrottle.enabled}
          onChange={(queueSize) =>
            onChange({ speedThrottle: { ...values.speedThrottle, queueSize } })
          }
        />
        <TextSetting
          fieldId="speedThrottleMinTokensPerSecond"
          type="number"
          size="sm"
          label={t('config_management.visual.sections.speed_throttle.min_tokens')}
          value={values.speedThrottle.minTokensPerSecond}
          disabled={disabled || !values.speedThrottle.enabled}
          onChange={(minTokensPerSecond) =>
            onChange({ speedThrottle: { ...values.speedThrottle, minTokensPerSecond } })
          }
        />
        <TextSetting
          fieldId="speedThrottleMaxTokensPerSecond"
          type="number"
          size="sm"
          label={t('config_management.visual.sections.speed_throttle.max_tokens')}
          value={values.speedThrottle.maxTokensPerSecond}
          disabled={disabled || !values.speedThrottle.enabled}
          onChange={(maxTokensPerSecond) =>
            onChange({ speedThrottle: { ...values.speedThrottle, maxTokensPerSecond } })
          }
        />
        <TextSetting
          fieldId="speedThrottleMinFirstTokenDelayMs"
          type="number"
          size="sm"
          label={t('config_management.visual.sections.speed_throttle.min_ttft')}
          value={values.speedThrottle.minFirstTokenDelayMs}
          disabled={disabled || !values.speedThrottle.enabled}
          onChange={(minFirstTokenDelayMs) =>
            onChange({ speedThrottle: { ...values.speedThrottle, minFirstTokenDelayMs } })
          }
        />
        <TextSetting
          fieldId="speedThrottleMaxFirstTokenDelayMs"
          type="number"
          size="sm"
          label={t('config_management.visual.sections.speed_throttle.max_ttft')}
          value={values.speedThrottle.maxFirstTokenDelayMs}
          disabled={disabled || !values.speedThrottle.enabled}
          onChange={(maxFirstTokenDelayMs) =>
            onChange({ speedThrottle: { ...values.speedThrottle, maxFirstTokenDelayMs } })
          }
        />
      </SettingList>
    </SectionCard>
  );
}
