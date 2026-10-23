export interface RequestTokenCounts {
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cached_tokens: number | null;
  cache_tokens?: number | null;
  total_tokens: number | null;
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
    ? normalizedProvider === 'gemini-enterprise'
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
  if (tokens.total_tokens === undefined && available) {
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
    total_tokens: total,
  };
}
