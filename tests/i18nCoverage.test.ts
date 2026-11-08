import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import ts from 'typescript';
import { OAuthFlowDialog } from '@/features/oauth/components/OAuthFlowDialog';
import {
  getOAuthProviderTextKey,
  OAUTH_PROVIDERS,
  supportsManualCallback,
} from '@/features/oauth/providers';
import type { ProviderFlowState } from '@/features/oauth/hooks/useOAuthFlows';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import ko from '@/i18n/locales/ko.json';
import vi from '@/i18n/locales/vi.json';

const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi };
const literalReferences = new Map<string, boolean>();

function collectReferences(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectReferences(path);
      continue;
    }
    if (!/\.tsx?$/.test(path)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
          (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'))
      ) {
        const [key, options] = node.arguments;
        if (
          key &&
          (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
          key.text.includes('.')
        ) {
          const properties =
            options && ts.isObjectLiteralExpression(options)
              ? options.properties.map((property) => property.name?.getText(source))
              : [];
          if (!properties.includes('defaultValue')) {
            literalReferences.set(
              key.text,
              (literalReferences.get(key.text) ?? false) || properties.includes('count')
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
collectReferences('src');

const states: Record<string, ProviderFlowState> = {
  idle: {},
  waiting: { status: 'waiting', url: 'https://auth.example.test/authorize', state: 'fixture' },
  retry: {
    status: 'error',
    url: 'https://auth.example.test/authorize',
    state: 'fixture',
    error: 'fixture-error',
  },
  failed: { status: 'error', error: 'fixture-error' },
  success: { status: 'success' },
};
const noop = () => {};

describe('translation coverage without fallback languages', () => {
  for (const [language, translation] of Object.entries(locales)) {
    test(`resolves literal UI keys, including plural labels (${language})`, async () => {
      const i18n = createInstance();
      await i18n.init({
        lng: language,
        fallbackLng: false,
        resources: { [language]: { translation } },
      });
      const missing: string[] = [];
      for (const [key, plural] of literalReferences) {
        const counts = plural ? [0, 1, 2, 5, 11] : [undefined];
        if (counts.some((count) => !i18n.exists(key, count === undefined ? {} : { count }))) {
          missing.push(key);
        }
      }
      expect(missing).toEqual([]);
    });

    for (const provider of OAUTH_PROVIDERS) {
      test(`renders every ${provider.id} OAuth state without raw keys (${language})`, async () => {
        const i18n = createInstance();
        await i18n.init({
          lng: language,
          fallbackLng: false,
          resources: { [language]: { translation } },
          interpolation: { escapeValue: false },
        });
        for (const suffix of [
          'oauth_hint',
          'oauth_button',
          'copy_link',
          'open_link',
          'oauth_status_waiting',
          'oauth_status_success',
          'oauth_status_error',
          'oauth_start_error',
          'oauth_polling_error',
        ]) {
          expect(i18n.exists(getOAuthProviderTextKey(provider.id, suffix))).toBe(true);
        }
        for (const state of Object.values(states)) {
          const html = renderToStaticMarkup(
            createElement(
              I18nextProvider,
              { i18n },
              createElement(OAuthFlowDialog, {
                open: true,
                providerId: provider.id,
                heading: { title: i18n.t(provider.titleKey), caption: '', icon: '' },
                state,
                text: (suffix) => i18n.t(getOAuthProviderTextKey(provider.id, suffix)),
                supportsCallback: supportsManualCallback(provider),
                onStart: noop,
                onCancel: noop,
                onCallbackChange: noop,
                onCallbackSubmit: noop,
                onViewAuthFiles: noop,
                onClose: noop,
              })
            )
          );
          expect(html).toContain('role="dialog"');
          expect(html).not.toMatch(/auth_login\.|antigravity_enterprise\.|common\./);
        }
      });
    }
  }
});
