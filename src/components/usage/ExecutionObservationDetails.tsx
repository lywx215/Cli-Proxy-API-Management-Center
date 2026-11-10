import { useTranslation } from 'react-i18next';
import { WEB_EXECUTION_STAGES, type ExecutionObservation } from '@/utils/usage/observation';
import styles from './ExecutionObservationDetails.module.scss';

const WEB_FAILURE_LABELS: Record<string, string> = {
  upstream_http_error: 'http',
  upstream_rpc_error: 'rpc',
  upstream_answer_rejected: 'rejected',
  upstream_connection_failed: 'transport',
  upstream_stream_read_failed: 'transport',
  stream_truncated_json: 'truncated',
  stream_missing_terminal_success: 'no_terminal',
  stream_response_limit: 'limit',
  web_request_cancelled: 'cancelled',
  web_request_deadline: 'cancelled',
  client_cancelled: 'cancelled',
  client_write_failed: 'write',
};

export function ExecutionObservationDetails({
  observation,
  executionId,
  traceId,
}: {
  observation?: ExecutionObservation;
  executionId?: string;
  traceId?: string;
}) {
  const { t } = useTranslation();
  const prefix = 'usage_stats.observation';
  if (!observation) return <span>{t(`${prefix}.not_recorded`)}</span>;
  const o = observation;
  const w = o.web;
  const absent = t(`${prefix}.not_observed`);
  const ms = (value: number | null) => (value === null ? absent : `${value.toFixed(2)} ms`);
  const rows = [
    [t(`${prefix}.request_model`), o.request_model],
    [t(`${prefix}.upstream_model`), o.upstream_request_model ?? absent],
    [t(`${prefix}.canonical_model`), o.upstream_canonical_model ?? absent],
    [t(`${prefix}.response_model`), o.response_model ?? absent],
    [t(`${prefix}.model_match`), t(`${prefix}.match_${o.model_match}`)],
    [
      t(`${prefix}.thinking`),
      o.thinking_level ?? (o.thinking_budget === null ? absent : String(o.thinking_budget)),
    ],
    [
      t(`${prefix}.include_thoughts`),
      o.include_thoughts === null ? absent : t(`${prefix}.${o.include_thoughts ? 'yes' : 'no'}`),
    ],
    [t(`${prefix}.first_byte`), ms(o.upstream_ttfb_ms)],
    [t(`${prefix}.first_summary`), ms(o.first_summary_ms)],
    [t(`${prefix}.first_answer`), ms(o.first_answer_ms)],
    [t(`${prefix}.first_tool`), ms(o.first_tool_call_ms)],
    [t(`${prefix}.upstream`), t(`${prefix}.upstream_${o.upstream_result}`)],
    [t(`${prefix}.completion_basis`), t(`${prefix}.basis_${o.completion_basis}`)],
    [t(`${prefix}.tail`), t(`${prefix}.tail_${o.tail_verification}`)],
    [t(`${prefix}.delivery`), t(`${prefix}.delivery_${o.delivery_result}`)],
    [t(`${prefix}.usage`), t(`${prefix}.usage_${o.usage_result}`)],
    [
      t(`${prefix}.finish`),
      o.candidate_finishes.map((f) => `${f.index}: ${f.reason}`).join(', ') || absent,
    ],
    [t(`${prefix}.execution_id`), executionId ?? absent],
    [t(`${prefix}.trace_id`), traceId ?? absent],
    [t(`${prefix}.attempt`), String(o.attempt_no)],
  ];
  if (w) {
    const yesNo = (value: boolean) => t(`${prefix}.${value ? 'yes' : 'no'}`);
    rows.push(
      [t(`${prefix}.web_client_http`), String(w.client_http_status ?? absent)],
      [t(`${prefix}.web_upstream_http`), String(w.upstream_http_status ?? absent)],
      [t(`${prefix}.web_answer_state`), w.answer_state ?? absent],
      [
        t(`${prefix}.web_google_error`),
        [w.google_status, w.google_reason].filter(Boolean).join(' · ') || absent,
      ],
      [t(`${prefix}.web_submitted`), yesNo(w.submitted)],
      [t(`${prefix}.web_output_started`), yesNo(w.output_started)],
      [t(`${prefix}.web_input_counts`), t(`${prefix}.web_input_values`, w)],
      [t(`${prefix}.web_total`), ms(w.total_ms)]
    );
    for (const stage of WEB_EXECUTION_STAGES) {
      const timing = w.stages_ms[stage];
      if (timing !== undefined) rows.push([t(`${prefix}.web_stages.${stage}`), ms(timing)]);
    }
  }
  if (o.error) {
    const { code, stage, scope } = o.error;
    const label =
      w &&
      (Object.prototype.hasOwnProperty.call(WEB_FAILURE_LABELS, code)
        ? WEB_FAILURE_LABELS[code]
        : code.startsWith('stream_')
          ? 'protocol'
          : '');
    rows.push([
      t(`${prefix}.error`),
      label
        ? `${t(`${prefix}.web_failures.${label}`)} (${code}) · ${t(`${prefix}.web_stages.${stage}`, { defaultValue: stage })}`
        : `${code} · ${stage} · ${scope}`,
    ]);
  }
  return (
    <details className={styles.details}>
      <summary>
        {w
          ? t(`${prefix}.web_summary`, {
              status: w.client_http_status ?? absent,
              upstream: t(`${prefix}.upstream_${o.upstream_result}`),
              delivery: t(`${prefix}.delivery_${o.delivery_result}`),
            })
          : t(`${prefix}.details`)}
      </summary>
      <p>{t(`${prefix}.timing_hint`)}</p>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {o.response_model_sequence.length > 1 && (
        <p>
          {t(`${prefix}.model_sequence`)}: {o.response_model_sequence.join(' → ')}
        </p>
      )}
      {o.models_truncated && <p>{t(`${prefix}.truncated`)}</p>}
    </details>
  );
}
