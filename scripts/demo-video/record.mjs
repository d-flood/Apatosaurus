import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seed, configureSettings } from './seed.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4392';
const DEBUG = process.env.DEBUG === '1';
const TAKE = new URL(`./takes/${process.env.TAKE ?? Date.now().toString(36)}/`, import.meta.url)
	.pathname;
mkdirSync(`${TAKE}frames`, { recursive: true });
const W = 1920;
const H = 1080;

const browser = await chromium.launch({
	channel: 'chromium',
	args: [
		'--enable-gpu',
		'--ignore-gpu-blocklist',
		'--use-angle=vulkan',
		'--enable-features=Vulkan',
	],
});
const context = await browser.newContext({
	viewport: { width: W, height: H },
	acceptDownloads: true,
	storageState: {
		cookies: [],
		origins: [{ origin: BASE, localStorage: [{ name: 'welcomeSkipped', value: 'true' }] }],
	},
});
const page = await context.newPage();
page.on('console', m => m.type() === 'error' && console.log('console:', m.text().slice(0, 160)));

const t0 = performance.now();
const now = () => performance.now() - t0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const events = [];
const marks = [];
const frames = [];
let cursor = { x: W / 2, y: H / 2 };
let shotN = 0;

function mark(name) {
	marks.push({ name, t: now() });
	console.log(`mark ${name} @ ${(now() / 1000).toFixed(2)}s`);
}

async function debugShot(name) {
	if (!DEBUG) return;
	shotN += 1;
	await page.screenshot({ path: `${TAKE}debug-${String(shotN).padStart(2, '0')}-${name}.png` });
}

const ease = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

async function moveTo(x, y, ms) {
	const dist = Math.hypot(x - cursor.x, y - cursor.y);
	const duration = ms ?? Math.min(1100, Math.max(380, 280 + dist * 0.55));
	const steps = Math.max(6, Math.round(duration / 16));
	const sx = cursor.x;
	const sy = cursor.y;
	for (let i = 1; i <= steps; i++) {
		const p = ease(i / steps);
		const px = sx + (x - sx) * p;
		const py = sy + (y - sy) * p;
		await page.mouse.move(px, py);
		events.push({ t: now(), type: 'move', x: px, y: py });
		await sleep(16);
	}
	cursor = { x, y };
}

async function centerOf(locator, { offsetX = 0.5, offsetY = 0.5 } = {}) {
	await locator.waitFor({ state: 'visible', timeout: 60_000 });
	const box = await locator.boundingBox();
	if (!box) throw new Error(`No box for ${locator}`);
	const x = box.x + box.width * offsetX;
	const y = box.y + box.height * offsetY;
	if (x < 4 || y < 4 || x > W - 4 || y > H - 4)
		throw new Error(`Target outside viewport (${x.toFixed(0)},${y.toFixed(0)}): ${locator}`);
	return { x, y };
}

async function assertHit(locator, x, y) {
	const ok = await locator.evaluate(
		(el, p) => {
			const hit = document.elementFromPoint(p.x, p.y);
			if (!hit) return false;
			if (el === hit || el.contains(hit)) return true;
			const labels = el.labels ? [...el.labels] : [];
			return labels.some(l => l === hit || l.contains(hit));
		},
		{ x, y }
	);
	if (!ok) {
		const hit = await page.evaluate(
			p => document.elementFromPoint(p.x, p.y)?.outerHTML.slice(0, 160),
			{ x, y }
		);
		throw new Error(
			`Click at (${x.toFixed(0)},${y.toFixed(0)}) would hit ${hit} instead of ${locator}`
		);
	}
}

async function hover(locator, opts) {
	const { x, y } = await centerOf(locator, opts);
	await moveTo(x, y);
}

async function click(locator, { fake = false, ...opts } = {}) {
	const { x, y } = await centerOf(locator, opts);
	await moveTo(x, y);
	await sleep(150);
	await assertHit(locator, x, y);
	events.push({ t: now(), type: 'down', x, y });
	if (!fake) await page.mouse.down();
	await sleep(70);
	events.push({ t: now(), type: 'up', x, y });
	if (!fake) await page.mouse.up();
}

async function choose(select, pick) {
	await click(select, { fake: true });
	await sleep(350);
	const value = await select.evaluate((el, src) => {
		const re = new RegExp(src);
		const option = [...el.options].find(o => re.test(o.textContent.trim()) || re.test(o.value));
		return option?.value ?? null;
	}, pick.source);
	if (value === null) throw new Error(`No option ${pick} in ${select}`);
	await select.selectOption(value);
}

async function type(text) {
	for (const ch of text) {
		await page.keyboard.type(ch);
		await sleep(85);
	}
}

async function wheelUntilVisible(locator, x, y, { top = 260, bottom = H - 60 } = {}) {
	await moveTo(x, y);
	for (let i = 0; i < 40; i++) {
		const box = await locator.boundingBox();
		if (box && box.y >= top && box.y + box.height <= bottom) return;
		const dy = !box || box.y + box.height > bottom ? 90 : -90;
		await page.mouse.wheel(0, dy);
		await sleep(45);
	}
	throw new Error(`Could not wheel ${locator} into view`);
}

async function drag(from, to) {
	const a = await centerOf(from);
	const b = await centerOf(to);
	await moveTo(a.x, a.y);
	await sleep(200);
	await assertHit(from, a.x, a.y);
	events.push({ t: now(), type: 'down', x: a.x, y: a.y });
	await page.mouse.down();
	await sleep(120);
	const steps = 40;
	for (let i = 1; i <= steps; i++) {
		const p = ease(i / steps);
		const px = a.x + (b.x - a.x) * p;
		const py = a.y + (b.y - a.y) * p;
		await page.mouse.move(px, py);
		events.push({ t: now(), type: 'move', x: px, y: py, drag: true });
		await sleep(18);
	}
	cursor = b;
	await sleep(200);
	events.push({ t: now(), type: 'up', x: b.x, y: b.y });
	await page.mouse.up();
}

try {
	const projectId = await seed(page, BASE);
	await configureSettings(page, BASE, projectId);
	await page.getByRole('link', { name: 'Collations', exact: true }).first().click();
	const newCollation = page.locator('a.btn-primary', { hasText: 'New Collation' });
	await newCollation.click({ timeout: 60_000 });
	await page.getByRole('heading', { name: 'Textual Scope' }).waitFor();
	await page.getByText('Loading verses...').waitFor({ state: 'hidden', timeout: 60_000 });
	const dismiss = page
		.getByRole('region', { name: 'Storage' })
		.getByRole('button', { name: 'Dismiss' })
		.filter({ visible: true });
	if (await dismiss.count()) await dismiss.first().click();
	for (const d of ['Movable nu'])
		if ((await page.getByText(d, { exact: true }).count()) === 0)
			throw new Error(`Rule missing in setup: ${d}`);
	await page.evaluate(() => {
		for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0;
		window.scrollTo(0, 0);
	});
	await page.mouse.move(cursor.x, cursor.y);
	await sleep(2500);
	await debugShot('pre');

	await page.screencast.start({
		size: { width: W, height: H },
		quality: 90,
		onFrame: ({ data }) => {
			const i = frames.length;
			writeFileSync(`${TAKE}frames/${String(i).padStart(5, '0')}.jpg`, data);
			frames.push({ i, t: now() });
		},
	});
	mark('start');
	await sleep(1500);

	mark('setup-loaded');
	const filter = page.getByPlaceholder('Search by book, chapter, verse, or identifier');
	await click(filter);
	await type('8:28');
	await sleep(500);
	const verse = page
		.locator('section', { has: page.getByRole('heading', { name: 'Verse Selector' }) })
		.getByRole('button', { name: /Rom 8:28\b/ })
		.first();
	mark('pick-verse');
	await click(verse);
	await page.getByText('Loading witnesses...').waitFor({ state: 'hidden', timeout: 180_000 });
	await page.locator('tbody tr').nth(12).waitFor();
	mark('witnesses-loaded');
	await sleep(1800);
	await debugShot('witnesses');

	const rows = page.locator('tbody tr');
	mark('exclude-correctors');
	for (const name of ['31881 corrector', '20003 corrector2']) {
		const eye = rows.filter({ hasText: name }).getByTitle('Exclude witness');
		await wheelUntilVisible(eye, 1480, 700, { top: 400, bottom: 960 });
		await click(eye);
		await sleep(600);
	}
	await sleep(500);
	mark('pick-base');
	const baseRadio = rows.filter({ hasText: '20001' }).first().getByRole('radio');
	await wheelUntilVisible(baseRadio, 1480, 700, { top: 400, bottom: 960 });
	await click(baseRadio);
	await sleep(1000);
	const segmentName = page.getByRole('textbox', { name: /Segment name/ });
	mark('name-segment');
	await wheelUntilVisible(segmentName, 740, 600, { top: 300, bottom: 1000 });
	await click(segmentName);
	await type('Rom 8:28');
	await sleep(700);
	await debugShot('named');
	mark('settings');
	const punct = page.locator('label', { hasText: 'Ignore punctuation in alignment' });
	await wheelUntilVisible(page.getByText('Movable nu', { exact: true }), 210, 760, {
		top: 300,
		bottom: 1050,
	});
	await centerOf(punct);
	await sleep(900);
	await click(punct.getByRole('checkbox'));
	await page.getByText('Loading witnesses...').waitFor({ state: 'hidden', timeout: 180_000 });
	await sleep(1600);
	await debugShot('settings');
	const proceed = page.getByRole('button', { name: 'Proceed to Alignment' });
	mark('proceed');
	await click(proceed);

	await page.waitForURL(/\/alignment$/, { timeout: 120_000 });
	await page.getByRole('button', { name: 'Re-align', exact: true }).waitFor({ timeout: 120_000 });
	mark('alignment');
	await sleep(1500);
	const otheos = page.locator('tbody td').filter({ hasText: 'θς' }).first();
	await hover(otheos);
	mark('alignment-otheos');
	await sleep(2200);
	await debugShot('alignment');
	mark('vu-view');
	await click(page.getByRole('radio', { name: 'Variation Units', exact: true }));
	await sleep(2600);
	await debugShot('vu');

	mark('to-readings');
	await click(page.getByRole('button', { name: 'Readings', exact: true }));
	await page.waitForURL(/\/readings$/);
	const units = page.locator('button[data-unit-id]');
	await units.first().waitFor();
	mark('readings');
	await sleep(1000);
	await click(units.filter({ hasText: 'οιδαμεν' }).first());
	await sleep(1500);
	const readingC = page.locator('summary[aria-label="More actions for reading b"]');
	mark('attach-open');
	await click(readingC);
	await sleep(700);
	const menu = page.locator('details[open] .dropdown-content');
	await choose(
		menu.locator('label', { hasText: 'Attach as subreading of' }).locator('select'),
		/^a: /
	);
	await sleep(500);
	await choose(
		menu
			.locator('label')
			.filter({ hasText: /^Subreading type/ })
			.locator('select'),
		/^orthographic$/
	);
	await sleep(500);
	mark('attach');
	await click(menu.getByRole('button', { name: 'Attach', exact: true }));
	await sleep(400);
	await page.keyboard.press('Escape');
	if (await page.locator('details[open]').count())
		await page
			.locator('details[open] > summary')
			.first()
			.evaluate(el => el.click());
	mark('attached');
	await sleep(2200);
	await debugShot('attached');
	mark('otheos-unit');
	await click(units.filter({ hasText: /om\./ }).filter({ hasText: '21' }).first());
	await sleep(2600);
	await debugShot('otheos');

	mark('to-stemma');
	await click(page.getByRole('button', { name: 'Stemma', exact: true }));
	await page.waitForURL(/\/stemma$/);
	const diagram = page.getByRole('group', { name: /Local stemma for unit/ });
	await diagram.waitFor({ timeout: 90_000 });
	mark('stemma');
	await sleep(1200);
	const vu = n => page.locator('button', { hasText: new RegExp(`^\\s*VU ${n}\\b`) }).first();
	const node = label =>
		diagram.getByRole('button', { name: new RegExp(`^${label}[ :(]`) }).first();
	for (const [range, child] of [
		[5, 'b'],
		[2, 'b'],
		[4, 'b'],
	]) {
		mark(`stemma-${range}`);
		await click(vu(range));
		await sleep(900);
		await drag(node(child), node('a'));
		await page
			.getByTestId('stemma-announcer')
			.filter({ hasText: 'now derives from' })
			.waitFor({ timeout: 10_000 });
		await sleep(1400);
		await debugShot(`stemma-${range}`);
	}

	mark('to-review');
	await click(
		page
			.getByRole('navigation', { name: 'Collation workflow steps' })
			.getByRole('link', { name: 'Review', exact: true })
	);
	await page.getByRole('heading', { name: 'Review', exact: true }).waitFor();
	mark('review');
	await sleep(3200);
	await debugShot('review');
	mark('scroll-stemmata');
	const stemmata = page.getByRole('heading', { name: 'Local stemmata' });
	await wheelUntilVisible(stemmata, 960, 700, { top: 240, bottom: 330 });
	mark('stemmata');
	await sleep(1500);
	await hover(page.getByText('Unit 21', { exact: true }).first());
	mark('stemmata-hover');
	await sleep(3500);
	await debugShot('stemmata');
	mark('end');
	await sleep(800);
	await page.screencast.stop();
	writeFileSync(`${TAKE}timeline.json`, JSON.stringify({ frames, events, marks }, null, 1));
	console.log('TAKE', TAKE, 'frames', frames.length);
} catch (err) {
	console.error('FAILED', err);
	await page.screenshot({ path: `${TAKE}error.png` }).catch(() => {});
	writeFileSync(
		`${TAKE}timeline.json`,
		JSON.stringify({ frames, events, marks, failed: String(err) }, null, 1)
	);
	process.exitCode = 1;
} finally {
	await browser.close();
}
