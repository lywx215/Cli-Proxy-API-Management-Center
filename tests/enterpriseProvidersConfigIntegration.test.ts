import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';

describe('enterprise provider configuration coexistence', () => {
  for (const enabled of [true, false]) {
    test(`visual routing edits preserve daily balancing=${enabled} and enterprise OAuth`, () => {
      const source = `config-version: 8
server: {port: 8317}
routing:
  strategy: round-robin
  gemini-enterprise-quota-balancing: ${enabled}
  gemini-enterprise-quota-reserve: 0
oauth:
  providers:
    antigravity-enterprise:
      discovery-quota-project: fixture-project
    gemini-enterprise:
      client-id: fixture-client
`;
      const editor = runVisualConfig(source, [
        { routingStrategy: 'weighted-round-robin', routingSessionAffinity: true },
      ]);
      const latest = source
        .replace('gemini-enterprise-quota-reserve: 0', 'gemini-enterprise-quota-reserve: 10')
        .replace('fixture-project', 'latest-project');
      const output = parseYaml(editor.applyVisualChangesToYaml(latest));
      expect(output.routing).toEqual({
        strategy: 'weighted-round-robin',
        'session-affinity': true,
        'gemini-enterprise-quota-balancing': enabled,
        'gemini-enterprise-quota-reserve': 10,
      });
      expect(output.oauth.providers).toEqual({
        'antigravity-enterprise': { 'discovery-quota-project': 'latest-project' },
        'gemini-enterprise': { 'client-id': 'fixture-client' },
      });
    });
  }
});
