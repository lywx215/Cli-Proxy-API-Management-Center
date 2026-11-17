// Run after building, without changing the application's dependency lockfile:
// node tests/browser/geminiEnterpriseRenewal.cjs <management.html> <playwright-core path> <browser executable> [screenshot directory]
// All accounts and HTTP endpoints are synthetic; outbound browser traffic is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.argv[3]);
const html = fs.readFileSync(process.argv[2]);
const starts = [];
const statuses = new Map();
let newAccountDefault = 'fixture-new';
const applications = [
  { client_id: 'fixture-old', name: 'Old fixture app', client_secret_ready: true },
  { client_id: 'fixture-new', name: 'New fixture app', client_secret_ready: true },
  { client_id: 'fixture-third', name: 'Third fixture app', client_secret_ready: true },
];
const query = new URLSearchParams({
  reauthorize_name: 'legacy.json',
  reauthorize_auth_index: 'legacy-index',
  reauthorize_client_id: 'fixture-old',
});
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html);
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  const send = (value) => response.end(JSON.stringify(value));
  if (url.pathname === '/v8/management/config')
    return send({
      'config-version': 8,
      oauth: {
        providers: {
          'gemini-enterprise': {
            'client-id': 'fixture-old',
            'client-secret-env': 'FIXTURE_SECRET_OLD',
            'project-id': 'fixture-project',
            'engine-id': 'fixture-engine',
          },
        },
      },
    });
  if (url.pathname === '/v8/management/plugins') return send({ plugins: [] });
  if (url.pathname === '/v8/management/credentials') return send({ files: [] });
  if (url.pathname.endsWith('/oauth/capabilities'))
    return send({
      protocol_version: 1,
      provider: 'gemini-enterprise',
      client_id: 'fixture-old',
      client_secret_ready: true,
      import_supported: true,
      reauthorization_supported: true,
      required_scopes: [],
      initially_enabled: true,
      new_account_default_client_id: newAccountDefault,
      applications,
    });
  if (url.pathname === '/v8/management/oauth/auth-url') {
    const params = Object.fromEntries(url.searchParams);
    starts.push(params);
    const state = 'fixture-state-' + starts.length;
    statuses.set(state, 'wait');
    const renewal = url.searchParams.has('reauthorize_name');
    return send({
      status: 'ok',
      state,
      reauthorization: renewal,
      resource_inputs_supported: true,
      manual_callback_required: true,
      url:
        'https://accounts.google.com/o/oauth2/v2/auth?state=' +
        state +
        '&client_id=' +
        (renewal ? 'fixture-old' : params.application_client_id),
    });
  }
  if (url.pathname === '/v8/management/oauth/status') {
    const status = statuses.get(url.searchParams.get('state'));
    return send({ status, ...(status === 'error' ? { error: 'fixture consent denied' } : {}) });
  }
  if (url.pathname === '/v8/management/oauth/session')
    return send({ status: 'ok', cancelled: true });
  response.statusCode = 404;
  send({ error: 'Unknown fixture endpoint' });
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.argv[4],
      headless: true,
      args: ['--disable-background-networking', '--disable-sync', '--disable-features=Translate'],
    });
    async function scenario(name, run, renewal = true) {
      const context = await browser.newContext({ locale: 'en-US', reducedMotion: 'reduce' });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await page.route('**/*', (route) =>
          route
            .request()
            .url()
            .startsWith(origin + '/')
            ? route.continue()
            : route.abort()
        );
        await page.goto(origin + '/');
        await page.locator('input[type=password]').fill('fixture-management-key');
        await page.locator('input[type=password]').press('Enter');
        await page.getByRole('link', { name: 'OAuth Login', exact: true }).waitFor();
        await page.evaluate(
          (hash) => {
            location.hash = hash;
          },
          '/oauth' + (renewal ? '?' + query : '')
        );
        if (!renewal)
          await page
            .getByRole('button', { name: /gemini enterprise/i })
            .first()
            .click();
        const dialog = () => page.getByRole('dialog');
        const application = () =>
          page.getByRole('button', { name: 'OAuth application', exact: true });
        const start = async (expected) => {
          const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/oauth/auth-url')),
            dialog()
              .getByRole('button', { name: /^(Authorize with Google|Start over)$/ })
              .click(),
          ]);
          const data = await response.json();
          const actual = starts.at(-1);
          if (expected === 'renewal') {
            assert.equal(actual.reauthorize_name, 'legacy.json');
            assert.equal(actual.reauthorize_auth_index, 'legacy-index');
            assert.equal(actual.application_client_id, undefined);
            assert.equal(data.reauthorization, true);
          } else {
            assert.equal(actual.reauthorize_name, undefined);
            assert.equal(actual.reauthorize_auth_index, undefined);
            assert.equal(actual.application_client_id, expected);
            assert.equal(data.reauthorization, false);
          }
          await dialog()
            .getByRole('button', { name: 'Cancel authorization', exact: true })
            .waitFor();
          return data.state;
        };
        const succeed = async (state) => {
          statuses.set(state, 'ok');
          await dialog()
            .getByRole('button', { name: 'Log in another account', exact: true })
            .waitFor();
        };
        const reopen = async () => {
          await dialog().getByRole('button', { name: 'Close', exact: true }).click();
          await dialog().waitFor({ state: 'hidden' });
          await page
            .getByRole('button', { name: /gemini enterprise/i })
            .first()
            .click();
          await dialog().waitFor();
        };
        await run({ page, dialog, application, start, succeed, reopen });
        console.log('PASS ' + name);
      } finally {
        await context.close();
      }
    }

    await scenario('completed renewal -> another account uses new default', async (tools) => {
      await tools.succeed(await tools.start('renewal'));
      const count = starts.length;
      await tools
        .dialog()
        .getByRole('button', { name: 'Log in another account', exact: true })
        .click();
      await tools.application().waitFor();
      assert.match(await tools.application().textContent(), /New fixture app/);
      assert.equal(starts.length, count, 'Another account must first allow application selection');
      assert.equal(new URL(tools.page.url()).hash, '#/oauth');
      if (process.argv[5]) {
        await tools.page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {}))
          )
        );
        await tools.page.screenshot({
          path: path.join(process.argv[5], 'another-account-default.png'),
          fullPage: true,
        });
      }
      await tools.start('fixture-new');
    });
    await scenario('completed renewal -> close and reopen uses new default', async (tools) => {
      await tools.succeed(await tools.start('renewal'));
      await tools.reopen();
      await tools.application().waitFor();
      assert.match(await tools.application().textContent(), /New fixture app/);
      assert.equal(new URL(tools.page.url()).hash, '#/oauth');
      await tools.start('fixture-new');
    });
    await scenario(
      'pending renewal -> reopen -> denial -> retry keeps original target',
      async (tools) => {
        const state = await tools.start('renewal');
        await tools.reopen();
        statuses.set(state, 'error');
        await tools.dialog().getByText('fixture consent denied', { exact: false }).waitFor();
        await tools.start('renewal');
      }
    );
    await scenario(
      'third application stays selected while pending; next account uses new default',
      async (tools) => {
        await tools.application().click();
        await tools.page.getByRole('option', { name: 'Third fixture app', exact: true }).click();
        const state = await tools.start('fixture-third');
        await tools.reopen();
        await tools.dialog().locator('summary').filter({ hasText: 'Resource binding' }).click();
        assert.match(await tools.application().textContent(), /Third fixture app/);
        assert.equal(await tools.application().isDisabled(), true);
        await tools.succeed(state);
        await tools
          .dialog()
          .getByRole('button', { name: 'Log in another account', exact: true })
          .click();
        await tools.application().waitFor();
        assert.match(await tools.application().textContent(), /New fixture app/);
        await tools.start('fixture-new');
      },
      false
    );
    await scenario(
      'new account picks up a changed configured default after renewal',
      async (tools) => {
        await tools.succeed(await tools.start('renewal'));
        newAccountDefault = 'fixture-third';
        await tools.reopen();
        await tools.application().waitFor();
        assert.match(await tools.application().textContent(), /Third fixture app/);
        await tools.start('fixture-third');
        newAccountDefault = 'fixture-new';
      }
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
