import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const RUN_PERF = process.env.RUN_IGNTP_PERF === '1';
const LOCAL_DB_PREFIX = 'apatosaurus-local-v1';
const LOCAL_DB_IDB_DATABASES = ['apatosaurus-local-v1-idb'];

type TimingLog = {
	text: string;
	details: unknown[];
};

test.skip(!RUN_PERF, 'Set RUN_IGNTP_PERF=1 to run the IGNTP transcription list performance bench.');

test('transcription list metadata path stays fast with imported IGNTP corpus', async ({ page }) => {
	const logs: TimingLog[] = [];
	page.on('console', async message => {
		const text = message.text();
		if (!text.includes('[local-db]') && !text.includes('[transcription-route]')) return;
		logs.push({ text, details: await readConsoleDetails(message) });
	});

	await resetBrowserLocalDb(page);
	await importVisibleIgntpCorpus(page);

	logs.length = 0;
	await page.goto('/transcription');
	await waitForTranscriptionList(page);
	const coldRouteLogs = logs.splice(0);

	await page.goto('/');
	logs.length = 0;
	await page.goto('/transcription');
	await waitForTranscriptionList(page);
	const warmRouteLogs = logs.splice(0);

	logs.length = 0;
	await page.reload();
	await waitForTranscriptionList(page);
	const coldWorkerLogs = logs.splice(0);

	const coldListMs = requireTiming(
		coldRouteLogs,
		'[local-db] transcriptions.listSummaries client completed'
	);
	const warmListMs = requireTiming(
		warmRouteLogs,
		'[local-db] transcriptions.listSummaries client completed'
	);
	const refreshListMs = requireTiming(
		coldWorkerLogs,
		'[local-db] transcriptions.listSummaries client completed'
	);

	console.info('IGNTP transcription list performance', {
		coldListMs,
		warmListMs,
		refreshListMs,
		coldRouteLogs,
		warmRouteLogs,
		coldWorkerLogs,
	});

	expect(coldListMs).toBeLessThan(1000);
	expect(warmListMs).toBeLessThan(1000);
	expect(refreshListMs).toBeLessThan(1000);
});

async function importVisibleIgntpCorpus(page: Page): Promise<void> {
	await page.goto('/transcription/igntp');
	await expect(
		page.getByRole('heading', { name: 'Import Provided Transcriptions' })
	).toBeVisible();

	for (const button of await page.getByRole('button', { name: 'Select Visible' }).all()) {
		await button.click();
	}

	await page.getByRole('button', { name: /Import Selected/ }).click();
	await expect(page.getByText(/Imported \d+, skipped \d+, failed \d+\./)).toBeVisible({
		timeout: 120_000,
	});
}

async function waitForTranscriptionList(page: Page): Promise<void> {
	await expect(page.getByRole('heading', { name: 'External Folder Sync' })).toBeVisible();
	await expect(page.getByText('Loading transcriptions...')).not.toBeVisible({ timeout: 60_000 });
}

async function resetBrowserLocalDb(page: Page): Promise<void> {
	await page.goto('/');
	await page.evaluate(
		async ({ localDbPrefix, idbDatabases }) => {
			localStorage.removeItem('apatosaurus:legacy-djazzkit-purged');

			const indexedDbWithDatabases = indexedDB as IDBFactory & {
				databases?: () => Promise<Array<{ name?: string }>>;
			};
			const names = new Set(idbDatabases);
			if (typeof indexedDbWithDatabases.databases === 'function') {
				for (const database of await indexedDbWithDatabases.databases()) {
					if (database.name?.startsWith(localDbPrefix)) names.add(database.name);
				}
			}
			await Promise.all([...names].map(name => deleteIndexedDb(name)));

			const root = await navigator.storage?.getDirectory?.();
			if (!root || typeof root.entries !== 'function') return;
			for await (const [name, handle] of root.entries()) {
				if (!name.startsWith(localDbPrefix)) continue;
				await root
					.removeEntry(name, { recursive: handle.kind === 'directory' })
					.catch(() => undefined);
			}
		},
		{ localDbPrefix: LOCAL_DB_PREFIX, idbDatabases: LOCAL_DB_IDB_DATABASES }
	);
}

function deleteIndexedDb(name: string): Promise<void> {
	return new Promise(resolve => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}

async function readConsoleDetails(message: ConsoleMessage): Promise<unknown[]> {
	return Promise.all(
		message
			.args()
			.slice(1)
			.map(argument => argument.jsonValue().catch(() => null))
	);
}

function requireTiming(logs: TimingLog[], text: string): number {
	const log = logs.find(entry => entry.text.includes(text));
	const details = log?.details[0];
	if (!details || typeof details !== 'object' || !('elapsedMs' in details)) {
		throw new Error(`Missing timing log: ${text}`);
	}
	return Number(details.elapsedMs);
}
