import {
	expect,
	test,
	type Browser,
	type BrowserContext,
	type Page,
	type Route,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TEI_FIXTURE_PATH = fileURLToPath(
	new URL('../src/lib/tei/NT_GRC_P118_Rom.xml', import.meta.url)
);
const UPGRADE_FIXTURE_PATH = fileURLToPath(
	new URL('./fixtures/upgrade-store/project.json', import.meta.url)
);
const UPGRADE_PROJECT_FOLDER = 'upgrade-fixture-22222222';
const PROJECT_NAME = 'End-to-End Romans';
const TRANSCRIPTION_TITLES = ['Witness Alpha', 'Witness Beta'] as const;

test.setTimeout(180_000);

test('fresh user creates, commits, collates, and exports a project', async ({ page }, testInfo) => {
	const archivePath = await createCompleteProjectAndExport(
		page,
		testInfo.outputPath('fresh-project.zip')
	);
	const entries = readStoredZipEntries(new Uint8Array(await readFile(archivePath)));

	expect(entries.has('project.json')).toBe(true);
	expect(
		[...entries.keys()].filter(path => /^transcriptions\/[^/]+\.json$/.test(path))
	).toHaveLength(2);
	expect([...entries.keys()].filter(path => /^collations\/[^/]+\.json$/.test(path))).toHaveLength(
		1
	);
	expect([...entries.keys()].some(path => path.startsWith('history/transcriptions/'))).toBe(true);
	expect([...entries.keys()].some(path => path.startsWith('history/collations/'))).toBe(true);
});

test('disaster recovery restores an equivalent project after site data is wiped', async ({
	context,
	page,
}, testInfo) => {
	const archivePath = await createCompleteProjectAndExport(
		page,
		testInfo.outputPath('disaster-recovery.zip')
	);

	await wipeSiteData(context, page);
	await page.goto('/projects');
	await importProjectArchive(page, archivePath);
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();
	await selectProject(page, PROJECT_NAME);

	for (const title of TRANSCRIPTION_TITLES) {
		await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
	}
	await page.locator('.tabs').getByRole('link', { name: 'Collations' }).click();
	await expect(page.getByText(/Collation Rom 15:/).first()).toBeVisible();

	await page.locator('.tabs').getByRole('link', { name: 'Transcriptions' }).click();
	const alphaRow = page.getByRole('listitem').filter({ hasText: TRANSCRIPTION_TITLES[0] });
	await alphaRow.getByRole('link', { name: 'Open' }).click();
	await expect(
		page.locator('.line-content').filter({ hasText: 'alpha-e2e' }).first()
	).toBeVisible();
});

test('committee contexts propagate updates and preserve divergent commits as conflict copies', async ({
	browser,
}, testInfo) => {
	const sharedFolder = new SharedFolderServer();
	const contextA = await createCommitteeContext(browser, sharedFolder);
	const contextB = await createCommitteeContext(browser, sharedFolder);
	const pageA = await contextA.newPage();
	const pageB = await contextB.newPage();
	try {
		await createProject(pageA, 'Committee Romans');
		await createAndCommitTeiTranscription(
			pageA,
			'Committee Romans',
			'Committee Witness',
			'COM',
			'committee-initial'
		);
		const archivePath = testInfo.outputPath('committee-project.zip');
		await exportProject(pageA, 'Committee Romans', archivePath);

		await pageB.goto('/projects');
		await importProjectArchive(pageB, archivePath);
		await pageB.reload();
		await connectSyncFolder(pageA, 'Committee Romans');
		await connectSyncFolder(pageB, 'Committee Romans');
		await syncNow(pageA);
		await syncNow(pageB);

		await openTranscription(pageA, 'Committee Romans', 'Committee Witness');
		await editAndCommitOpenTranscription(pageA, 'update-from-a', 'Committee update from A');
		await pageA.goto('/projects');
		await selectProject(pageA, 'Committee Romans');
		await pageA.getByRole('link', { name: 'Backup and Sync' }).click();
		await syncNow(pageA);
		await pageB.goto('/projects');
		await selectProject(pageB, 'Committee Romans');
		await pageB.getByRole('link', { name: 'Backup and Sync' }).click();
		await syncNow(pageB);
		await openTranscription(pageB, 'Committee Romans', 'Committee Witness');
		await expect(
			pageB.locator('.line-content').filter({ hasText: 'update-from-a' }).first()
		).toBeVisible();

		sharedFolder.setAvailable(false);
		await openTranscription(pageA, 'Committee Romans', 'Committee Witness');
		await editAndCommitOpenTranscription(pageA, 'divergent-a', 'Divergent A commit');
		await editAndCommitOpenTranscription(pageB, 'divergent-b', 'Divergent B commit');
		sharedFolder.setAvailable(true);

		await pageA.goto('/projects');
		await selectProject(pageA, 'Committee Romans');
		await pageA.getByRole('link', { name: 'Backup and Sync' }).click();
		await syncNow(pageA);
		await pageB.goto('/projects');
		await selectProject(pageB, 'Committee Romans');
		await pageB.getByRole('link', { name: 'Backup and Sync' }).click();
		await syncNow(pageB);
		await pageB.goto('/projects');
		await selectProject(pageB, 'Committee Romans');
		await expect(pageB.getByText(/Committee Witness \(Conflicted Copy/).first()).toBeVisible();
		await syncNow(pageA);

		for (const page of [pageA]) {
			await page.goto('/projects');
			await selectProject(page, 'Committee Romans');
			await expect(
				page.getByText(/Committee Witness \(Conflicted Copy/).first()
			).toBeVisible();
		}
	} finally {
		await contextA.close();
		await contextB.close();
	}
});

test('upgrade fixture migrates on save and rebuilds after an index version bump', async ({
	page,
}, testInfo) => {
	const fixture = await readFile(UPGRADE_FIXTURE_PATH, 'utf8');
	await seedUpgradeStore(page, fixture);

	await page.goto('/projects');
	await selectProject(page, 'Upgrade Fixture');

	await page.getByRole('link', { name: 'Settings' }).click();
	await page
		.getByPlaceholder('Add a description for this project.')
		.fill('Synthetic v1 fixture saved as v2');
	await page.getByRole('button', { name: 'Save Details' }).click();
	await expect(page.getByRole('button', { name: 'Save Details' })).toBeDisabled();

	await page.getByRole('link', { name: 'Backup and Sync' }).click();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export project zip' }).click();
	const download = await downloadPromise;
	const archivePath = testInfo.outputPath('upgraded-project.zip');
	await download.saveAs(archivePath);

	const entries = readStoredZipEntries(new Uint8Array(await readFile(archivePath)));
	const manifest = JSON.parse(entries.get('project.json') ?? '{}') as {
		schema_version?: number;
		description?: string;
		forked_from?: unknown;
	};
	expect(manifest).toMatchObject({
		schema_version: 2,
		description: 'Synthetic v1 fixture saved as v2',
		forked_from: null,
	});
	await expect.poll(() => staleSyntheticIndexExists(page)).toBe(false);
});

async function seedUpgradeStore(page: Page, fixture: string): Promise<void> {
	await page.route('**/__e2e-fixture-bootstrap', route =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Fixture bootstrap</title>',
		})
	);
	await page.goto('/__e2e-fixture-bootstrap');
	await page.evaluate(
		async ({ projectFolder, projectManifest }) => {
			const root = await navigator.storage.getDirectory();
			await writeFile(
				root,
				`apatosaurus/v1/projects/${projectFolder}/project.json`,
				projectManifest
			);
			await writeFile(
				root,
				'apatosaurus/v1/index/apatosaurus-index-v0.db',
				'synthetic old index; current app must rebuild from project files'
			);

			async function writeFile(
				rootHandle: FileSystemDirectoryHandle,
				path: string,
				content: string
			) {
				const segments = path.split('/');
				const fileName = segments.pop()!;
				let directory = rootHandle;
				for (const segment of segments) {
					directory = await directory.getDirectoryHandle(segment, { create: true });
				}
				const file = await directory.getFileHandle(fileName, { create: true });
				const writable = await file.createWritable();
				await writable.write(content);
				await writable.close();
			}
		},
		{ projectFolder: UPGRADE_PROJECT_FOLDER, projectManifest: fixture }
	);
	await page.unroute('**/__e2e-fixture-bootstrap');
}

async function staleSyntheticIndexExists(page: Page): Promise<boolean> {
	return page.evaluate(async () => {
		try {
			const root = await navigator.storage.getDirectory();
			const app = await root.getDirectoryHandle('apatosaurus');
			const version = await app.getDirectoryHandle('v1');
			const index = await version.getDirectoryHandle('index');
			await index.getFileHandle('apatosaurus-index-v0.db');
			return true;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'NotFoundError') return false;
			throw error;
		}
	});
}

function readStoredZipEntries(bytes: Uint8Array): Map<string, string> {
	const decoder = new TextDecoder();
	const entries = new Map<string, string>();
	let offset = 0;
	while (offset + 30 <= bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		if (view.getUint32(0, true) !== 0x04034b50) break;
		const size = view.getUint32(18, true);
		const pathLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const pathStart = offset + 30;
		const contentStart = pathStart + pathLength + extraLength;
		entries.set(
			decoder.decode(bytes.slice(pathStart, pathStart + pathLength)),
			decoder.decode(bytes.slice(contentStart, contentStart + size))
		);
		offset = contentStart + size;
	}
	return entries;
}

async function createCompleteProjectAndExport(page: Page, archivePath: string): Promise<string> {
	await createProject(page, PROJECT_NAME);
	await createAndCommitTeiTranscription(
		page,
		PROJECT_NAME,
		TRANSCRIPTION_TITLES[0],
		'E2E-A',
		'alpha-e2e'
	);
	await createAndCommitTeiTranscription(
		page,
		PROJECT_NAME,
		TRANSCRIPTION_TITLES[1],
		'E2E-B',
		'beta-e2e'
	);
	await createAndCommitCollation(page, PROJECT_NAME);

	await exportProject(page, PROJECT_NAME, archivePath);
	return archivePath;
}

async function createProject(page: Page, name: string): Promise<void> {
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	const input = page.getByPlaceholder('New project name');
	await input.fill(name);
	await input.press('Enter');
	await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function selectProject(page: Page, name: string): Promise<void> {
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	const card = page.locator('article', { has: page.getByRole('heading', { name }) });
	await card.getByRole('link', { name: 'Open' }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function createAndCommitTeiTranscription(
	page: Page,
	projectName: string,
	title: string,
	siglum: string,
	marker: string
): Promise<void> {
	await page.goto('/projects');
	await selectProject(page, projectName);
	await page.getByRole('link', { name: 'New Transcription' }).click();
	await page.getByRole('button', { name: 'Import TEI' }).click();
	await page.locator('input[type="file"][accept*="xml"]').setInputFiles(TEI_FIXTURE_PATH);
	await expect(page.getByText(/Imported NT_GRC_P118_Rom\.xml/)).toBeVisible();
	await page.locator('input[name="title"]').fill(title);
	await page.locator('input[name="siglum"]').fill(siglum);
	await page.locator('input[name="transcriber"]').fill('E2E Editor');
	await page.locator('input[name="repository"]').fill('E2E Library');
	await page.locator('input[name="settlement"]').fill('Test City');
	await page.locator('input[name="language"]').fill('Greek');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 30_000 });

	const line = page.locator('.line-content').filter({ hasText: /\S/ }).first();
	await line.click();
	await page.keyboard.press('End');
	await page.keyboard.type(` ${marker}`);
	await expect(page.getByText('Unsaved local edits')).toBeVisible();
	const commitButton = page.getByRole('button', { name: 'Commit version' }).first();
	await expect(commitButton).toBeEnabled({ timeout: 30_000 });
	await commitButton.click();
	const form = page.locator('form', { has: page.getByPlaceholder('Describe this version') });
	await form.getByPlaceholder('Describe this version').fill(`Commit ${title}`);
	await form.getByRole('button', { name: 'Commit version' }).click();
	await expect(page.getByText('Committed locally', { exact: true })).toBeVisible({
		timeout: 30_000,
	});
}

async function editAndCommitOpenTranscription(
	page: Page,
	marker: string,
	commitMessage: string
): Promise<void> {
	const line = page.locator('.line-content').filter({ hasText: /\S/ }).first();
	await line.click();
	await page.keyboard.press('End');
	await page.keyboard.type(` ${marker}`);
	await expect(page.getByText('Unsaved local edits')).toBeVisible();
	const commitButton = page.getByRole('button', { name: 'Commit version' }).first();
	await expect(commitButton).toBeEnabled({ timeout: 30_000 });
	await commitButton.click();
	const form = page.locator('form', { has: page.getByPlaceholder('Describe this version') });
	await form.getByPlaceholder('Describe this version').fill(commitMessage);
	await form.getByRole('button', { name: 'Commit version' }).click();
	await expect(page.getByText('Committed locally', { exact: true })).toBeVisible({
		timeout: 30_000,
	});
}

async function createAndCommitCollation(page: Page, projectName: string): Promise<void> {
	await page.goto('/projects');
	await selectProject(page, projectName);
	await page.getByRole('link', { name: 'New Collation' }).click();
	await expect(page.getByRole('heading', { name: 'Textual Scope' })).toBeVisible();
	await expect(page.getByText('Loading verses...')).not.toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Rebuild Verse Index' }).click();
	await expect(page.getByText('Rebuilt verse index for 2 transcriptions.')).toBeVisible({
		timeout: 30_000,
	});
	const verseSelector = page.locator('section', {
		has: page.getByRole('heading', { name: 'Verse Selector' }),
	});
	const verseButton = verseSelector
		.getByRole('button', {
			name: /Rom 15:.*2 witness sources/,
		})
		.first();
	await expect(verseButton).toBeVisible();
	await verseButton.click();
	await expect(page.getByText('Loading witnesses...')).not.toBeVisible({ timeout: 30_000 });
	await expect(page.locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
	await page.getByRole('button', { name: 'Proceed to Alignment' }).click();
	const runCollation = page.getByRole('button', { name: 'Run Collation' });
	await expect(runCollation).toBeEnabled({ timeout: 30_000 });
	await runCollation.click();
	await expect(page.getByText('Collating…')).not.toBeVisible({ timeout: 30_000 });

	const commitButton = page.getByRole('button', { name: 'Commit version' }).first();
	await expect(commitButton).toBeEnabled({ timeout: 30_000 });
	await commitButton.click();
	const form = page.locator('form', { has: page.getByPlaceholder('Describe this version') });
	await form.getByPlaceholder('Describe this version').fill('Commit end-to-end collation');
	await form.getByRole('button', { name: 'Commit version' }).click();
	await expect(page.getByText('Committed locally', { exact: true })).toBeVisible({
		timeout: 30_000,
	});
}

async function wipeSiteData(context: BrowserContext, page: Page): Promise<void> {
	const origin = new URL(page.url()).origin;
	const session = await context.newCDPSession(page);
	await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
}

async function importProjectArchive(page: Page, archivePath: string): Promise<void> {
	const panel = page.locator('div.rounded-box', {
		has: page.getByRole('heading', { name: 'Import Project Backup' }),
	});
	await panel.locator('input[type="file"]').setInputFiles(archivePath);
	await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/, { timeout: 30_000 });
}

async function exportProject(page: Page, projectName: string, archivePath: string): Promise<void> {
	await page.goto('/projects');
	await selectProject(page, projectName);
	await page.getByRole('link', { name: 'Backup and Sync' }).click();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export project zip' }).click();
	const download = await downloadPromise;
	await download.saveAs(archivePath);
}

async function openTranscription(page: Page, projectName: string, title: string): Promise<void> {
	await page.goto('/projects');
	await selectProject(page, projectName);
	const card = page.locator('div.rounded-box', { hasText: title }).last();
	await card.getByRole('link', { name: 'Open' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 30_000 });
}

async function connectSyncFolder(page: Page, projectName: string): Promise<void> {
	await page.goto('/projects');
	await selectProject(page, projectName);
	await page.getByRole('link', { name: 'Backup and Sync' }).click();
	await page.getByRole('button', { name: 'Connect sync folder' }).click();
	await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
}

async function syncNow(page: Page): Promise<void> {
	const button = page.getByRole('button', { name: 'Sync now' });
	await button.click();
	await expect(button).toBeDisabled();
	await expect(button).toBeEnabled({ timeout: 30_000 });
	await expect(page.getByText(/Last sync result:/)).toBeVisible({ timeout: 30_000 });
}

async function createCommitteeContext(
	browser: Browser,
	sharedFolder: SharedFolderServer
): Promise<BrowserContext> {
	const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
	await context.addInitScript(() => {
		Object.defineProperty(window, 'showDirectoryPicker', {
			configurable: true,
			value: async () => ({
				kind: 'directory',
				name: 'E2E Shared Committee Folder',
				queryPermission: async () => 'granted',
				requestPermission: async () => 'granted',
			}),
		});
	});
	await context.route('**/__e2e-shared-folder', route => sharedFolder.handle(route));
	return context;
}

type SharedFile = { content: string; revision: number; modifiedAt: string };

class SharedFolderServer {
	private readonly files = new Map<string, SharedFile>();
	private readonly folders = new Set<string>(['']);
	private nextRevision = 0;
	private available = true;

	setAvailable(available: boolean): void {
		this.available = available;
	}

	async handle(route: Route): Promise<void> {
		if (!this.available) {
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({
					code: 'provider-unavailable',
					message: 'Shared folder is paused while both committee members edit.',
				}),
			});
			return;
		}
		const request = route.request().postDataJSON() as Record<string, unknown>;
		try {
			const result = this.dispatch(request);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(result),
			});
		} catch (error) {
			const failure = error as Error & { code?: string };
			await route.fulfill({
				status: failure.code === 'conflict' ? 409 : 404,
				contentType: 'application/json',
				body: JSON.stringify({
					code: failure.code ?? 'not-found',
					message: failure.message,
				}),
			});
		}
	}

	private dispatch(request: Record<string, unknown>): unknown {
		const operation = String(request.operation);
		if (operation === 'create-folder') {
			const path = joinRemotePath(String(request.parentId ?? '.'), String(request.name));
			this.ensureFolders(path);
			return { id: path };
		}
		if (operation === 'list-files') {
			const folder = normalizeRemotePath(String(request.folderId ?? '.'));
			const recursive = request.recursive === true;
			const entries = [
				...[...this.folders]
					.filter(path => path && isListedPath(path, folder, recursive))
					.map(path => ({
						id: path,
						path,
						name: path.split('/').at(-1),
						revision: 'directory',
						modifiedAt: new Date(0).toISOString(),
						size: 0,
						isFolder: true,
					})),
				...[...this.files.entries()]
					.filter(([path]) => isListedPath(path, folder, recursive))
					.map(([path, file]) => ({
						id: path,
						path,
						name: path.split('/').at(-1),
						revision: `rev-${file.revision}`,
						modifiedAt: file.modifiedAt,
						size: new TextEncoder().encode(file.content).byteLength,
						isFolder: false,
					})),
			].sort((left, right) => left.path.localeCompare(right.path));
			return { entries, hasMore: false };
		}
		if (operation === 'download-file') {
			return { content: this.requireFile(String(request.fileId)).content };
		}
		if (operation === 'write-file') {
			const path = request.fileId
				? normalizeRemotePath(String(request.fileId))
				: joinRemotePath(String(request.folderId ?? '.'), String(request.path));
			const existing = this.files.get(path);
			const expectedRevision = request.expectedRevision;
			if (request.createOnly === true && existing)
				throw remoteError('conflict', `${path} exists.`);
			if (
				typeof expectedRevision === 'string' &&
				(!existing || `rev-${existing.revision}` !== expectedRevision)
			) {
				throw remoteError('conflict', `Revision changed for ${path}.`);
			}
			this.ensureFolders(parentRemotePath(path));
			const file = {
				content: String(request.content ?? ''),
				revision: ++this.nextRevision,
				modifiedAt: new Date().toISOString(),
			};
			this.files.set(path, file);
			return {
				id: path,
				path,
				revision: `rev-${file.revision}`,
				modifiedAt: file.modifiedAt,
				size: new TextEncoder().encode(file.content).byteLength,
			};
		}
		if (operation === 'delete-file') {
			const path = normalizeRemotePath(String(request.fileId));
			const file = this.requireFile(path);
			if (
				typeof request.expectedRevision === 'string' &&
				request.expectedRevision !== `rev-${file.revision}`
			) {
				throw remoteError('conflict', `Revision changed for ${path}.`);
			}
			this.files.delete(path);
			return {};
		}
		throw remoteError('not-found', `Unknown shared-folder operation ${operation}.`);
	}

	private requireFile(path: string): SharedFile {
		const file = this.files.get(normalizeRemotePath(path));
		if (!file) throw remoteError('not-found', `${path} was not found.`);
		return file;
	}

	private ensureFolders(path: string): void {
		const segments = normalizeRemotePath(path).split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			this.folders.add(current);
		}
	}
}

function normalizeRemotePath(path: string): string {
	return path === '.' ? '' : path.replace(/^\/+|\/+$/g, '');
}

function joinRemotePath(parent: string, child: string): string {
	return [normalizeRemotePath(parent), normalizeRemotePath(child)].filter(Boolean).join('/');
}

function parentRemotePath(path: string): string {
	return path.split('/').slice(0, -1).join('/');
}

function isListedPath(path: string, folder: string, recursive: boolean): boolean {
	const parent = parentRemotePath(path);
	return recursive ? path.startsWith(folder ? `${folder}/` : '') : parent === folder;
}

function remoteError(code: string, message: string): Error & { code: string } {
	return Object.assign(new Error(message), { code });
}
