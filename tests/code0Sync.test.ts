import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildProviderGroups,
  useProviderWorkbench,
} from '../src/features/providers/useProviderWorkbench';
import {
  getSponsorProviderDefinition,
  isMultiProtocolSponsorBrand,
} from '../src/features/providers/sponsorDefinitions';
import { PROVIDER_BRAND_ORDER } from '../src/features/providers/descriptors';
import type { ProviderEntryFormInput, SponsorProtocol } from '../src/features/providers/types';
import { providersApi } from '../src/services/api/providers';
import { useConfigStore } from '../src/stores/useConfigStore';
import type { Config } from '../src/types';

let savedState: ReturnType<typeof useConfigStore.getState>;
let savedInitialState: ReturnType<typeof useConfigStore.getInitialState>;
const restorers: Array<() => void> = [];
beforeEach(() => {
  savedState = { ...useConfigStore.getState() };
  savedInitialState = { ...useConfigStore.getInitialState() };
  // Other suites may have already separated the current and SSR snapshots.
  useConfigStore.setState({ config: null });
});
afterEach(() => {
  restorers.splice(0).forEach((restore) => restore());
  Object.assign(useConfigStore.getInitialState(), savedInitialState);
  useConfigStore.setState(savedState, true);
});

function workbench(config: Config) {
  // React SSR reads Zustand's initial snapshot rather than the current snapshot.
  Object.assign(useConfigStore.getInitialState(), { config, fetchConfig: async () => config });
  useConfigStore.setState({ config, fetchConfig: async () => config });
  let captured!: ReturnType<typeof useProviderWorkbench>;
  function Harness() {
    captured = useProviderWorkbench();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return captured;
}

test('Code0 remains a quick-access group and creates, edits, and deletes all four protocols', async () => {
  const definition = getSponsorProviderDefinition('code0');
  expect(PROVIDER_BRAND_ORDER).toContain('code0');
  expect(isMultiProtocolSponsorBrand('code0')).toBe(true);
  expect(definition.affiliateUrl).toBe('https://code0.ai/agent/register/slxVMR3uVBoRgNBf');

  const refreshVertex = spyOn(providersApi, 'getVertexConfigs').mockResolvedValue([]);
  const refreshOpenai = spyOn(providersApi, 'getOpenAIProviders').mockResolvedValue([]);
  const createGemini = spyOn(providersApi, 'createGeminiKey').mockResolvedValue(undefined);
  const createCodex = spyOn(providersApi, 'createCodexConfig').mockResolvedValue(undefined);
  const createClaude = spyOn(providersApi, 'createClaudeConfig').mockResolvedValue(undefined);
  const createOpenai = spyOn(providersApi, 'createOpenAIProvider').mockResolvedValue(undefined);
  const updateGemini = spyOn(providersApi, 'updateGeminiKey').mockResolvedValue(undefined);
  const updateCodex = spyOn(providersApi, 'updateCodexConfig').mockResolvedValue(undefined);
  const updateClaude = spyOn(providersApi, 'updateClaudeConfig').mockResolvedValue(undefined);
  const updateOpenai = spyOn(providersApi, 'updateOpenAIProvider').mockResolvedValue(undefined);
  const deleteGemini = spyOn(providersApi, 'deleteGeminiKey').mockResolvedValue(undefined);
  const deleteCodex = spyOn(providersApi, 'deleteCodexConfig').mockResolvedValue(undefined);
  const deleteClaude = spyOn(providersApi, 'deleteClaudeConfig').mockResolvedValue(undefined);
  const deleteOpenai = spyOn(providersApi, 'deleteOpenAIProvider').mockResolvedValue(undefined);
  const disableOpenai = spyOn(providersApi, 'updateOpenAIProviderDisabled').mockResolvedValue(
    undefined
  );
  for (const stub of [
    refreshVertex,
    refreshOpenai,
    createGemini,
    createCodex,
    createClaude,
    createOpenai,
    updateGemini,
    updateCodex,
    updateClaude,
    updateOpenai,
    deleteGemini,
    deleteCodex,
    deleteClaude,
    deleteOpenai,
    disableOpenai,
  ]) {
    restorers.push(() => stub.mockRestore());
  }
  const protocols: SponsorProtocol[] = ['openai', 'codex', 'claude', 'gemini'];
  const input: ProviderEntryFormInput = {
    apiKey: '',
    name: '',
    baseUrl: 'https://code0.ai',
    proxyUrl: '',
    prefix: '',
    disabled: false,
    models: [],
    headers: [],
    excludedModelsText: '',
    sponsorKeyEntries: protocols.map((protocol) => ({
      protocol,
      apiKey: 'synthetic-code0-key',
      baseUrl: 'https://code0.ai',
      proxyUrl: '',
      prefix: 'sync',
      disabled: false,
      models: [],
      priority: 3,
    })),
  };
  await workbench({}).createProvider('code0', input);
  for (const stub of [createGemini, createCodex, createClaude, createOpenai])
    expect(stub).toHaveBeenCalledTimes(1);
  expect(createCodex.mock.calls[0][0].baseUrl).toBe('https://code0.ai/v1');
  expect(createGemini.mock.calls[0][0].baseUrl).toBe('https://code0.ai');

  const config: Config = {
    geminiApiKeys: [createGemini.mock.calls[0][0]],
    codexApiKeys: [createCodex.mock.calls[0][0]],
    claudeApiKeys: [{ ...createClaude.mock.calls[0][0], fingerprintProfile: 'claude-code-cli' }],
    openaiCompatibility: [{ ...createOpenai.mock.calls[0][0], sourceIndex: 7 }],
  };
  const source = (groupIndex: number, keyIndex?: number) => ({
    groupIndex,
    keyIndex,
    group: {
      name: `code0-${groupIndex}`,
      'base-url': 'https://code0.ai',
      'request-retry': 3,
      future: { preserve: true },
      keys: [{ 'api-key': 'same-synthetic-key' }, { 'api-key': 'synthetic-code0-key' }],
    },
  });
  config.geminiApiKeys![0].source = source(3, 1);
  config.codexApiKeys![0].source = source(4, 1);
  config.claudeApiKeys![0].source = source(5, 1);
  config.openaiCompatibility![0].source = source(7);
  const groups = buildProviderGroups(config);
  const resource = groups.find((group) => group.id === 'code0')!.resources[0];
  expect(groups.flatMap((group) => group.resources)).toHaveLength(1);
  const existing = workbench(config);
  await existing.updateProvider(resource, input);
  for (const stub of [updateGemini, updateCodex, updateClaude, updateOpenai])
    expect(stub).toHaveBeenCalledTimes(1);
  expect(updateClaude.mock.calls[0][2].fingerprintProfile).toBe('claude-code-cli');
  expect(updateGemini.mock.calls[0][2].source).toEqual(config.geminiApiKeys![0].source);
  expect(updateCodex.mock.calls[0][2].source).toEqual(config.codexApiKeys![0].source);
  expect(updateClaude.mock.calls[0][2].source).toEqual(config.claudeApiKeys![0].source);
  expect(updateOpenai.mock.calls[0][2].source).toEqual(config.openaiCompatibility![0].source);
  expect(updateOpenai.mock.calls[0][1]).toBe(7);
  await existing.toggleDisabled(resource, true);
  expect(disableOpenai.mock.calls[0]).toEqual([7, true, config.openaiCompatibility![0].source]);
  await existing.deleteProvider(resource);
  for (const stub of [deleteGemini, deleteCodex, deleteClaude, deleteOpenai])
    expect(stub).toHaveBeenCalledTimes(1);
  expect(deleteOpenai.mock.calls[0][0]).toBe(7);
  expect(deleteGemini.mock.calls[0][2]).toEqual(config.geminiApiKeys![0].source);
  expect(deleteCodex.mock.calls[0][2]).toEqual(config.codexApiKeys![0].source);
  expect(deleteClaude.mock.calls[0][2]).toEqual(config.claudeApiKeys![0].source);
  expect(deleteOpenai.mock.calls[0][1]).toEqual(config.openaiCompatibility![0].source);
});
