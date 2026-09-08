import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { useVisualConfig } from '../src/hooks/useVisualConfig';

describe('fork visual config features', () => {
  test('round-trips rate limit, speed throttle, credits force, and Gemini CLI settings', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.loadVisualValuesFromYaml('debug: false\n');
        setPhase(1);
      } else if (phase === 1) {
        visualConfig.setVisualValues({
          apiKeyRateLimit: {
            enabled: true,
            defaultRpm: '60',
            overrides: [{ id: 'test', apiKey: 'sk-custom', rpm: '120' }],
          },
          speedThrottle: {
            enabled: true,
            maxConcurrent: '8',
            queueSize: '32',
            minTokensPerSecond: '10',
            maxTokensPerSecond: '40',
            minFirstTokenDelayMs: '100',
            maxFirstTokenDelayMs: '400',
          },
          quotaAntigravityCreditsForce: true,
          enableGeminiCliEndpoint: true,
          codexIdentityConfuse: true,
          antigravitySensitiveWords: ['Hermes'],
        });
        setPhase(2);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml(
            'debug: true\nunrelated: preserved\nantigravity:\n  connection-pool:\n    enabled: true\n    idle-conn-timeout: 30s\ncodex:\n  orphan-delegation-compatibility: true\nrouting:\n  session-affinity-subagents: false\n'
          )
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const merged = parseYaml(markup.slice('<pre>'.length, -'</pre>'.length));

    expect(merged).toMatchObject({
      debug: true,
      unrelated: 'preserved',
      'api-key-rate-limit': {
        enabled: true,
        'default-rpm': 60,
        overrides: [{ 'api-key': 'sk-custom', rpm: 120 }],
      },
      'speed-throttle': {
        enabled: true,
        'max-concurrent': 8,
        'queue-size': 32,
        'min-tokens-per-second': 10,
        'max-tokens-per-second': 40,
        'min-first-token-delay-ms': 100,
        'max-first-token-delay-ms': 400,
      },
      'quota-exceeded': {
        'antigravity-credits-force': true,
      },
      'enable-gemini-cli-endpoint': true,
      antigravity: {
        'sensitive-words': ['Hermes'],
        'connection-pool': { enabled: true, 'idle-conn-timeout': '30s' },
      },
      codex: { 'identity-confuse': true, 'orphan-delegation-compatibility': true },
      routing: { 'session-affinity-subagents': false },
    });
  });
});
