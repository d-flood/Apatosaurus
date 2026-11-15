import { createRequire } from 'node:module';

const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.env.BASE;
const [PROFILE] = process.argv.slice(2);
if (!PROFILE) throw new Error('Usage: ./serve.sh <port of the profile> node rebuild.mjs <profile>');

const context = await chromium.launchPersistentContext(PROFILE, {
	channel: 'chromium',
	args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'],
	viewport: { width: 1280, height: 800 },
});
const page = context.pages()[0] ?? (await context.newPage());
page.on('console', message => {
	if (message.type() === 'error') console.log('console error:', message.text().slice(0, 200));
});

try {
	const started = performance.now();
	await page.goto(`${BASE}/projects`);
	const card = page.getByRole('status').filter({ hasText: 'Rebuilding local index' });
	await card.waitFor({ timeout: 120_000 });
	console.log('progress shown after', Math.round(performance.now() - started), 'ms');
	await page.screenshot({ path: new URL('./out/rebuild-desktop.png', import.meta.url).pathname });
	await card.waitFor({ state: 'hidden', timeout: 3_600_000 });
	console.log('rebuild finished after', Math.round(performance.now() - started), 'ms');
} finally {
	await context.close();
}
