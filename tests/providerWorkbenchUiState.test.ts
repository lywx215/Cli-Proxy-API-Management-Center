import { describe, expect, test } from 'bun:test';
import {
  getProviderFilterState,
  readProvidersWorkbenchUiState,
  writeProvidersWorkbenchUiState,
} from '@/features/providers/uiState';

const storageKey = 'providersPage.uiState';

function withStorage(run: (storage: Map<string, string>) => void) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });
  try {
    run(storage);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

describe('provider workbench view preferences', () => {
  test.each([
    ['keys', 'keys'],
    ['groups', 'groups'],
    ['unexpected', 'groups'],
    [null, 'groups'],
    [false, 'groups'],
  ])('normalizes saved view mode %p to %p', (input, expected) => {
    withStorage((storage) => {
      storage.set(
        storageKey,
        JSON.stringify({
          activeBrand: 'gemini',
          filtersByBrand: { gemini: { viewMode: input } },
        })
      );
      expect(getProviderFilterState(readProvidersWorkbenchUiState(), 'gemini').viewMode).toBe(
        expected
      );
    });
  });

  test('keeps legacy preferences but gives their missing view mode the groups default', () => {
    withStorage((storage) => {
      storage.set(
        storageKey,
        JSON.stringify({
          activeBrand: 'gemini',
          filtersByBrand: { gemini: { filter: 'team', pageSize: 50, selectedModels: ['model'] } },
        })
      );
      expect(getProviderFilterState(readProvidersWorkbenchUiState(), 'gemini')).toMatchObject({
        filter: 'team',
        pageSize: 50,
        selectedModels: ['model'],
        viewMode: 'groups',
      });
    });
  });

  test('round-trips an explicit keys view independently from another provider', () => {
    withStorage(() => {
      writeProvidersWorkbenchUiState({
        activeBrand: 'gemini',
        filtersByBrand: {
          gemini: {
            filter: '',
            sortBy: 'name',
            sortDir: 'asc',
            selectedModels: [],
            viewMode: 'keys',
          },
          codex: { filter: 'other', sortBy: 'name', sortDir: 'asc', selectedModels: [] },
        },
      });
      const state = readProvidersWorkbenchUiState();
      expect(getProviderFilterState(state, 'gemini').viewMode).toBe('keys');
      expect(getProviderFilterState(state, 'codex')).toMatchObject({
        filter: 'other',
        viewMode: 'groups',
      });
    });
  });
});
