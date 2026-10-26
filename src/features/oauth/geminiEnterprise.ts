import type { GeminiEnterpriseConfig } from '@/types/config';
import { GEMINI_ENTERPRISE_CALLBACK_URL } from '@/services/api/geminiEnterprise';

// The application ID is public; its secret is resolved only by the backend.
export const GEMINI_ENTERPRISE_APPLICATION = Object.freeze({
  clientId: '149818555228-j5jbi8obf9fovr3budg0hc609i546qhc.apps.googleusercontent.com',
  clientSecretEnv: 'GEMINI_ENTERPRISE_CLIENT_SECRET',
});

export const isGeminiEnterpriseApplicationField = (field: keyof GeminiEnterpriseConfig) =>
  field === 'clientId' || field === 'clientSecretEnv';

export const withGeminiEnterpriseApplication = (
  value: GeminiEnterpriseConfig
): GeminiEnterpriseConfig => ({ ...value, ...GEMINI_ENTERPRISE_APPLICATION });

const RESOURCE = /^[A-Za-z0-9_-]+$/;
const ENVIRONMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateGeminiEnterpriseConfig(
  value: GeminiEnterpriseConfig,
  discoverResources = false
) {
  const errors: Partial<
    Record<keyof GeminiEnterpriseConfig, 'required' | 'resource' | 'environment'>
  > = {};
  if (!value.clientId.trim()) errors.clientId = 'required';
  if (value.clientSecretEnv && !ENVIRONMENT.test(value.clientSecretEnv))
    errors.clientSecretEnv = 'environment';
  for (const field of [
    'projectId',
    'location',
    'collectionId',
    'engineId',
    'assistantId',
  ] as const) {
    if (discoverResources) continue;
    const text = field === 'assistantId' ? value[field] || 'default_assistant' : value[field];
    if (!RESOURCE.test(text)) errors[field] = 'resource';
  }
  return errors;
}

export function validateGeminiEnterpriseCallback(
  input: string,
  state?: string
): 'url' | 'state' | 'code' | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return 'url';
  }
  const expected = new URL(GEMINI_ENTERPRISE_CALLBACK_URL);
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.username ||
    url.password ||
    url.hash
  )
    return 'url';
  if (
    !state ||
    url.searchParams.getAll('state').length !== 1 ||
    url.searchParams.get('state') !== state
  )
    return 'state';
  if (
    (!url.searchParams.get('code') && !url.searchParams.get('error')) ||
    url.searchParams.getAll('code').length > 1
  )
    return 'code';
  return null;
}
