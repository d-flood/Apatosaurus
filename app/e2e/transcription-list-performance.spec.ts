import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const RUN_PERF = process.env.RUN_IGNTP_PERF === '1';
const LOCAL_DB_PREFIXES = ['apatosaurus-index-v', 'apatosaurus-local-v1'];
const LOCAL_DB_IDB_DATABASES = ['apatosaurus-index-v1-idb', 'apatosaurus-local-v1-idb'];
const LOCAL_DB_INDEX_DIRECTORY = 'apatosaurus/v1/index';

type TimingLog = {
	text: string;
	details: unknown[];
};

test.skip(!RUN_PERF, 'Set RUN_IGNTP_PERF=1 to run the IGNTP transcription list performance bench.');

test('transcription list metadata path stays fast with a large IGNTP transcription', async ({
	page,
}) => {
	test.setTimeout(60_000);
	const logs: TimingLog[] = [];
	page.on('console', async message => {
		const text = message.text();
		if (!text.includes('[local-db]') && !text.includes('[transcription-route]')) return;
		const entry: TimingLog = { text, details: [] };
		logs.push(entry);
		entry.details = await readConsoleDetails(message);
	});

	await resetBrowserLocalDb(page);
	const projectId = await createProject(page);
	await importVisibleIgntpCorpus(page, projectId);
	const transcriptionListPath = `/projects/${projectId}/transcriptions`;

	logs.length = 0;
	let startedAt = performance.now();
	await page.goto(transcriptionListPath);
	await waitForTranscriptionList(page);
	const coldLoadMs = performance.now() - startedAt;
	const coldRouteLogs = logs.splice(0);

	await page.goto('/');
	logs.length = 0;
	startedAt = performance.now();
	await page.goto(transcriptionListPath);
	await waitForTranscriptionList(page);
	const warmLoadMs = performance.now() - startedAt;
	const warmRouteLogs = logs.splice(0);

	logs.length = 0;
	startedAt = performance.now();
	await page.reload();
	await waitForTranscriptionList(page);
	const refreshLoadMs = performance.now() - startedAt;
	const coldWorkerLogs = logs.splice(0);

	console.info('IGNTP transcription list performance', {
		coldLoadMs,
		warmLoadMs,
		refreshLoadMs,
		coldRouteLogs,
		warmRouteLogs,
		coldWorkerLogs,
	});

	for (const routeLogs of [coldRouteLogs, warmRouteLogs, coldWorkerLogs]) {
		expect(routeLogs.some(log => log.text.includes('transcriptions.listSummaries'))).toBe(
			false
		);
	}
	expect(coldLoadMs).toBeLessThan(3_000);
	expect(warmLoadMs).toBeLessThan(3_000);
	expect(refreshLoadMs).toBeLessThan(3_000);
});

async function createProject(page: Page): Promise<string> {
	await page.goto('/projects');
	await page.getByPlaceholder('New project name').fill('Performance test');
	await page.getByRole('button', { name: 'Create' }).click();
	await page.waitForURL(/\/projects\/[^/]+\/transcriptions$/);
	return new URL(page.url()).pathname.split('/')[2];
}

async function importVisibleIgntpCorpus(page: Page, projectId: string): Promise<void> {
	await page.goto(`/transcription/igntp?projectId=${encodeURIComponent(projectId)}`);
	await expect(
		page.getByRole('heading', { name: 'Import Provided Transcriptions' })
	).toBeVisible();

	await page.getByRole('button', { name: 'Clear Group' }).click();
	await page.getByRole('searchbox', { name: 'Search provided transcriptions' }).fill('2006');
	await page.getByRole('button', { name: 'Select Visible' }).click();

	await page.getByRole('button', { name: /Import Selected/ }).click();
	await expect(page.getByRole('button', { name: 'Import Selected (0)' })).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByText('Imported 1, skipped 0, failed 0.').last()).toBeVisible();
}

async function waitForTranscriptionList(page: Page): Promise<void> {
	await expect(page.getByRole('heading', { name: 'Project Transcriptions' })).toBeVisible();
	await expect(page.getByText('Loading transcriptions...')).not.toBeVisible({ timeout: 60_000 });
	await page.waitForTimeout(100);
}

async function resetBrowserLocalDb(page: Page): Promise<void> {
	await page.goto('/');
	await page.evaluate(
		async ({ localDbPrefixes, idbDatabases, indexDirectory }) => {
			function deleteIndexedDb(name: string): Promise<void> {
				return new Promise(resolve => {
					const request = indexedDB.deleteDatabase(name);
					request.onsuccess = () => resolve();
					request.onerror = () => resolve();
					request.onblocked = () => resolve();
				});
			}

			localStorage.removeItem('apatosaurus:legacy-djazzkit-purged');

			const indexedDbWithDatabases = indexedDB as IDBFactory & {
				databases?: () => Promise<Array<{ name?: string }>>;
			};
			const names = new Set(idbDatabases);
			if (typeof indexedDbWithDatabases.databases === 'function') {
				for (const database of await indexedDbWithDatabases.databases()) {
					if (
						database.name &&
						localDbPrefixes.some(prefix => database.name!.startsWith(prefix))
					)
						names.add(database.name);
				}
			}
			await Promise.all([...names].map(name => deleteIndexedDb(name)));

			const root = await navigator.storage?.getDirectory?.();
			if (!root || typeof root.entries !== 'function') return;
			for await (const [name, handle] of root.entries()) {
				if (!localDbPrefixes.some(prefix => name.startsWith(prefix))) continue;
				await root
					.removeEntry(name, { recursive: handle.kind === 'directory' })
					.catch(() => undefined);
			}
			const indexDir = await getNestedDirectory(root, indexDirectory);
			if (indexDir && typeof indexDir.entries === 'function') {
				for await (const [name, handle] of indexDir.entries()) {
					if (!name.startsWith('apatosaurus-index-v')) continue;
					await indexDir
						.removeEntry(name, { recursive: handle.kind === 'directory' })
						.catch(() => undefined);
				}
			}

			async function getNestedDirectory(rootHandle: FileSystemDirectoryHandle, path: string) {
				let current = rootHandle;
				try {
					for (const segment of path.split('/').filter(Boolean)) {
						current = await current.getDirectoryHandle(segment, { create: false });
					}
					return current as FileSystemDirectoryHandle & {
						entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
					};
				} catch {
					return null;
				}
			}
		},
		{
			localDbPrefixes: LOCAL_DB_PREFIXES,
			idbDatabases: LOCAL_DB_IDB_DATABASES,
			indexDirectory: LOCAL_DB_INDEX_DIRECTORY,
		}
	);
}
async function readConsoleDetails(message: ConsoleMessage): Promise<unknown[]> {
	return Promise.all(
		message
			.args()
			.slice(1)
			.map(argument => argument.jsonValue().catch(() => null))
	);
}
