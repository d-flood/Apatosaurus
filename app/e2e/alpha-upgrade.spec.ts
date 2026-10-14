import { expect, test, type Page } from '@playwright/test';
import alpha from '../src/lib/storage/formats/fixtures/alpha-collation-v2.json' with { type: 'json' };
import { sealDocument, serializeSealedDocument } from '../src/lib/storage/envelope';
import { hashCanonicalPayload } from '../src/lib/storage/canonical-json';
import { SharedFolderServer } from './shared-folder-server';

test('alpha upgrade opens existing OPFS collation edits and preserves them after reload', async ({
	page,
}) => {
	await page.goto('/about');
	await writeOpfsFiles(page, await alphaProjectFiles());
	await page.goto(`/collation/${alpha.id}/stemma`);
	await expect(page.getByRole('combobox', { name: /Source of reading/ })).toHaveCount(2);
	await expect(
		page.getByRole('combobox', { name: 'Source of reading a', exact: true })
	).toHaveValue('derived:r-a');
	await expect(
		page
			.getByRole('group', { name: /Local stemma for unit/ })
			.getByRole('button', { name: /derived from/ })
	).toHaveCount(1);
	await page.reload();
	await expect(page.getByRole('combobox', { name: /Source of reading/ })).toHaveCount(2);
	await expect(
		page.getByRole('combobox', { name: 'Source of reading a', exact: true })
	).toHaveValue('derived:r-a');
	const stored = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		async function read(path: string) {
			const parts = path.split('/');
			const name = parts.pop()!;
			let directory = root;
			for (const part of parts) directory = await directory.getDirectoryHandle(part);
			return JSON.parse(await (await (await directory.getFileHandle(name)).getFile()).text());
		}
		return {
			primary: await read('apatosaurus/v1/projects/alpha/collations/col-alpha.json'),
			working: await read(
				'apatosaurus/v1/projects/alpha/collations/col-alpha.working.json'
			).catch(() => null),
			original: await read(
				'apatosaurus/v1/upgrades/alpha-c7d94ee/alpha/original/collations/col-alpha.json'
			),
		};
	});
	expect(stored.primary.schema_version).toBe(8);
	expect(stored.original.schema_version).toBe(2);
	expect(stored.working).toBeNull();
	expect(stored.primary.notes).toBe('Unsaved alpha work');
	expect(stored.primary.document.apparatus.units[0].readings).toHaveLength(3);
	expect(stored.primary.document.apparatus.units[0].decisions.readingType).toEqual({
		'r-b': 'substitute',
		'split-c': 'orthographic',
	});
});

test('an alpha project that synced to a folder asks once where it lives, and Move clears it', async ({
	page,
}) => {
	const sharedFolder = new SharedFolderServer();
	await page.context().addInitScript(() => {
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
	await page.context().route('**/__e2e-shared-folder', route => sharedFolder.handle(route));
	await page.goto('/about');
	await writeOpfsFiles(page, [
		...(await alphaProjectFiles()),
		{
			path: 'apatosaurus/v1/app/sync-targets.json',
			content: serializeSealedDocument(
				await sealDocument('apatosaurus.sync-targets', 1, {
					targets: [
						{
							target_id: 'alpha-folder',
							project_id: alpha.project_id,
							handle_ref: 'alpha-folder',
							folder_display_path: 'Alpha folder',
							enabled: true,
							connected_at: alpha.created_at,
							updated_at: alpha.updated_at,
							last_synced_at: null,
						},
					],
				})
			),
		},
	]);

	await page.goto('/');
	const banner = page
		.getByTestId('dashboard-attention')
		.locator('article', { hasText: 'Choose where this project lives' });
	await expect(banner).toBeVisible({ timeout: 30_000 });

	await page.goto('/data#advanced');
	await page.getByRole('button', { name: 'Add folder on this computer' }).click();
	await expect(
		page.getByRole('listitem').filter({ hasText: 'E2E Shared Committee Folder' })
	).toBeVisible({ timeout: 30_000 });
	await page.goto('/');
	await banner.getByRole('link', { name: 'Move Alpha project' }).click();
	await expect(page).toHaveURL(/\/projects\/[^/]+\/location$/);
	await page.getByRole('button', { name: 'Move', exact: true }).click();
	await expect(page.getByTestId('project-location')).toHaveText('E2E Shared Committee Folder', {
		timeout: 30_000,
	});
	expect(sharedFolder.paths()).toEqual(
		expect.arrayContaining([
			'alpha/project.json',
			`alpha/collations/${alpha.id}.json`,
			`alpha/history/collations/${alpha.id}/cp-alpha.json`,
		])
	);

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Start something' })).toBeVisible();
	await expect(page.getByText('Choose where this project lives')).toHaveCount(0);
});

async function alphaProjectFiles(): Promise<Array<{ path: string; content: string }>> {
	const { created_at, updated_at, ...content } = structuredClone(alpha);
	// Blank witnesses to avoid unrelated refreshes.
	content.document.setup.witnesses.forEach(witness => {
		witness.transcriptionId = '';
	});
	const readings = content.document.apparatus.units[0].readings;
	readings[0].order = 1;
	readings[0].label = 'b';
	readings[1].order = 0;
	readings[1].label = 'a';
	readings[2].label = 'a1';
	const hash = await hashCanonicalPayload(content);
	const revision = {
		id: 'cp-alpha',
		content_hash: hash,
		created_at,
		author_name: 'Alpha editor',
	};
	const heads = [
		{
			collation_id: alpha.id,
			current_revision: { id: revision.id, content_hash: hash },
			title: alpha.title,
			verse_identifier: alpha.verse_identifier,
			primary_path: `collations/${alpha.id}.json`,
		},
	];
	const manifest = {
		id: alpha.project_id,
		name: 'Alpha project',
		description: '',
		charter: '',
		collation_settings: {},
		forked_from: null,
		manifest_content_hash: await hashCanonicalPayload({
			project_id: alpha.project_id,
			transcriptions: [],
			collations: heads,
			tombstones: [],
		}),
		transcriptions: [],
		collations: heads,
		tombstones: [],
		created_at,
		updated_at,
	};
	return [
		{
			path: 'apatosaurus/v1/projects/alpha/project.json',
			content: serializeSealedDocument(
				await sealDocument('apatosaurus.project-manifest', 2, manifest)
			),
		},
		{
			path: `apatosaurus/v1/projects/alpha/collations/${alpha.id}.json`,
			content: serializeSealedDocument(
				await sealDocument('apatosaurus.collation', 2, {
					...content,
					created_at,
					updated_at,
					current_revision: revision,
				})
			),
		},
		{
			path: `apatosaurus/v1/projects/alpha/collations/${alpha.id}.working.json`,
			content: serializeSealedDocument(
				await sealDocument('apatosaurus.working.collation', 2, {
					...content,
					notes: 'Unsaved alpha work',
					created_at,
					updated_at,
					draft: {
						base_revision_id: revision.id,
						base_content_hash: hash,
						saved_at: updated_at,
						author_name: 'Alpha editor',
					},
				})
			),
		},
		{
			path: `apatosaurus/v1/projects/alpha/history/collations/${alpha.id}/cp-alpha.json`,
			content: serializeSealedDocument(
				await sealDocument('apatosaurus.checkpoint.collation', 2, {
					checkpoint_id: revision.id,
					entity_type: 'collation',
					entity_id: alpha.id,
					parent_checkpoint_id: null,
					payload_content_hash: hash,
					payload: content,
					commit_message: 'Alpha work',
					author_name: 'Alpha editor',
					created_at,
				})
			),
		},
	];
}

async function writeOpfsFiles(
	page: Page,
	files: Array<{ path: string; content: string }>
): Promise<void> {
	await page.evaluate(async files => {
		const root = await navigator.storage.getDirectory();
		for (const file of files) {
			const parts = file.path.split('/');
			const name = parts.pop()!;
			let directory = root;
			for (const part of parts)
				directory = await directory.getDirectoryHandle(part, { create: true });
			const handle = await directory.getFileHandle(name, { create: true });
			const writer = await handle.createWritable();
			await writer.write(file.content);
			await writer.close();
		}
	}, files);
}
