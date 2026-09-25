import { expect, test } from '@playwright/test';
import alpha from '../src/lib/client/store/formats/fixtures/alpha-collation-v2.json' with { type: 'json' };
import { sealDocument, serializeSealedDocument } from '../src/lib/client/store/envelope';
import { hashCanonicalPayload } from '../src/lib/client/store/canonical-json';

test('alpha upgrade opens existing OPFS collation edits and preserves them after reload', async ({
	page,
}) => {
	const { created_at, updated_at, ...content } = structuredClone(alpha);
	// This fixture exercises the collation without requiring unrelated witness refreshes.
	content.document.setup.witnesses.forEach(witness => {
		witness.transcriptionId = '';
	});
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
	const files = [
		{
			path: 'project.json',
			content: serializeSealedDocument(
				await sealDocument('apatosaurus.project-manifest', 2, manifest)
			),
		},
		{
			path: `collations/${alpha.id}.json`,
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
			path: `collations/${alpha.id}.working.json`,
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
			path: `history/collations/${alpha.id}/cp-alpha.json`,
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
	await page.goto('/about');
	await page.evaluate(async files => {
		const root = await navigator.storage.getDirectory();
		for (const file of files) {
			const parts = `apatosaurus/v1/projects/alpha/${file.path}`.split('/');
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
	await page.goto(`/collation/${alpha.id}/stemma`);
	await expect(page.getByRole('combobox', { name: /Source of reading/ })).toHaveCount(2);
	await expect(
		page
			.getByRole('group', { name: /Local stemma for unit/ })
			.getByRole('button', { name: /derived from/ })
	).toHaveCount(1);
	await page.reload();
	await expect(page.getByRole('combobox', { name: /Source of reading/ })).toHaveCount(2);
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
			working: await read('apatosaurus/v1/projects/alpha/collations/col-alpha.working.json'),
			original: await read(
				'apatosaurus/v1/upgrades/alpha-c7d94ee/alpha/original/collations/col-alpha.json'
			),
		};
	});
	expect(stored.primary.schema_version).toBe(6);
	expect(stored.original.schema_version).toBe(2);
	expect(stored.working.notes).toBe('Unsaved alpha work');
	expect(stored.working.document.apparatus.units[0].readings).toHaveLength(3);
	expect(stored.working.document.apparatus.units[0].decisions.readingType).toEqual({
		'r-b': 'substitute',
		'split-c': 'orthographic',
	});
});
