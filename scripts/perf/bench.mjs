import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { chromium } = require('playwright');
const { tsImport } = require('tsx/esm/api');

const BASE = process.env.BASE;
const [NAME = 'bench', COUNT = '100'] = process.argv.slice(2);
const N = Number(COUNT);
const T = Number(process.env.T ?? 1_800_000);
const OUT = new URL(`./out/${NAME}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const IGNTP = new URL(
	'../../app/static/igntp/Romans_Greek_transcriptions/',
	import.meta.url
).pathname;
const FIRST = ['P46', '01', '02', '03', '04', '012', '33', '1739', '1881', '1', '6', '2006', '1909'];
// 81 and 2127 lack required metadata; 1834 imports as a duplicate.
const UNIMPORTABLE = ['81', '1834', '2127'];
const withVerse = readdirSync(IGNTP)
	.filter(file => readFileSync(IGNTP + file, 'utf8').includes('n="Rom.8.28"'))
	.map(file => file.replace(/^NT_GRC_|_Rom\.xml$/g, ''))
	.filter(witness => !UNIMPORTABLE.includes(witness))
	.sort();
const WITS = [...FIRST, ...withVerse.filter(witness => !FIRST.includes(witness))].slice(0, N);

const UNQUEUED = [
	...readFileSync(new URL('../../app/src/lib/db/api.ts', import.meta.url), 'utf8')
		.match(/unqueuedMethods = new Set<[^>]*>\(\[([^\]]*)\]/)[1]
		.matchAll(/'(\w+)'/g),
].map(match => match[1]);

const results = [];
const requests = [];
const writes = [];
const startup = [];
const initSteps = [];
const queue = [];
const typing = [];
const typePauseType = [];
const storage = {};
let phase = 'init';

function record(name, ms, extra = {}) {
	const queued = requests.filter(request => request.phase === name && request.exclusiveMs != null);
	const files = {};
	for (const write of writes.filter(write => write.phase === name))
		files[write.path] = (files[write.path] ?? 0) + 1;
	const workerMs = Math.round(queued.reduce((total, request) => total + request.exclusiveMs, 0));
	const writeCount = Object.values(files).reduce((total, count) => total + count, 0);
	results.push({ name, ms: Math.round(ms), ...extra, workerMs, writeCount, writes: files });
	const detail = Object.keys(extra).length ? JSON.stringify(extra) : '';
	console.log(
		`${name.padEnd(42)} ${(ms / 1000).toFixed(2).padStart(8)} s`,
		detail,
		`worker ${(workerMs / 1000).toFixed(2)} s, ${writeCount} writes`
	);
}

// Wraps onmessage rather than listening: microtask-only replies post before a later listener runs.
// Exclusive time assumes the DB worker runs queued requests one at a time.
const PATCH = `(() => {
	if (self.__p) return true;
	if (!self.onmessage) throw new Error('not ready');
	self.__p = 1;
	const file = self.location.pathname.split('/').pop();
	const worker = file.match(/^(.+?\\.worker)-/)?.[1] ?? file;
	const unqueued = new Set(${JSON.stringify(UNQUEUED)});
	const pending = new Map();
	const epoch = ms => Math.round((performance.timeOrigin + ms) * 10) / 10;
	self.__methods = () => [...pending.values()].map(([, method]) => method);
	if (worker === 'db.worker')
		new PerformanceObserver(list => {
			for (const entry of list.getEntries())
				if (entry.name === 'db-queue')
					console.log('[queue]', JSON.stringify({
						label: entry.detail.label,
						priority: entry.detail.priority,
						enqueuedAt: epoch(entry.detail.enqueuedAt),
						startedAt: epoch(entry.startTime),
						endedAt: epoch(entry.startTime + entry.duration),
					}));
		}).observe({ type: 'measure', buffered: true });
	let lastReply = 0;
	self.__inflight = 0;
	self.__last = performance.now();
	const onmessage = self.onmessage;
	self.onmessage = event => {
		const id = event.data?.id ?? event.data?.requestId;
		if (id != null) pending.set(id, [performance.now(), event.data?.method ?? event.data?.type]);
		self.__inflight = pending.size;
		return onmessage.call(self, event);
	};
	const post = self.postMessage.bind(self);
	self.postMessage = (message, ...rest) => {
		const id = message?.id ?? message?.requestId;
		const started = id == null ? null : pending.get(id);
		if (started) {
			const now = performance.now();
			const queued = worker === 'db.worker' && !unqueued.has(started[1]);
			const exclusiveMs = queued ? Math.round(now - Math.max(started[0], lastReply)) : null;
			if (queued) lastReply = now;
			console.log('[req]', JSON.stringify({ worker, method: started[1], ms: Math.round(now - started[0]), exclusiveMs, at: epoch(started[0]) }));
			pending.delete(id);
			self.__inflight = pending.size;
			self.__last = now;
		}
		return post(message, ...rest);
	};
	return true;
})()`;

// Resolves each handle's path when opened: atomic writes move the temp file before close resolves.
const WRITE_PATCH = `(() => {
	if (self.__w || !self.FileSystemFileHandle) return true;
	self.__w = 1;
	const root = navigator.storage.getDirectory();
	const log = (where, bytes) =>
		where.then(path => path && console.log('[write]', JSON.stringify({ path: path.join('/'), bytes })));
	const proto = FileSystemFileHandle.prototype;
	const openSync = proto.createSyncAccessHandle;
	if (openSync)
		proto.createSyncAccessHandle = async function (...args) {
			const where = root.then(directory => directory.resolve(this)).catch(() => null);
			const access = await openSync.apply(this, args);
			let wrote = false;
			const write = access.write;
			access.write = function (...writeArgs) {
				wrote = true;
				return write.apply(this, writeArgs);
			};
			const close = access.close;
			access.close = function () {
				if (wrote) log(where, this.getSize());
				wrote = false;
				return close.call(this);
			};
			return access;
		};
	const openWritable = proto.createWritable;
	if (openWritable)
		proto.createWritable = async function (...args) {
			const where = root.then(directory => directory.resolve(this)).catch(() => null);
			const writable = await openWritable.apply(this, args);
			let bytes = 0;
			const write = writable.write;
			writable.write = function (chunk) {
				bytes += chunk?.size ?? chunk?.byteLength ?? chunk?.length ?? 0;
				return write.call(this, chunk);
			};
			const close = writable.close;
			writable.close = async function () {
				await close.call(this);
				log(where, bytes);
			};
			return writable;
		};
	return true;
})()`;

const INDEX_DIRECTORY = 'apatosaurus/v1/index/';
const PROJECTS_DIRECTORY = 'apatosaurus/v1/projects/';

rmSync(`${OUT}profile`, { recursive: true, force: true });
// Incognito contexts keep OPFS in memory behind IPC, which is far slower than a real profile.
const context = await chromium.launchPersistentContext(`${OUT}profile`, {
	channel: 'chromium',
	args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'],
	viewport: { width: 1600, height: 1000 },
});
await context.addInitScript(() => localStorage.setItem('welcomeSkipped', 'true'));
await context.addInitScript(WRITE_PATCH);
// Times collation actions from the first click or select change after arming.
await context.addInitScript(() => {
	for (const type of ['click', 'input', 'change'])
		addEventListener(
			type,
			event => {
				if (!window.__armed) return;
				window.__armed = false;
				window.__actionStart = event.timeStamp;
			},
			true
		);
});
let page = context.pages()[0] ?? (await context.newPage());

const workers = new Set();
function watch(page) {
	page.on('worker', worker => {
		workers.add(worker);
		worker.on('close', () => workers.delete(worker));
		const patch = attempts =>
			worker
				.evaluate(WRITE_PATCH)
				.then(() => worker.evaluate(PATCH))
				.catch(() => attempts > 0 && setTimeout(() => patch(attempts - 1), 10));
		patch(500);
	});
	page.on('console', async message => {
		const text = message.text();
		if (/^\[local-db\] (worker|schema) .* completed/.test(text)) {
			const detail = await message
				.args()[1]
				?.jsonValue()
				.catch(() => null);
			const label = text.replace(/^\[local-db\] /, '').replace(/ completed.*$/, '');
			if (detail?.elapsedMs > 50) startup.push({ phase, label, ms: detail.elapsedMs });
			if (detail?.elapsedMs != null) initSteps.push({ phase, label, ms: detail.elapsedMs });
		} else if (text.startsWith('[req] '))
			requests.push({ phase, ...JSON.parse(text.slice(6)) });
		else if (text.startsWith('[queue] ')) queue.push({ ...JSON.parse(text.slice(8)), phase });
		else if (text.startsWith('[write] ')) {
			const write = JSON.parse(text.slice(8));
			const path = write.path.replace(/\.tmp-[^/]*$/, '');
			if (!path.startsWith(INDEX_DIRECTORY)) writes.push({ phase, ...write, path });
		} else if (message.type() === 'error') console.log('console error:', text.slice(0, 200));
	});
}
watch(page);

async function workerIdle(quietMs = 1500) {
	const started = performance.now();
	while (performance.now() - started < T) {
		let busy = false;
		let wait = 0;
		for (const worker of workers) {
			const state = await worker
				.evaluate('({ inflight: self.__inflight ?? 0, age: performance.now() - (self.__last ?? 0) })')
				.catch(() => null);
			if (!state) continue;
			if (state.inflight > 0) busy = true;
			wait = Math.max(wait, quietMs - state.age);
		}
		if (!busy && wait <= 0) return;
		await page.waitForTimeout(100);
	}
	throw new Error('Workers never went idle.');
}

let navigationStart = 0;
// Leaves the old page long enough for its DB worker to release OPFS handles.
async function hardGoto(url) {
	if (page.url() !== 'about:blank') {
		await page.goto('about:blank');
		await page.waitForTimeout(3000);
	}
	navigationStart = performance.now();
	await page.goto(url);
}

async function step(name, action, { idle = true, extra = () => ({}) } = {}) {
	phase = name;
	let started = performance.now();
	await action();
	if (navigationStart > started) started = navigationStart;
	const visible = performance.now() - started;
	if (!idle) return record(name, visible, extra());
	await workerIdle();
	record(name, visible, {
		settledMs: Math.round(performance.now() - started - 1500),
		...extra(),
	});
	phase = `after ${name}`;
}

async function heapMb() {
	const cdp = await context.newCDPSession(page);
	await cdp.send('HeapProfiler.collectGarbage');
	await cdp.send('Performance.enable');
	const { metrics } = await cdp.send('Performance.getMetrics');
	await cdp.detach();
	return Math.round(metrics.find(metric => metric.name === 'JSHeapUsedSize').value / 1e6);
}

async function storageUse() {
	const files = await page.evaluate(async () => {
		const files = [];
		async function walk(directory, prefix) {
			for await (const [name, handle] of directory.entries()) {
				if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`);
				else files.push([`${prefix}${name}`, (await handle.getFile()).size]);
			}
		}
		await walk(await navigator.storage.getDirectory(), '');
		return files;
	});
	const sum = filter => files.filter(([path]) => filter(path)).reduce((total, [, size]) => total + size, 0);
	return {
		totalBytes: sum(() => true),
		sqliteBytes: sum(path => path.startsWith(INDEX_DIRECTORY)),
		projectBytes: sum(path => path.startsWith(PROJECTS_DIRECTORY)),
	};
}

const mb = bytes => `${(bytes / 1e6).toFixed(1)} MB`;
const formatStorage = use =>
	`${mb(use.totalBytes)} (SQLite ${mb(use.sqliteBytes)}, project files ${mb(use.projectBytes)})`;

const transcriptionRows = () =>
	page.getByRole('list', { name: 'Transcriptions' }).getByRole('listitem');

const round = ms => Math.round(ms * 10) / 10;
const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? null;
};
const epochNow = () => page.evaluate(() => performance.timeOrigin + performance.now());
const isBackground = entry =>
	entry.priority ? entry.priority === 'background' : entry.label.endsWith('/section');

// Measures the union of time in which a wait interval overlaps a held interval.
function overlapMs(waits, holds) {
	const pieces = waits
		.flatMap(([from, to]) =>
			holds.map(([start, end]) => [Math.max(from, start), Math.min(to, end)])
		)
		.filter(([from, to]) => to > from)
		.sort((a, b) => a[0] - b[0]);
	let total = 0;
	let reached = -Infinity;
	for (const [from, to] of pieces) {
		total += Math.max(0, to - Math.max(from, reached));
		reached = Math.max(reached, to);
	}
	return round(total);
}

const waitBehindBackground = name =>
	overlapMs(
		queue
			.filter(entry => entry.phase === name && !isBackground(entry))
			.map(entry => [entry.enqueuedAt, entry.startedAt]),
		queue.filter(isBackground).map(entry => [entry.startedAt, entry.endedAt])
	);

const settledFrame = () =>
	page.evaluate(
		() =>
			new Promise(resolve =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() => resolve(performance.now() - window.__actionStart))
				)
			)
	);

async function action(name, act, changed) {
	await workerIdle();
	phase = name;
	const started = performance.now();
	await page.evaluate(() => (window.__armed = true));
	await act();
	await changed();
	const settledFrameMs = Math.round(await settledFrame());
	const visible = performance.now() - started;
	// Outlasts the collation autosave debounce so the action's save lands in this step.
	await page.waitForTimeout(1000);
	await workerIdle();
	record(name, visible, {
		settledMs: Math.round(performance.now() - started - 1500),
		settledFrameMs,
	});
	phase = `after ${name}`;
}

async function waitForWorkerMethod(method, timeout = 10_000) {
	const started = performance.now();
	while (performance.now() - started < timeout) {
		for (const worker of workers) {
			const methods = await worker.evaluate('self.__methods?.() ?? []').catch(() => []);
			if (methods.includes(method)) return true;
		}
		await page.waitForTimeout(20);
	}
	console.log(`no ${method} request seen within ${timeout} ms`);
	return false;
}

const TYPED = 'abcdefghijklmnopqrst';
const KEY_GAP_MS = 100;
const SAVE_METHOD = 'updateTranscriptionContent';

async function typeBurst() {
	for (const key of TYPED) {
		await page.keyboard.press(key);
		await page.waitForTimeout(KEY_GAP_MS);
	}
}

async function placeCursor(position) {
	const pages = page.locator('.ProseMirror .page');
	const count = await pages.count();
	const target = pages.nth(
		{ first: 0, middle: Math.floor(count / 2), last: count - 1 }[position]
	);
	await target.scrollIntoViewIfNeeded();
	await page.evaluate(
		() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	);
	const lines = target.locator('.line-content').filter({ hasText: /\S/ });
	await ((await lines.count()) ? lines : target.locator('.line-content')).first().click();
	await page.keyboard.press('End');
}

// Event Timing reports only events of 16 ms or more, so a key without entries counts as 0.
function keystrokeTimes(keys, events) {
	return keys.map((start, index) => {
		const end = keys[index + 1] ?? Infinity;
		const own = events.filter(event => event.startTime >= start && event.startTime < end);
		return round(
			own.reduce((total, event) => total + event.processingEnd - event.processingStart, 0)
		);
	});
}

const waitSaved = () =>
	page.waitForFunction(() => window.__unsaved === false, null, { timeout: T, polling: 50 });

try {
	console.log('witnesses', WITS.length, WITS.join(' '));
	let projectId;
	await step('create project', async () => {
		await hardGoto(`${BASE}/projects`);
		await page.getByPlaceholder('New project name').fill(`Bench ${N}`);
		await page.getByRole('button', { name: 'Create' }).click();
		await page.waitForURL(/\/projects\/[^/]+\/transcriptions$/);
		projectId = page.url().match(/projects\/([^/]+)\//)[1];
	});

	await hardGoto(`${BASE}/transcription/igntp?projectId=${projectId}`);
	await page.getByRole('heading', { name: 'Import Provided Transcriptions' }).waitFor();
	await workerIdle();
	for (const witness of WITS)
		await page.getByRole('checkbox', { name: `NT_GRC_${witness}_Rom.xml`, exact: true }).check();
	phase = 'import';
	const importStart = performance.now();
	await page.getByRole('button', { name: /Import Selected/ }).click();
	await page
		.getByText(new RegExp(`^Imported ${WITS.length}, skipped 0,\\s+failed 0`))
		.first()
		.waitFor({ state: 'attached', timeout: T });
	record('import', performance.now() - importStart);
	await workerIdle();
	storage.afterImport = await storageUse();
	console.log('heap after import', await heapMb(), 'MB; storage', formatStorage(storage.afterImport));

	await step('transcriptions page', async () => {
		await hardGoto(`${BASE}/projects/${projectId}/transcriptions`);
		await transcriptionRows().nth(WITS.length - 1).waitFor({ timeout: T });
	});
	await step('settings page', async () => {
		await hardGoto(`${BASE}/projects/${projectId}/settings`);
		await page.getByRole('heading', { name: 'Project Collation Settings' }).waitFor({ timeout: T });
	});
	await step('collations list (empty)', async () => {
		await hardGoto(`${BASE}/projects/${projectId}/collations`);
		await page.locator('a.btn-primary', { hasText: 'New Collation' }).waitFor({ timeout: T });
		await page.getByText('Loading collations...').waitFor({ state: 'hidden', timeout: T });
	});
	await step('setup: verses listed', async () => {
		await page.locator('a.btn-primary', { hasText: 'New Collation' }).click();
		await page.getByRole('heading', { name: 'Textual Scope' }).waitFor({ timeout: T });
		await page.getByText('Loading verses...').waitFor({ state: 'hidden', timeout: T });
	});
	const dismiss = page
		.getByRole('region', { name: 'Storage' })
		.getByRole('button', { name: 'Dismiss' })
		.filter({ visible: true });
	if (await dismiss.count()) await dismiss.first().click();

	await step('setup: pick Rom 8:28 → witnesses', async () => {
		await page.getByPlaceholder('Search by book, chapter, verse, or identifier').fill('8:28');
		await page
			.locator('section', { has: page.getByRole('heading', { name: 'Verse Selector' }) })
			.getByRole('button', { name: /Rom 8:28\b/ })
			.first()
			.click();
		await page.getByText('Loading witnesses...').waitFor({ timeout: 5000 }).catch(() => {});
		await page.getByText('Loading witnesses...').waitFor({ state: 'hidden', timeout: T });
		await page.locator('tbody tr').nth(WITS.length - 1).waitFor({ timeout: T });
	});
	const rows = page.locator('tbody tr');
	await rows.filter({ hasText: '20001' }).first().getByRole('radio').click();
	await page.getByRole('textbox', { name: /Segment name/ }).fill('Rom 8:28');
	await workerIdle();

	let collationUrl;
	await step(
		'proceed → alignment visible',
		async () => {
			await page.getByRole('button', { name: 'Proceed to Alignment' }).click();
			await page.getByRole('button', { name: 'Re-align', exact: true }).waitFor({ timeout: T });
		},
		{ idle: false }
	);
	await step('proceed → URL settled', async () => {
		await page.waitForURL(/\/collation\/[^/]+\/alignment$/, { timeout: T });
		collationUrl = page.url();
	});
	console.log('heap after alignment', await heapMb(), 'MB');

	await step('switch → readings', async () => {
		await page.getByRole('button', { name: 'Readings', exact: true }).click();
		await page.waitForURL(/\/readings$/);
		await page.locator('button[data-unit-id]').first().waitFor({ timeout: T });
	});
	await step('switch → stemma', async () => {
		await page.getByRole('button', { name: 'Stemma', exact: true }).click();
		await page.waitForURL(/\/stemma$/);
		await page.getByRole('group', { name: /Local stemma for unit/ }).waitFor({ timeout: T });
	});
	await step('switch → review', async () => {
		await page
			.getByRole('navigation', { name: 'Collation workflow steps' })
			.getByRole('link', { name: 'Review', exact: true })
			.click();
		await page.getByRole('heading', { name: 'Review', exact: true }).waitFor({ timeout: T });
	});
	await step('open existing collation (alignment)', async () => {
		await hardGoto(collationUrl);
		await page.getByRole('button', { name: 'Re-align', exact: true }).waitFor({ timeout: T });
	});
	await step('open existing collation (readings)', async () => {
		await hardGoto(collationUrl.replace(/alignment$/, 'readings'));
		await page.locator('button[data-unit-id]').first().waitFor({ timeout: T });
	});
	await step('open existing collation (stored phase)', async () => {
		await hardGoto(collationUrl.replace(/alignment$/, 'readings'));
		await page.locator('button[data-unit-id]').first().waitFor({ timeout: T });
	});
	await step('collations list (1)', async () => {
		await hardGoto(`${BASE}/projects/${projectId}/collations`);
		await page.getByText('Loading collations...').waitFor({ state: 'hidden', timeout: T });
		await page.getByText('Rom 8:28').first().waitFor({ timeout: T });
	});
	await step('settings page (with collation)', async () => {
		await hardGoto(`${BASE}/projects/${projectId}/settings`);
		await page.getByRole('heading', { name: 'Project Collation Settings' }).waitFor({ timeout: T });
	});

	for (const witness of ['01', '2006'].filter(witness => WITS.includes(witness))) {
		await hardGoto(`${BASE}/projects/${projectId}/transcriptions`);
		await transcriptionRows().nth(WITS.length - 1).waitFor({ timeout: T });
		await workerIdle();
		await step(`editor: open ${witness}`, async () => {
			await transcriptionRows()
				.filter({ has: page.locator('div.font-serif', { hasText: new RegExp(`Romans in ${witness}$`) }) })
				.getByRole('link', { name: 'Open' })
				.click();
			await page.locator('.ProseMirror').first().waitFor({ timeout: T });
		});
	}
	storage.end = await storageUse();
	console.log('heap at end', await heapMb(), 'MB; storage', formatStorage(storage.end));

	if (WITS.includes('2006')) {
		await page.evaluate(() => {
			window.__keys = [];
			window.__events = [];
			window.__longTasks = [];
			window.__savedAt = [];
			addEventListener('keydown', event => window.__keys.push(event.timeStamp), true);
			new PerformanceObserver(list => {
				for (const entry of list.getEntries())
					window.__events.push({
						name: entry.name,
						startTime: entry.startTime,
						duration: entry.duration,
						processingStart: entry.processingStart,
						processingEnd: entry.processingEnd,
					});
			}).observe({ type: 'event', durationThreshold: 16 });
			new PerformanceObserver(list => {
				for (const entry of list.getEntries())
					window.__longTasks.push({
						at: performance.timeOrigin + entry.startTime,
						ms: entry.duration,
					});
			}).observe({ type: 'longtask' });
		});
		const watchSaved = () =>
			page.evaluate(() => {
				if (window.__statusWatched) return;
				const status = [...document.querySelectorAll('span')].find(
					span => span.textContent === 'Unsaved local edits'
				);
				if (!status) throw new Error('No "Unsaved local edits" status.');
				window.__statusWatched = true;
				window.__unsaved = true;
				new MutationObserver(() => {
					const unsaved = status.textContent === 'Unsaved local edits';
					if (window.__unsaved && !unsaved)
						window.__savedAt.push(performance.timeOrigin + performance.now());
					window.__unsaved = unsaved;
				}).observe(status, { characterData: true, childList: true, subtree: true });
			});
		const savedAfter = async at =>
			(await page.evaluate(() => window.__savedAt)).find(savedAt => savedAt >= at) ?? null;

		for (const position of ['first', 'middle', 'last']) {
			await placeCursor(position);
			await workerIdle();
			phase = `typing: ${position}`;
			await page.evaluate(() => {
				window.__keys.length = 0;
				window.__events.length = 0;
			});
			await typeBurst();
			await page.waitForTimeout(300);
			const { keys, events } = await page.evaluate(() => ({
				keys: window.__keys,
				events: window.__events,
			}));
			const keyMs = keystrokeTimes(keys, events);
			typing.push({
				position,
				keyMs,
				p50: percentile(keyMs, 0.5),
				p95: percentile(keyMs, 0.95),
			});
			console.log(
				`typing: ${position.padEnd(34)} p50 ${percentile(keyMs, 0.5)} ms, p95 ${percentile(keyMs, 0.95)} ms`,
				JSON.stringify(keyMs)
			);
			await watchSaved();
			const name = `typing: autosave (${position})`;
			let savedAt = null;
			await step(
				name,
				async () => {
					await waitSaved();
					savedAt = await page.evaluate(() => window.__savedAt.at(-1));
				},
				{
					extra: () => {
						const save = requests.find(
							request => request.phase === name && request.method === SAVE_METHOD
						);
						return {
							saveToSavedMs: save && savedAt ? Math.round(savedAt - save.at) : null,
						};
					},
				}
			);
		}

		await placeCursor('middle');
		await workerIdle();
		await page.evaluate(() => (window.__longTasks.length = 0));
		const starts = [];
		for (let cycle = 1; cycle <= 3; cycle++) {
			phase = `type–pause–type ${cycle}`;
			starts.push(await epochNow());
			await typeBurst();
			await page.waitForTimeout(1500);
		}
		await waitSaved();
		await workerIdle();
		const end = await epochNow();
		const longTasks = await page.evaluate(() => window.__longTasks);
		const saves = requests.filter(
			request =>
				request.worker === 'db.worker' &&
				request.method === SAVE_METHOD &&
				request.at >= starts[0]
		);
		for (const [index, from] of starts.entries()) {
			const to = starts[index + 1] ?? end;
			const tasks = longTasks
				.filter(task => task.at >= from && task.at < to)
				.map(task => task.ms);
			const cycleSaves = saves.filter(save => save.at >= from && save.at < to);
			const first = cycleSaves[0];
			const nextSave = saves.find(
				save => first && save.at > first.at && !cycleSaves.includes(save)
			);
			const until = nextSave?.at ?? Infinity;
			const savedAt = first ? await savedAfter(first.at) : null;
			const cycle = {
				longestTaskMs: Math.round(Math.max(0, ...tasks)),
				totalBlockingMs: Math.round(
					tasks.reduce((total, ms) => total + Math.max(0, ms - 50), 0)
				),
				saveWorkerMs: Math.round(
					cycleSaves.reduce((total, save) => total + (save.exclusiveMs ?? 0), 0)
				),
				saveToSavedMs:
					savedAt != null && savedAt < until ? Math.round(savedAt - first.at) : null,
				requestsAfterSave: first
					? requests
							.filter(
								request =>
									request.worker === 'db.worker' &&
									request.at > first.at &&
									request.at < until
							)
							.sort((a, b) => a.at - b.at)
							.map(request => request.method)
					: [],
			};
			typePauseType.push(cycle);
			console.log(`type–pause–type ${index + 1}`.padEnd(42), JSON.stringify(cycle));
		}
	}

	phase = 'collation actions: open readings';
	await hardGoto(collationUrl.replace(/alignment$/, 'readings'));
	const units = page.locator('button[data-unit-id]');
	await units.first().waitFor({ timeout: T });
	await workerIdle();
	const readingGroups = page.locator('[role="group"][aria-label^="Reading "]');
	const readingLabels = () =>
		readingGroups.evaluateAll(groups =>
			groups.map(group => group.getAttribute('aria-label').slice(8))
		);
	let unit = 0;
	let mostReadings = 0;
	for (let index = 0; index < (await units.count()) && mostReadings < 3; index++) {
		await units.nth(index).click();
		await page.evaluate(
			() =>
				new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		);
		const count = await readingGroups.count();
		if (count > mostReadings) [unit, mostReadings] = [index, count];
	}
	await units.nth(unit === 0 ? 1 : 0).click();
	await action(
		'readings: select unit',
		() => units.nth(unit).click(),
		() => units.nth(unit).and(page.locator('[aria-pressed="true"]')).waitFor({ timeout: T })
	);
	const labels = await readingLabels();
	const typeSelect = page.locator(`select[aria-label="Reading type for reading ${labels[1]}"]`);
	await page
		.locator(`[role="group"][aria-label="Reading ${labels[1]}"]`)
		.click({ position: { x: 4, y: 4 } });
	const readingType = await typeSelect.evaluate(
		select =>
			[...select.options].find(
				option => option.value && !option.disabled && option.value !== select.value
			)?.value
	);
	await action(
		'readings: change reading type',
		() => typeSelect.selectOption(readingType),
		() =>
			page.waitForFunction(
				([label, value]) =>
					document.querySelector(`select[aria-label="Reading type for reading ${label}"]`)
						?.value === value,
				[labels[1], readingType]
			)
	);
	if (labels.length >= 3) {
		const details = page.locator('details').filter({
			has: page.locator(`summary[aria-label="More actions for reading ${labels[2]}"]`),
		});
		await details.locator('summary').click();
		const labelled = text =>
			details
				.locator('label', { has: page.getByText(text, { exact: true }) })
				.locator('select');
		await labelled('Attach as subreading of').selectOption({ index: 1 });
		await labelled('Subreading type').selectOption({ index: 1 });
		const attach = page.getByRole('button', { name: 'Attach', exact: true });
		await action(
			'readings: attach subreading',
			() => attach.click(),
			() => attach.waitFor({ state: 'hidden', timeout: T })
		);
		const elevate = page.getByRole('button', { name: 'Elevate to lemma' });
		await page
			.locator('details')
			.filter({
				has: page.getByRole('button', { name: 'Elevate to lemma', includeHidden: true }),
			})
			.first()
			.locator('summary')
			.click();
		await action(
			'readings: elevate lemma',
			() => elevate.click(),
			() => elevate.waitFor({ state: 'hidden', timeout: T })
		);
	} else
		console.log(`skipped attach and elevate: the busiest unit has ${labels.length} readings`);

	await page
		.getByRole('navigation', { name: 'Collation workflow steps' })
		.getByRole('link', { name: 'Alignment', exact: true })
		.click();
	await page.getByRole('button', { name: 'Re-align', exact: true }).waitFor({ timeout: T });
	await page.getByRole('radio', { name: 'Grid', exact: true }).check();
	await workerIdle();
	const headers = page.locator('thead th');
	const columns = await headers.count();
	const columnCount = count =>
		page.waitForFunction(
			count => document.querySelectorAll('thead th').length === count,
			count,
			{ timeout: T }
		);
	await headers.nth(1).click();
	await headers.nth(2).click({ modifiers: ['Shift'] });
	await action(
		'alignment: merge columns',
		() => page.getByRole('button', { name: 'Merge', exact: true }).click(),
		() => columnCount(columns - 1)
	);
	await headers.nth(1).click({ button: 'right' });
	await action(
		'alignment: split column',
		() => page.getByRole('button', { name: 'Split Unit' }).click(),
		() => columnCount(columns)
	);

	await page.goto('about:blank');
	await page.waitForTimeout(3000);
	const previousPage = page;
	page = await context.newPage();
	watch(page);
	const coldStart = 'cold start: new tab → transcriptions';
	await step(
		coldStart,
		async () => {
			navigationStart = performance.now();
			await page.goto(`${BASE}/projects/${projectId}/transcriptions`);
			await transcriptionRows()
				.nth(WITS.length - 1)
				.waitFor({ timeout: T });
		},
		{
			extra: () => ({
				init: Object.fromEntries(
					initSteps
						.filter(entry => entry.phase === coldStart)
						.map(entry => [entry.label, entry.ms])
				),
			}),
		}
	);
	await previousPage.close();

	const { FakeGoogleSignIn } = await tsImport(
		new URL('../../app/e2e/fake-google-sign-in.ts', import.meta.url).href,
		import.meta.url
	);
	await new FakeGoogleSignIn().install(context);
	await workerIdle();
	await step('sync: move into project location', async () => {
		await page
			.getByRole('region', { name: 'Storage', exact: true })
			.getByRole('button', { name: 'Sign in with Google Drive' })
			.click();
		const dialog = page.getByRole('dialog', { name: 'Back up projects' });
		await dialog.waitFor({ timeout: T });
		await dialog.getByRole('button', { name: 'Move', exact: true }).click();
		await dialog.waitFor({ state: 'hidden', timeout: T });
	});

	const idle = 'sync: idle 60 s';
	phase = idle;
	await page.waitForTimeout(60_000);
	await workerIdle();
	const background = queue.filter(entry => entry.phase === idle && isBackground(entry));
	const sectionMs = background.map(entry => entry.endedAt - entry.startedAt);
	record(idle, 60_000, {
		backgroundSections: background.length,
		longestBackgroundSectionMs: Math.round(Math.max(0, ...sectionMs)),
		totalBackgroundMs: Math.round(sectionMs.reduce((total, ms) => total + ms, 0)),
	});
	phase = `after ${idle}`;

	await hardGoto(`${BASE}/projects/${projectId}/settings`);
	await page.getByRole('heading', { name: 'Project Collation Settings' }).waitFor({ timeout: T });
	await workerIdle();
	const duringSync = 'sync: transcriptions page during sync';
	await step(
		duringSync,
		async () => {
			await page.evaluate(() => window.dispatchEvent(new Event('focus')));
			await waitForWorkerMethod('backupProject');
			navigationStart = performance.now();
			await page.evaluate(href => {
				const link = document.createElement('a');
				link.href = href;
				document.body.append(link);
				link.click();
				link.remove();
			}, `/projects/${projectId}/transcriptions`);
			await transcriptionRows()
				.nth(WITS.length - 1)
				.waitFor({ timeout: T });
		},
		{ extra: () => ({ waitBehindBackgroundMs: waitBehindBackground(duringSync) }) }
	);
} catch (error) {
	console.error('FAILED', error);
	await page.screenshot({ path: `${OUT}error.png` }).catch(() => {});
	process.exitCode = 1;
} finally {
	const slow = requests.filter(request => request.ms > 200);
	writeFileSync(
		`${OUT}results.json`,
		JSON.stringify(
			{
				N,
				WITS,
				results,
				storage,
				requests,
				writes,
				slow,
				startup,
				typing,
				typePauseType,
				queue,
				initSteps,
			},
			null,
			1
		)
	);
	console.log('\nworker startup steps over 50 ms:');
	for (const { phase, label, ms } of startup) console.log(`${phase.padEnd(40)} ${label.padEnd(30)} ${ms} ms`);
	const byPhase = new Map();
	for (const { phase, worker, method, ms, exclusiveMs } of slow) {
		const key = `${phase} :: ${worker === 'db.worker' ? '' : `${worker} `}${method}`;
		const total = byPhase.get(key) ?? { count: 0, ms: 0, max: 0, exclusive: 0 };
		byPhase.set(key, {
			count: total.count + 1,
			ms: total.ms + ms,
			max: Math.max(total.max, ms),
			exclusive: exclusiveMs == null ? null : total.exclusive + exclusiveMs,
		});
	}
	const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
	console.log('\nworker requests over 200 ms (total includes queue wait; exclusive does not):');
	for (const [key, { count, ms, max, exclusive }] of byPhase)
		console.log(
			`${key.padEnd(70)} n=${count} total=${seconds(ms)} max=${seconds(max)} exclusive=${exclusive == null ? 'unqueued' : seconds(exclusive)}`
		);
	console.log('\nunqueued DB worker requests (no exclusive time):');
	for (const { phase, method, ms } of requests.filter(
		request => request.worker === 'db.worker' && request.exclusiveMs == null
	))
		console.log(`${phase.padEnd(42)} ${method.padEnd(28)} ${ms} ms`);
	console.log('\nlongest DB queue sections:');
	for (const entry of [...queue]
		.sort((a, b) => b.endedAt - b.startedAt - (a.endedAt - a.startedAt))
		.slice(0, 10))
		console.log(
			`${entry.phase.padEnd(42)} ${entry.label.padEnd(36)} ${Math.round(entry.endedAt - entry.startedAt)} ms`
		);
	console.log('\nlongest DB queue waits (and what held the queue):');
	for (const entry of [...queue]
		.sort((a, b) => b.startedAt - b.enqueuedAt - (a.startedAt - a.enqueuedAt))
		.slice(0, 10)) {
		const holders = queue
			.filter(
				other =>
					other !== entry &&
					other.startedAt < entry.startedAt &&
					other.endedAt > entry.enqueuedAt
			)
			.map(other => other.label);
		console.log(
			`${entry.phase.padEnd(42)} ${entry.label.padEnd(36)} ${Math.round(entry.startedAt - entry.enqueuedAt)} ms behind ${[...new Set(holders)].join(', ')}`
		);
	}
	console.log('\nproject-file writes per step:');
	for (const { name, writes: files } of results)
		for (const [path, count] of Object.entries(files))
			console.log(`${name.padEnd(42)} ${String(count).padStart(4)} ${path.replace(PROJECTS_DIRECTORY, '')}`);
	await context.close();
}
