import { useEnterpriseWebRuntime } from '@/features/authFiles/enterpriseWeb/useEnterpriseWebRuntime';
import { EnterpriseWebStatus } from '@/features/authFiles/enterpriseWeb/EnterpriseWebStatus';
import { useTranslation } from 'react-i18next';
import type { VisualConfigValues } from '@/types/visualConfig';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import { SelectSetting, SettingList, TextSetting, ToggleSetting } from '../fields/FieldPrimitives';
import { ProxyUrlField } from '../fields/sharedFields';
import { getValidationMessage } from '../blocks/shared';

const Icon = CONFIG_TAB_ICONS.network;

type RoutingStrategy = VisualConfigValues['routingStrategy'];
type DisableImageGeneration = VisualConfigValues['disableImageGeneration'];

/** Network, routing, retries and media input settings. */
export function SectionNetwork({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const web = useEnterpriseWebRuntime();

  const routingStrategyOptions: Array<{ value: RoutingStrategy; label: string }> = [
    {
      value: 'round-robin',
      label: t('config_management.visual.sections.network.strategy_round_robin'),
    },
    {
      value: 'weighted-round-robin',
      label: t('config_management.visual.sections.network.strategy_weighted_round_robin'),
    },
    {
      value: 'fill-first',
      label: t('config_management.visual.sections.network.strategy_fill_first'),
    },
  ];

  const disableImageGenerationOptions: Array<{ value: DisableImageGeneration; label: string }> = [
    {
      value: 'false',
      label: t('config_management.visual.sections.network.disable_image_generation_false'),
    },
    {
      value: 'true',
      label: t('config_management.visual.sections.network.disable_image_generation_true'),
    },
    {
      value: 'chat',
      label: t('config_management.visual.sections.network.disable_image_generation_chat'),
    },
    {
      value: 'passthrough',
      label: t('config_management.visual.sections.network.disable_image_generation_passthrough'),
    },
  ];

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.network}
      icon={<Icon size={16} />}
      title={t('config_management.visual.sections.network.title')}
      description={t('config_management.visual.sections.network.description')}
      animateIn={animateIn}
    >
      <h3>{t('enterprise_web.title')}</h3>
      <EnterpriseWebStatus status={web.status} unsupported={web.unsupported} error={web.error} />
      <SettingList>
        <ToggleSetting
          fieldId="geminiEnterpriseWebEnabled"
          label={t('enterprise_web.enabled')}
          description={t(
            !web.error && web.status?.mediaFallbackRequests
              ? 'enterprise_web.scope_with_media_fallback'
              : 'enterprise_web.scope'
          )}
          checked={values.geminiEnterpriseWebEnabled}
          disabled={disabled || web.unsupported || !web.status}
          onChange={(geminiEnterpriseWebEnabled) => onChange({ geminiEnterpriseWebEnabled })}
        />
        <ToggleSetting
          fieldId="geminiEnterpriseWebCookieCCPollingEnabled"
          label={t('enterprise_web.cc_polling')}
          description={t(
            web.status?.cookieCCPollingEnabled === undefined && web.status
              ? 'enterprise_web.cc_polling_unsupported'
              : 'enterprise_web.cc_polling_hint'
          )}
          checked={values.geminiEnterpriseWebCookieCCPollingEnabled}
          disabled={disabled || web.error || web.status?.cookieCCPollingEnabled === undefined}
          onChange={(geminiEnterpriseWebCookieCCPollingEnabled) =>
            onChange({ geminiEnterpriseWebCookieCCPollingEnabled })
          }
        />
        <TextSetting
          fieldId="geminiEnterpriseWebMaxConcurrent"
          label={t('enterprise_web.concurrency')}
          description={t('enterprise_web.limits_hint')}
          type="number"
          placeholder="2"
          value={values.geminiEnterpriseWebMaxConcurrent}
          disabled={disabled || web.unsupported || !web.status}
          error={
            validationErrors?.geminiEnterpriseWebMaxConcurrent
              ? t('enterprise_web.limits_hint')
              : undefined
          }
          onChange={(geminiEnterpriseWebMaxConcurrent) =>
            onChange({ geminiEnterpriseWebMaxConcurrent })
          }
        />
        <SelectSetting
          fieldId="geminiEnterpriseWebHistoryMode"
          label={t('enterprise_web.history_mode')}
          description={
            web.status?.historyMode &&
            web.status.supportedHistoryModes?.includes('serialized-context')
              ? t('enterprise_web.history_hint')
              : t('enterprise_web.history_unsupported')
          }
          value={values.geminiEnterpriseWebHistoryMode}
          options={[
            { value: 'single-turn', label: t('enterprise_web.history_single') },
            { value: 'serialized-context', label: t('enterprise_web.history_serialized') },
          ]}
          disabled={
            disabled ||
            web.error ||
            !web.status?.historyMode ||
            !web.status.supportedHistoryModes?.includes('serialized-context')
          }
          error={
            validationErrors?.geminiEnterpriseWebHistoryMode
              ? t('enterprise_web.history_invalid')
              : undefined
          }
          onChange={(geminiEnterpriseWebHistoryMode) =>
            onChange({ geminiEnterpriseWebHistoryMode })
          }
        />
        <TextSetting
          fieldId="geminiEnterpriseWebMaxInflightBytes"
          label={t('enterprise_web.memory_bytes')}
          description={t('enterprise_web.limits_hint')}
          type="number"
          placeholder="268435456"
          value={values.geminiEnterpriseWebMaxInflightBytes}
          disabled={disabled || web.unsupported || !web.status}
          error={
            validationErrors?.geminiEnterpriseWebMaxInflightBytes
              ? t('enterprise_web.limits_hint')
              : undefined
          }
          onChange={(geminiEnterpriseWebMaxInflightBytes) =>
            onChange({ geminiEnterpriseWebMaxInflightBytes })
          }
        />
      </SettingList>
      <SettingList>
        <ProxyUrlField values={values} disabled={disabled} onChange={onChange} wide />
        <TextSetting
          fieldId="requestRetry"
          size="sm"
          label={t('config_management.visual.sections.network.request_retry')}
          type="number"
          placeholder="3"
          value={values.requestRetry}
          onChange={(requestRetry) => onChange({ requestRetry })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.requestRetry)}
        />
        <TextSetting
          fieldId="maxRetryCredentials"
          size="sm"
          label={t('config_management.visual.sections.network.max_retry_credentials')}
          description={t('config_management.visual.sections.network.max_retry_credentials_hint')}
          type="number"
          placeholder="0"
          value={values.maxRetryCredentials}
          onChange={(maxRetryCredentials) => onChange({ maxRetryCredentials })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.maxRetryCredentials)}
        />
        <TextSetting
          fieldId="maxRetryInterval"
          size="sm"
          label={t('config_management.visual.sections.network.max_retry_interval')}
          description={t('config_management.visual.sections.network.max_retry_interval_hint')}
          type="number"
          placeholder="30"
          value={values.maxRetryInterval}
          onChange={(maxRetryInterval) => onChange({ maxRetryInterval })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.maxRetryInterval)}
        />
        <TextSetting
          fieldId="authAutoRefreshWorkers"
          size="sm"
          label={t('config_management.visual.sections.network.auth_auto_refresh_workers')}
          description={t(
            'config_management.visual.sections.network.auth_auto_refresh_workers_hint'
          )}
          type="number"
          placeholder="16"
          value={values.authAutoRefreshWorkers}
          onChange={(authAutoRefreshWorkers) => onChange({ authAutoRefreshWorkers })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.authAutoRefreshWorkers)}
        />
        <SelectSetting
          fieldId="routingStrategy"
          label={t('config_management.visual.sections.network.routing_strategy')}
          description={t('config_management.visual.sections.network.routing_strategy_hint')}
          value={values.routingStrategy}
          options={routingStrategyOptions}
          disabled={disabled}
          onChange={(routingStrategy) => onChange({ routingStrategy })}
        />
        <SelectSetting
          fieldId="disableImageGeneration"
          label={t('config_management.visual.sections.network.disable_image_generation')}
          description={t('config_management.visual.sections.network.disable_image_generation_hint')}
          value={values.disableImageGeneration}
          options={disableImageGenerationOptions}
          disabled={disabled}
          onChange={(disableImageGeneration) => onChange({ disableImageGeneration })}
        />
        <TextSetting
          fieldId="gptImage2BaseModel"
          label={t('config_management.visual.sections.network.gpt_image_2_base_model')}
          description={t('config_management.visual.sections.network.gpt_image_2_base_model_hint')}
          placeholder="gpt-5.4-mini"
          value={values.gptImage2BaseModel}
          onChange={(gptImage2BaseModel) => onChange({ gptImage2BaseModel })}
          disabled={disabled}
        />
        <TextSetting
          fieldId="routingSessionAffinityTTL"
          size="sm"
          label={t('config_management.visual.sections.network.session_affinity_ttl')}
          placeholder="1h"
          value={values.routingSessionAffinityTTL}
          onChange={(routingSessionAffinityTTL) => onChange({ routingSessionAffinityTTL })}
          disabled={disabled}
        />
      </SettingList>

      <SettingList>
        <ToggleSetting
          fieldId="routingSessionAffinitySubagents"
          label={t('config_management.visual.additions.routingSessionAffinitySubagents.label')}
          description={t('config_management.visual.additions.routingSessionAffinitySubagents.hint')}
          checked={values.routingSessionAffinitySubagents}
          disabled={disabled}
          onChange={(routingSessionAffinitySubagents) =>
            onChange({ routingSessionAffinitySubagents })
          }
        />
        <ToggleSetting
          fieldId="saveCooldownStatus"
          label={t('config_management.visual.additions.saveCooldownStatus.label')}
          description={t('config_management.visual.additions.saveCooldownStatus.hint')}
          checked={values.saveCooldownStatus}
          disabled={disabled}
          onChange={(saveCooldownStatus) => onChange({ saveCooldownStatus })}
        />
        <TextSetting
          fieldId="transientErrorCooldownSeconds"
          size="sm"
          label={t('config_management.visual.additions.transientErrorCooldownSeconds.label')}
          description={t('config_management.visual.additions.transientErrorCooldownSeconds.hint')}
          type="number"
          value={values.transientErrorCooldownSeconds}
          onChange={(transientErrorCooldownSeconds) => onChange({ transientErrorCooldownSeconds })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.transientErrorCooldownSeconds)}
        />
        <TextSetting
          fieldId="videoResultAuthCacheTTL"
          size="sm"
          label={t('config_management.visual.additions.videoResultAuthCacheTTL.label')}
          description={t('config_management.visual.additions.videoResultAuthCacheTTL.hint')}
          value={values.videoResultAuthCacheTTL}
          onChange={(videoResultAuthCacheTTL) => onChange({ videoResultAuthCacheTTL })}
          disabled={disabled}
          error={getValidationMessage(t, validationErrors?.videoResultAuthCacheTTL)}
        />
        <ToggleSetting
          fieldId="forceModelPrefix"
          label={t('config_management.visual.sections.network.force_model_prefix')}
          description={t('config_management.visual.sections.network.force_model_prefix_desc')}
          checked={values.forceModelPrefix}
          disabled={disabled}
          onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
        />
        <ToggleSetting
          fieldId="passthroughHeaders"
          label={t('config_management.visual.sections.network.passthrough_headers')}
          description={t('config_management.visual.sections.network.passthrough_headers_desc')}
          checked={values.passthroughHeaders}
          disabled={disabled}
          onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
        />
        <ToggleSetting
          fieldId="disableCooling"
          label={t('config_management.visual.sections.network.disable_cooling')}
          description={t('config_management.visual.sections.network.disable_cooling_desc')}
          checked={values.disableCooling}
          disabled={disabled}
          onChange={(disableCooling) => onChange({ disableCooling })}
        />
        <ToggleSetting
          fieldId="routingSessionAffinity"
          label={t('config_management.visual.sections.network.session_affinity')}
          checked={values.routingSessionAffinity}
          disabled={disabled}
          onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
        />
        <ToggleSetting
          fieldId="wsAuth"
          label={t('config_management.visual.sections.network.ws_auth')}
          description={t('config_management.visual.sections.network.ws_auth_desc')}
          checked={values.wsAuth}
          disabled={disabled}
          onChange={(wsAuth) => onChange({ wsAuth })}
        />
      </SettingList>
      <SettingList>
        <ToggleSetting
          fieldId="enableGeminiCliEndpoint"
          label={t('config_management.visual.sections.network.enable_gemini_cli_endpoint')}
          description={t(
            'config_management.visual.sections.network.enable_gemini_cli_endpoint_desc'
          )}
          checked={values.enableGeminiCliEndpoint}
          disabled={disabled}
          onChange={(enableGeminiCliEndpoint) => onChange({ enableGeminiCliEndpoint })}
        />
      </SettingList>
    </SectionCard>
  );
}
