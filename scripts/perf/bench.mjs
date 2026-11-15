import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { chromium } = require('playwright');

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
			console.log('[req]', JSON.stringify({ worker, method: started[1], ms: Math.round(now - started[0]), exclusiveMs }));
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
const page = context.pages()[0] ?? (await context.newPage());

const workers = new Set();
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
		const detail = await message.args()[1]?.jsonValue().catch(() => null);
		const label = text.replace(/^\[local-db\] /, '').replace(/ completed.*$/, '');
		if (detail?.elapsedMs > 50) startup.push({ phase, label, ms: detail.elapsedMs });
	} else if (text.startsWith('[req] ')) requests.push({ phase, ...JSON.parse(text.slice(6)) });
	else if (text.startsWith('[write] ')) {
		const write = JSON.parse(text.slice(8));
		const path = write.path.replace(/\.tmp-[^/]*$/, '');
		if (!path.startsWith(INDEX_DIRECTORY)) writes.push({ phase, ...write, path });
	} else if (message.type() === 'error') console.log('console error:', text.slice(0, 200));
});

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

async function step(name, action, { idle = true } = {}) {
	phase = name;
	let started = performance.now();
	await action();
	if (navigationStart > started) started = navigationStart;
	const visible = performance.now() - started;
	if (!idle) return record(name, visible);
	await workerIdle();
	record(name, visible, { settledMs: Math.round(performance.now() - started - 1500) });
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
} catch (error) {
	console.error('FAILED', error);
	await page.screenshot({ path: `${OUT}error.png` }).catch(() => {});
	process.exitCode = 1;
} finally {
	const slow = requests.filter(request => request.ms > 200);
	writeFileSync(
		`${OUT}results.json`,
		JSON.stringify({ N, WITS, results, storage, requests, writes, slow, startup }, null, 1)
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
	console.log('\nproject-file writes per step:');
	for (const { name, writes: files } of results)
		for (const [path, count] of Object.entries(files))
			console.log(`${name.padEnd(42)} ${String(count).padStart(4)} ${path.replace(PROJECTS_DIRECTORY, '')}`);
	await context.close();
}
