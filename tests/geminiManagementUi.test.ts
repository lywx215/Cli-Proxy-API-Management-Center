import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { OAuthAliasMappingRow } from '@/features/authFiles/components/OAuthAliasMappingRow';
import { GeminiResourcePanel } from '@/features/providers/components/GeminiResourcePanel';
import { GeminiGroupedResources } from '@/features/providers/components/GeminiGroupedResources';
import { ProviderResourceTable } from '@/features/providers/components/ProviderResourceTable';
import { geminiResourcesFromSnapshot } from '@/features/providers/geminiManagement';
import type { GeminiSnapshot } from '@/services/api/geminiManagement';
import en from '@/i18n/locales/en.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const render = (component: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, {}, component))
  );
const snapshot: GeminiSnapshot = {
  revision: 'fixture-revision',
  aliases: [{ name: 'upstream', alias: 'public', fork: true }],
  capabilities: { aliases: true, batch: true, migration: true },
  groups: [
    {
      name: 'team',
      models: [{ name: 'upstream', alias: 'local' }],
      keys: Array.from({ length: 60 }, (_, index) => ({
        'api-key': `fixture-secret-key-${String(index).padStart(4, '0')}`,
      })),
    },
  ],
};
const resources = geminiResourcesFromSnapshot(snapshot);

const renderGrouped = (
  groups: Record<string, unknown>[],
  overrides: Partial<ComponentProps<typeof GeminiGroupedResources>> = {}
) => {
  const groupResources = geminiResourcesFromSnapshot({ ...snapshot, groups });
  return render(
    createElement(GeminiGroupedResources, {
      groups,
      resources: groupResources,
      filteredResources: groupResources,
      includeEmpty: true,
      groupFilter: '',
      nameFilter: '',
      pageSize: 25,
      compact: false,
      aliasCount: 0,
      selected: new Set<string>(),
      disabled: false,
      selectedId: null,
      onSelect: () => {},
      onAdd: () => {},
      onEditGroup: () => {},
      onView: () => {},
      onEdit: () => {},
      onDelete: () => {},
      onToggle: () => {},
      ...overrides,
    })
  );
};

describe('Gemini management UI', () => {
  test('renders only the selected page with named controls and masked keys', () => {
    const html = render(
      createElement(GeminiResourcePanel, {
        snapshot,
        snapshotLoading: false,
        snapshotError: null,
        group: { id: 'gemini', resources },
        filteredResources: resources,
        filter: '',
        onFilterChange: () => {},
        selectedId: null,
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onCreate: () => {},
        onReload: async () => {},
        preferences: {
          filter: '',
          sortBy: 'name',
          sortDir: 'asc',
          selectedModels: [],
          pageSize: 25,
          viewMode: 'keys',
        },
        onPreferences: () => {},
      })
    );
    const selectedRows = [...html.matchAll(/aria-label="Select Key /g)];
    expect(selectedRows.length).toBe(25);
    expect(html).toContain('Page 1 / 3 · 60 Keys');
    expect(html).toContain('Select all filtered');
    expect(html).toContain('Edit common parameters');
    expect(html).toContain('Gemini API Key model aliases');
    expect(html).toContain('aria-label="Group"');
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-label="Rows per page"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('fixture-secret-key-0000');
  });
  test('defaults to collapsed groups while keeping bulk and shared-setting controls visible', () => {
    const html = render(
      createElement(GeminiResourcePanel, {
        snapshot,
        snapshotLoading: false,
        snapshotError: null,
        group: { id: 'gemini', resources },
        filteredResources: resources,
        filter: '',
        onFilterChange: () => {},
        selectedId: null,
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onCreate: () => {},
        onReload: async () => {},
        preferences: { filter: '', sortBy: 'name', sortDir: 'asc', selectedModels: [] },
        onPreferences: () => {},
      })
    );
    expect(html).toContain('<h3>team</h3>');
    expect(html).toContain('60 Keys');
    expect(html).toContain(en.gemini_groups.addKeys);
    expect(html).toContain(en.gemini_groups.editGroup);
    expect(html).toContain(en.gemini_groups.expandKeys);
    expect(html).not.toContain('aria-label="Select Key ');
    expect(html).not.toContain('fixture-secret-key-0000');
  });
  test('keeps empty groups visible and ready for adding Keys without rendering a key table', () => {
    const html = renderGrouped([{ name: 'empty-import-target', keys: [] }]);
    expect(html).toContain('<h3>empty-import-target</h3>');
    expect(html).toContain('0 Keys');
    expect(html).toContain(en.gemini_groups.addKeys);
    expect(html).not.toContain('aria-label="Select Key ');
    expect(
      renderGrouped([{ name: 'empty-import-target', keys: [] }], { includeEmpty: false })
    ).not.toContain('<h3>empty-import-target</h3>');
  });
  test('paginates group cards separately from expanded Key rows', () => {
    const groups = Array.from({ length: 30 }, (_, index) => ({
      name: `group-${String(index).padStart(2, '0')}`,
      keys: [{ 'api-key': `pagination-fixture-${index}` }],
    }));
    const html = renderGrouped(groups);
    expect([...html.matchAll(/<h3>/g)]).toHaveLength(25);
    expect(html).toContain('<h3>group-24</h3>');
    expect(html).not.toContain('<h3>group-25</h3>');
    expect(html).toContain('30 groups');
    expect(html).not.toContain('aria-label="Select Key ');
  });
  test('focuses a newly created group on its actual group page', () => {
    const groups = Array.from({ length: 30 }, (_, index) => ({
      name: `group-${String(index).padStart(2, '0')}`,
      keys: [{ 'api-key': `focus-fixture-${index}` }],
    }));
    const html = renderGrouped(groups, { focusGroup: 26 });
    expect(html).toContain('<h3>group-26</h3>');
    expect(html).not.toContain('<h3>group-00</h3>');
    expect([...html.matchAll(/aria-label="Select Key /g)]).toHaveLength(1);
  });
  test('renders one masked page rather than all 1000 Keys when a group is expanded', () => {
    const keys = Array.from({ length: 1000 }, (_, index) => ({
      'api-key': `thousand-fixture-${index}`,
    }));
    const html = renderGrouped([{ name: 'large-group', keys }], { focusGroup: 0 });
    expect([...html.matchAll(/aria-label="Select Key /g)]).toHaveLength(25);
    expect(html).toContain('Page 1 / 40 · 1000 Keys');
    expect(html).not.toContain('thousand-fixture-0');
    expect(html).not.toContain('thousand-fixture-999');
  });
  test('whole-group selection explicitly includes Keys hidden by filtering', () => {
    const groups = [
      {
        name: 'filtered-team',
        keys: [{ 'api-key': 'visible-fixture' }, { 'api-key': 'hidden-fixture' }],
      },
    ];
    const allResources = geminiResourcesFromSnapshot({ ...snapshot, groups });
    const html = renderGrouped(groups, {
      filteredResources: allResources.slice(0, 1),
      selected: new Set(['0:0']),
    });
    const checkbox = html.match(
      /<input[^>]*aria-label="Select entire group filtered-team [^>]*>/
    )?.[0];
    expect(checkbox).toContain('2 Keys, including filtered-out Keys');
    expect(checkbox).not.toContain('checked=""');
    expect(html).not.toContain('hidden-fixture');
  });
  test('distinguishes inherited, direct and SOCKS proxy settings without exposing URL credentials', () => {
    const html = renderGrouped([
      { name: 'global-proxy', keys: [] },
      { name: 'direct-proxy', 'proxy-url': 'direct', keys: [] },
      {
        name: 'socks-proxy',
        'proxy-url': 'socks5://fixture-user:fixture-password@127.0.0.1:1080/?token=fixture-token',
        keys: [],
      },
      { name: 'invalid-proxy', 'proxy-url': 'invalid-address', keys: [] },
    ]);
    expect(html).toContain(en.gemini_groups.inheritGlobalProxy);
    expect(html).toContain(en.gemini_groups.directProxy);
    expect(html).toContain(en.gemini_groups.invalidProxy);
    expect(html).toContain('socks5://127.0.0.1:1080');
    expect(html).not.toContain('fixture-user');
    expect(html).not.toContain('fixture-password');
    expect(html).not.toContain('fixture-token');
  });
  test('disables selection and new mutations without matching backend support', () => {
    const html = render(
      createElement(GeminiResourcePanel, {
        snapshot: null,
        snapshotLoading: false,
        snapshotError: { status: 404 },
        group: { id: 'gemini', resources },
        filteredResources: resources.slice(0, 1),
        filter: '',
        onFilterChange: () => {},
        selectedId: null,
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onCreate: () => {},
        onReload: async () => {},
        preferences: { filter: '', sortBy: 'name', sortDir: 'asc', selectedModels: [] },
        onPreferences: () => {},
      })
    );
    expect(html).toContain(en.gemini_management.unavailable);
    const checkbox = html.match(/<input[^>]*aria-label="Select Key [^>]*>/)?.[0];
    expect(checkbox).toContain('disabled=""');
  });
  test('table identifies the effective model source without revealing a credential', () => {
    const html = render(
      createElement(ProviderResourceTable, {
        resources: resources.slice(0, 1),
        aliasCount: 1,
        compact: true,
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
        selection: {
          selected: new Set(['0:0']),
          disabled: false,
          getId: () => '0:0',
          onToggle: () => {},
          onTogglePage: () => {},
        },
      })
    );
    expect(html).toContain(en.gemini_management.sources.group);
    expect(html).toContain('Global aliases: 1');
    expect(html).toContain(en.gemini_management.enabled);
    expect(html).not.toContain(en.providersPage.status.active);
    expect(html).toContain('checked=""');
    expect(html).not.toContain('fixture-secret-key-0000');
  });
  test('preserves the existing active status label on other providers', () => {
    const html = render(
      createElement(ProviderResourceTable, {
        resources: [{ ...resources[0], brand: 'codex' }],
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
      })
    );
    expect(html).toContain(en.providersPage.status.active);
    expect(html).not.toContain(en.gemini_management.sources.group);
  });
  test('reuses the alias row with a Gemini label and original-name toggle', () => {
    const html = render(
      createElement(OAuthAliasMappingRow, {
        entry: { name: 'upstream', alias: 'public', fork: true },
        index: 0,
        options: [],
        disabled: false,
        canRemove: true,
        onChange: () => {},
        onRemove: () => {},
        translationPrefix: 'gemini_management',
      })
    );
    expect(html).toContain('aria-label="Alias rule 1"');
    expect(html).toContain('Keep original name');
    expect(html).toContain('aria-label="Remove alias rule 1"');
  });
  test('all six locales cover the same labels and interpolation tokens', () => {
    const flatten = (value: unknown, prefix = ''): Record<string, string> => {
      if (typeof value === 'string') return { [prefix]: value };
      return Object.assign(
        {},
        ...Object.entries(value as Record<string, unknown>).map(([key, entry]) =>
          flatten(entry, prefix ? `${prefix}.${key}` : key)
        )
      );
    };
    for (const namespace of ['gemini_management', 'gemini_groups'] as const) {
      const reference = flatten(en[namespace]);
      for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
        const section = JSON.parse(
          readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
        )[namespace];
        const labels = flatten(section);
        expect(Object.keys(labels).sort()).toEqual(Object.keys(reference).sort());
        for (const [key, label] of Object.entries(labels)) {
          expect(label.trim().length).toBeGreaterThan(0);
          expect([...label.matchAll(/{{([^}]+)}}/g)].map((match) => match[1]).sort()).toEqual(
            [...reference[key].matchAll(/{{([^}]+)}}/g)].map((match) => match[1]).sort()
          );
        }
      }
    }
  });
});
