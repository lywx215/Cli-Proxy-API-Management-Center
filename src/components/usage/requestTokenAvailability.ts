export function isRequestTokenUsageAvailable(
  provider: string,
  source: string,
  tokenCounts: readonly number[]
): boolean {
  if (tokenCounts.some((value) => Number.isFinite(value) && value > 0)) return true;

  const normalizedProvider = provider.trim().toLowerCase().replace(/_/g, '-');
  // Trust the credential type; filenames only identify historical or unresolved credentials.
  const isEnterprise = normalizedProvider
    ? normalizedProvider === 'gemini-enterprise'
    : /^(?:t:)?gemini-enterprise-.+\.json$/i.test(source.trim());
  return !isEnterprise;
}

export function reportedRequestTokenValue(value: number, available: boolean): number | null {
  return available ? value : null;
}
