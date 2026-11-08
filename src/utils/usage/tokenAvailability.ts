export interface TokenEstimate {
  source: 'local_gemma3_sentencepiece';
  input_text_tokens: number | null;
  incomplete: boolean;
  response_complete: boolean;
}

export function normalizeTokenEstimate(value: unknown): TokenEstimate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const estimate = value as Record<string, unknown>;
  if (
    estimate.source !== 'local_gemma3_sentencepiece' ||
    typeof estimate.incomplete !== 'boolean' ||
    typeof estimate.response_complete !== 'boolean'
  )
    return undefined;
  const input = estimate.input_text_tokens;
  return {
    source: estimate.source,
    input_text_tokens:
      typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? input : null,
    incomplete: estimate.incomplete,
    response_complete: estimate.response_complete,
  };
}

export interface RequestTokenCounts {
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cached_tokens: number | null;
  cache_tokens?: number | null;
  total_tokens: number | null;
  estimate?: TokenEstimate;
}

export function isRequestTokenUsageAvailable(
  provider: string,
  source: string,
  tokenCounts: readonly unknown[]
): boolean {
  if (tokenCounts.some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0))
    return true;
  if (
    tokenCounts.some((value) => value === null) &&
    tokenCounts.some((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  )
    return true;
  const normalizedProvider = provider.trim().toLowerCase().replace(/_/g, '-');
  const isEnterprise = normalizedProvider
    ? ['gemini-enterprise', 'gemini-enterprise-web'].includes(normalizedProvider)
    : /^(?:t:)?gemini-enterprise-.+\.json$/i.test(source.trim());
  return !isEnterprise;
}

export function reportedRequestTokenValue(value: unknown, available = true): number | null {
  if (!available || (typeof value !== 'number' && typeof value !== 'string')) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeRequestTokenCounts(
  tokens: Record<string, unknown>,
  provider = '',
  source = ''
): RequestTokenCounts {
  const estimate = normalizeTokenEstimate(tokens.estimate);
  const fields = [
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cached_tokens',
    'total_tokens',
  ];
  const available = isRequestTokenUsageAvailable(provider, source, [
    ...fields.map((key) => tokens[key]),
    tokens.cache_tokens,
  ]);
  const input = reportedRequestTokenValue(tokens.input_tokens, available);
  const output = reportedRequestTokenValue(tokens.output_tokens, available);
  const reasoning = reportedRequestTokenValue(tokens.reasoning_tokens, available);
  const caches = [tokens.cached_tokens, tokens.cache_tokens]
    .map((value) => reportedRequestTokenValue(value, available))
    .filter((value): value is number => value !== null);
  const cached = caches.length ? Math.max(...caches) : null;
  let total = reportedRequestTokenValue(tokens.total_tokens, available);
  const partialWeb =
    provider.trim().toLowerCase().replace(/_/g, '-') === 'gemini-enterprise-web' &&
    (input === null || output === null);
  if (tokens.total_tokens === undefined && available && !partialWeb && !estimate?.incomplete) {
    const known = [input, output, reasoning, cached].filter(
      (value): value is number => value !== null
    );
    total = known.length ? known.reduce((sum, value) => sum + value, 0) : null;
  }
  return {
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    cached_tokens: cached,
    total_tokens: estimate?.incomplete ? null : total,
    ...(estimate ? { estimate } : {}),
  };
}
