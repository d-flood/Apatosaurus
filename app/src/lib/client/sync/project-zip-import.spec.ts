import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import {
	createProject as createProjectRepository,
	getProject,
} from '$lib/client/db/repositories/projects';
import { createTranscriptionWithFiles } from '$lib/client/db/repositories/transcription-files';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import {
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FIXTURE,
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CURRENT_VERSION,
	COLLATION_FIXTURE,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FORMAT,
	TOMBSTONE_CURRENT_VERSION,
	TOMBSTONE_FIXTURE,
	TOMBSTONE_FORMAT,
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FIXTURE,
	WORKING_COLLATION_FORMAT,
	joinStorePath,
	projectFolder,
	readCanonicalDocument,
	sealDocument,
	serializeSealedDocument,
	writeTextFileAtomic,
	type JsonObject,
	type StoreOperationOptions,
} from '$lib/client/store';
import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { exportProjectZip } from './project-zip-export';
import {
	cleanStaleProjectImportStaging,
	importProjectFileTree,
	importProjectZip,
	stageAndValidateProjectFileTree,
} from './project-zip-import';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
let storeOptions: StoreOperationOptions;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	storeOptions = { backend };
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await harness.destroy();
});

function createProject(
	db: Parameters<typeof createProjectRepository>[0],
	input: Parameters<typeof createProjectRepository>[1]
) {
	return createProjectRepository(db, input, storeOptions);
}

describe('project zip import', () => {
	it('exposes validated staged files without placing or cleaning them', async () => {
		const exported = await exportedProjectZip();
		const entries = readZipEntries(exported.bytes);
		const staged = await stageAndValidateProjectFileTree(
			Object.entries(entries).map(([path, content]) => ({ path, read: async () => content })),
			{ storeOptions, nonce: () => 'public-seam', ownerId: 'test-owner' }
		);

		expect(staged.report.quarantinedFiles).toEqual([]);
		expect(staged.manifest?.id).toBe('project-1');
		expect(staged.entries.map(entry => entry.path)).toContain('project.json');
		expect([...backend.files.keys()].some(path => path.includes('/staging/public-seam/'))).toBe(
			true
		);
		expect([...backend.files.keys()].some(path => path.includes('/projects/'))).toBe(false);

		await staged.cleanup();
		expect([...backend.files.keys()].some(path => path.includes('/staging/public-seam/'))).toBe(
			false
		);
	});

	it.each([
		'/project.json',
		'C:/project.json',
		'project\\json',
		'a//project.json',
		'./project.json',
		'a/../project.json',
	])('rejects malformed original path %s before staging', async path => {
		const result = await importProjectFileTree(harness.db, [{ path, read: async () => '{}' }], {
			storeOptions,
			nonce: () => 'bad-path',
		});
		expect(result.ok).toBe(false);
		expect(result.quarantinedFiles[0]?.message).toContain('Invalid project entry path');
		expect(backend.files.size).toBe(0);
	});

	it('rejects duplicate normalized archive paths', async () => {
		const result = await importProjectFileTree(
			harness.db,
			[
				{ path: 'root/project.json', read: async () => '{}' },
				{ path: 'root/project.json', read: async () => '{}' },
			],
			{ storeOptions, nonce: () => 'duplicate' }
		);
		expect(result.quarantinedFiles[0]?.message).toContain('Duplicate project entry path');
		expect(backend.files.size).toBe(0);
	});

	it('rejects multiple project roots and unknown JSON files', async () => {
		const multipleRoots = await importProjectFileTree(
			harness.db,
			[
				{ path: 'one/project.json', read: async () => '{}' },
				{ path: 'two/project.json', read: async () => '{}' },
			],
			{ storeOptions, nonce: () => 'multiple-roots' }
		);
		expect(multipleRoots.quarantinedFiles[0]?.message).toContain('exactly one project root');

		const exported = await exportedProjectZip();
		const entries = readZipEntries(exported.bytes);
		entries['metadata.json'] = '{}';
		const unknown = await importProjectFileTree(
			harness.db,
			Object.entries(entries).map(([path, content]) => ({ path, read: async () => content })),
			{ storeOptions, nonce: () => 'unknown-json' }
		);
		expect(unknown.quarantinedFiles).toContainEqual(
			expect.objectContaining({
				path: 'metadata.json',
				message: 'Unsupported project file metadata.json.',
			})
		);
		expect([...backend.files.keys()].filter(path => path.includes('/projects/'))).toEqual([]);
	});
	it('imports a source-neutral readable project file tree', async () => {
		const exported = await exportedProjectZip();
		const expected = readZipEntries(exported.bytes);
		const imported = await importProjectFileTree(
			harness.db,
			Object.entries(expected).map(([path, content]) => ({
				path,
				read: async () => content,
			})),
			{ storeOptions, nonce: () => 'file-tree' }
		);

		expect(imported).toMatchObject({ ok: true, projectId: 'project-1', projectsRestored: 1 });
		expect(projectFiles(imported.storageSlug)).toEqual(expected);
		expect(await getProject(harness.db, 'project-1')).toMatchObject({ name: 'Romans' });
	});

	it('imports an exported project zip into an empty store byte-for-byte', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-project-',
			name: 'Romans',
			createdAt: '2026-07-07T00:00:00.000Z',
			updatedAt: '2026-07-07T00:00:00.000Z',
		});
		await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-1',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-1',
				title: 'Witness 1',
				siglum: '01',
				document: documentWithVerses(['Romans 1:1']),
				createdAt: '2026-07-07T00:01:00.000Z',
				updatedAt: '2026-07-07T00:01:00.000Z',
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			storeOptions
		);
		const exported = await exportProjectZip(harness.db, 'project-1', { storeOptions });
		const expected = readZipEntries(exported.bytes);

		await harness.destroy();
		harness = createLocalDbTestHarness();
		backend = new MemoryStoreBackend();
		storeOptions = { backend };
		const imported = await importProjectZip(harness.db, exported.bytes, {
			storeOptions,
			nonce: () => 'round-trip',
		});

		expect(imported).toMatchObject({ ok: true, projectId: 'project-1', projectsRestored: 1 });
		expect(projectFiles(imported.storageSlug)).toEqual(expected);
		expect(await getProject(harness.db, 'project-1')).toMatchObject({ name: 'Romans' });
	});

	it('requires an explicit collision choice and can replace the local project', async () => {
		const exported = await exportedProjectZip();
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'local-project',
			name: 'Local',
			updatedAt: '2026-07-08T00:00:00.000Z',
		});
		await writeTextFileAtomic(
			joinStorePath(projectFolder('local-project'), 'stale.json'),
			'stale',
			storeOptions
		);

		const blocked = await importProjectZip(harness.db, exported.bytes, { storeOptions });
		expect(blocked.ok).toBe(false);
		expect(blocked.quarantinedFiles).toEqual([]);
		expect(blocked.collision).toEqual({
			projectId: 'project-1',
			localUpdatedAt: '2026-07-08T00:00:00.000Z',
			importedUpdatedAt: expect.any(String),
		});

		const replaced = await importProjectZip(harness.db, exported.bytes, {
			storeOptions,
			collisionMode: 'replace',
			nonce: () => 'replace',
		});

		expect(replaced).toMatchObject({ ok: true, mode: 'replaced', projectId: 'project-1' });
		expect(projectFiles('local-project')).not.toHaveProperty('stale.json');
		expect(await getProject(harness.db, 'project-1')).toMatchObject({ name: 'Romans' });
	});

	it('imports a same-id project as a copy with source lineage', async () => {
		const exported = await exportedProjectZip();
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'local-project',
			name: 'Local',
		});

		const copied = await importProjectZip(harness.db, exported.bytes, {
			storeOptions,
			collisionMode: 'copy',
			nonce: () => 'copy',
		});

		expect(copied).toMatchObject({ ok: true, mode: 'copied' });
		expect(copied.projectId).not.toBe('project-1');
		const importedPrimary = JSON.parse(
			projectFiles(copied.storageSlug)['transcriptions/pt-1.json']
		) as { origin: { source_project_id: string; source_transcription_id: string } };
		expect(importedPrimary.origin).toMatchObject({
			source_project_id: 'project-1',
			source_transcription_id: 'tx-1',
		});
	});

	it('rewrites every project-scoped collation and tombstone field while preserving historical IDs', async () => {
		const exported = await exportedProjectZip();
		const entries = readZipEntries(exported.bytes);
		const manifestRead = await readCanonicalDocument(
			PROJECT_MANIFEST_FORMAT,
			entries['project.json']
		);
		expect(manifestRead.ok).toBe(true);
		if (!manifestRead.ok) return;
		const collation = structuredClone(COLLATION_FIXTURE);
		const working = structuredClone(WORKING_COLLATION_FIXTURE);
		working.draft.base_revision_id = collation.current_revision.id;
		working.draft.base_content_hash = collation.current_revision.content_hash;
		const checkpoint = structuredClone(COLLATION_CHECKPOINT_FIXTURE);
		const tombstone = structuredClone(TOMBSTONE_FIXTURE);
		entries['collations/col-1.json'] = serializeSealedDocument(
			await sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, collation)
		);
		entries['collations/col-1.working.json'] = serializeSealedDocument(
			await sealDocument(WORKING_COLLATION_FORMAT, WORKING_COLLATION_CURRENT_VERSION, working)
		);
		entries['collations/col-1.tei.xml'] = '<old-derived-tei />';
		entries['history/collations/col-1/col-cp-1.json'] = serializeSealedDocument(
			await sealDocument(
				COLLATION_CHECKPOINT_FORMAT,
				COLLATION_CHECKPOINT_CURRENT_VERSION,
				checkpoint
			)
		);
		entries['tombstones/project-transcription--pt-deleted.json'] = serializeSealedDocument(
			await sealDocument(TOMBSTONE_FORMAT, TOMBSTONE_CURRENT_VERSION, tombstone)
		);
		const manifest = manifestRead.payload as typeof manifestRead.payload & {
			collations: JsonObject[];
			tombstones: JsonObject[];
			manifest_content_hash: string;
		};
		manifest.collations = [
			{
				collation_id: collation.id,
				current_revision: {
					id: collation.current_revision.id,
					content_hash: collation.current_revision.content_hash,
				},
				title: collation.title,
				verse_identifier: collation.verse_identifier,
				primary_path: 'collations/col-1.json',
			},
		];
		manifest.tombstones = [
			{
				tombstone_id: tombstone.id,
				entity_type: tombstone.entity_type,
				entity_id: tombstone.entity_id,
				deletion_revision_id: tombstone.deletion_revision_id,
				content_hash: await import('./canonical-json').then(module =>
					module.hashCanonicalPayload(tombstone)
				),
				primary_path: 'tombstones/project-transcription--pt-deleted.json',
				deleted_at: tombstone.deleted_at,
			},
		];
		manifest.manifest_content_hash = await import('./canonical-json').then(module =>
			module.hashCanonicalPayload({
				project_id: manifest.id,
				transcriptions: manifest.transcriptions,
				collations: manifest.collations,
				tombstones: manifest.tombstones,
			})
		);
		entries['project.json'] = serializeSealedDocument(
			await sealDocument(PROJECT_MANIFEST_FORMAT, PROJECT_MANIFEST_CURRENT_VERSION, manifest)
		);
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'local-project',
			name: 'Local',
		});

		const copied = await importProjectFileTree(
			harness.db,
			Object.entries(entries).map(([path, content]) => ({ path, read: async () => content })),
			{ storeOptions, collisionMode: 'copy', nonce: () => 'complete-copy' }
		);

		expect(copied.ok, JSON.stringify(copied.quarantinedFiles)).toBe(true);
		const files = projectFiles(copied.storageSlug);
		const copiedManifest = JSON.parse(files['project.json']) as Record<string, any>;
		const copiedCollation = JSON.parse(files['collations/col-1.json']) as Record<string, any>;
		const copiedWorking = JSON.parse(files['collations/col-1.working.json']) as Record<
			string,
			any
		>;
		const copiedCheckpoint = JSON.parse(
			files['history/collations/col-1/col-cp-1.json']
		) as Record<string, any>;
		const copiedTombstone = JSON.parse(
			files['tombstones/project-transcription--pt-deleted.json']
		) as Record<string, any>;
		expect(copiedManifest.id).toBe(copied.projectId);
		expect(copiedManifest.forked_from).toMatchObject({ source_project_id: 'project-1' });
		expect(copiedCollation).toMatchObject({
			id: 'col-1',
			project_id: copied.projectId,
			current_revision: { id: 'col-cp-1' },
			document: { meta: { collationId: 'col-1', projectId: copied.projectId } },
		});
		expect(copiedWorking).toMatchObject({ project_id: copied.projectId });
		expect(copiedCheckpoint).toMatchObject({
			checkpoint_id: 'col-cp-1',
			entity_id: 'col-1',
			payload: { project_id: copied.projectId },
		});
		expect(copiedTombstone).toMatchObject({ id: 'tombstone-1', project_id: copied.projectId });
		expect(files['collations/col-1.tei.xml']).not.toBe('<old-derived-tei />');

		const { rebuildIndexFromStore } = await import('$lib/client/db/repositories/index-rebuild');
		const secondRebuild = await rebuildIndexFromStore(harness.db, storeOptions);
		expect(secondRebuild.quarantinedFiles).toEqual([]);
		expect(secondRebuild.collationsRestored).toBe(1);
	});

	it('rejects a corrupt file without writing outside staging', async () => {
		const result = await importProjectZip(
			harness.db,
			zipEntries({ 'project.json': '{not-json' }),
			{
				storeOptions,
				nonce: () => 'corrupt',
			}
		);

		expect(result.ok).toBe(false);
		expect(result.quarantinedFiles[0]).toMatchObject({
			path: 'project.json',
			code: 'invalid_json',
		});
		expect([...backend.files.keys()].filter(path => path.includes('/projects/'))).toEqual([]);
		expect([...backend.files.keys()].filter(path => path.includes('/staging/'))).toEqual([]);
	});

	it('rejects a resealed collation checkpoint with a corrupt nested hash', async () => {
		const exported = await exportedProjectZip();
		const entries = readZipEntries(exported.bytes);
		entries['history/collations/col-1/cp-1.json'] = serializeSealedDocument(
			await sealDocument(COLLATION_CHECKPOINT_FORMAT, COLLATION_CHECKPOINT_CURRENT_VERSION, {
				...COLLATION_CHECKPOINT_FIXTURE,
				payload_content_hash: 'sha256:wrong',
			} as JsonObject)
		);

		const result = await importProjectFileTree(
			harness.db,
			Object.entries(entries).map(([path, content]) => ({ path, read: async () => content })),
			{ storeOptions, nonce: () => 'nested-hash' }
		);

		expect(result.ok).toBe(false);
		expect(result.quarantinedFiles).toContainEqual(
			expect.objectContaining({
				path: 'history/collations/col-1/cp-1.json',
				code: 'hash_mismatch',
			})
		);
		expect([...backend.files.keys()].filter(path => path.includes('/projects/'))).toEqual([]);
	});

	it('rejects the alternate tombstone-id path before placement', async () => {
		const exported = await exportedProjectZip();
		const entries = readZipEntries(exported.bytes);
		entries['tombstones/tombstone-1.json'] = '{}';

		const result = await importProjectFileTree(
			harness.db,
			Object.entries(entries).map(([path, content]) => ({ path, read: async () => content })),
			{ storeOptions, nonce: () => 'alternate-tombstone' }
		);

		expect(result.quarantinedFiles).toContainEqual(
			expect.objectContaining({
				path: 'tombstones/tombstone-1.json',
				message: 'Unsupported project file tombstones/tombstone-1.json.',
			})
		);
		expect([...backend.files.keys()].filter(path => path.includes('/projects/'))).toEqual([]);
	});

	it('rejects path traversal entries without writes', async () => {
		const result = await importProjectZip(harness.db, zipEntries({ '../project.json': '{}' }), {
			storeOptions,
			nonce: () => 'traversal',
		});

		expect(result.ok).toBe(false);
		expect(result.quarantinedFiles[0].message).toContain('Invalid project entry path');
		expect(backend.files.size).toBe(0);
	});

	it('removes stale staging directories', async () => {
		await writeTextFileAtomic('staging/old/project.json', '{}', storeOptions);
		await writeTextFileAtomic(
			'staging/old/.lease.json',
			JSON.stringify({
				owner_id: 'gone',
				created_at: '2026-07-07T00:00:00.000Z',
				heartbeat_at: '2026-07-07T00:00:00.000Z',
			}),
			storeOptions
		);

		await cleanStaleProjectImportStaging(storeOptions, {
			now: () => new Date('2026-07-07T02:00:00.000Z'),
			lockManager: null,
		});

		expect([...backend.files.keys()].filter(path => path.includes('/staging/'))).toEqual([]);
	});

	it('keeps stale staging while its Web Lock is active', async () => {
		await writeTextFileAtomic(
			'staging/active/.lease.json',
			JSON.stringify({
				owner_id: 'active-owner',
				created_at: '2026-07-07T00:00:00.000Z',
				heartbeat_at: '2026-07-07T00:00:00.000Z',
			}),
			storeOptions
		);
		const lockManager = {
			request: vi.fn(
				async (_name: string, _options: unknown, callback: (lock: null) => Promise<void>) =>
					callback(null)
			),
		};

		await cleanStaleProjectImportStaging(storeOptions, {
			now: () => new Date('2026-07-07T02:00:00.000Z'),
			lockManager: lockManager as never,
		});

		expect(lockManager.request).toHaveBeenCalledWith(
			'apatosaurus:project-import:active',
			{ ifAvailable: true },
			expect.any(Function)
		);
		expect([...backend.files.keys()].some(path => path.includes('/staging/active/'))).toBe(
			true
		);
	});

	it.each([
		['entity write', 'projects/local-project/transcriptions'],
		['manifest write', 'projects/local-project/project.json'],
	])('restores exact previous bytes after a failed %s', async (_label, failurePath) => {
		const exported = await exportedProjectZip();
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'local-project',
			name: 'Local',
			updatedAt: '2026-07-08T00:00:00.000Z',
		});
		await writeTextFileAtomic(
			joinStorePath(projectFolder('local-project'), 'local-only.txt'),
			'exact old bytes',
			storeOptions
		);
		const before = projectFiles('local-project');
		backend.failWritePathIncludesOnce = failurePath;

		const result = await importProjectZip(harness.db, exported.bytes, {
			storeOptions,
			collisionMode: 'replace',
			nonce: () => `failed-${_label}`,
		});

		expect(result.ok).toBe(false);
		expect(projectFiles('local-project')).toEqual(before);
		expect(await getProject(harness.db, 'project-1')).toMatchObject({ name: 'Local' });
	});

	it('restores exact previous bytes after index rebuild fails', async () => {
		const exported = await exportedProjectZip();
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'local-project',
			name: 'Local',
			updatedAt: '2026-07-08T00:00:00.000Z',
		});
		const before = projectFiles('local-project');
		backend.failReadPathIncludesAfter = {
			path: 'projects/local-project/project.json',
			successfulReads: 1,
		};

		const result = await importProjectZip(harness.db, exported.bytes, {
			storeOptions,
			collisionMode: 'replace',
			nonce: () => 'failed-rebuild',
		});

		expect(result.ok).toBe(false);
		expect(projectFiles('local-project')).toEqual(before);
		expect(await getProject(harness.db, 'project-1')).toMatchObject({ name: 'Local' });
	});
});

async function exportedProjectZip() {
	await createProject(harness.db, {
		id: 'project-1',
		storageSlug: 'romans-project-',
		name: 'Romans',
		updatedAt: '2026-07-07T00:00:00.000Z',
	});
	await createTranscriptionWithFiles(
		harness.db,
		{
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Witness 1',
			siglum: '01',
			document: documentWithVerses(['Romans 1:1']),
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		},
		storeOptions
	);
	const exported = await exportProjectZip(harness.db, 'project-1', { storeOptions });
	await harness.destroy();
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	storeOptions = { backend };
	return exported;
}

function projectFiles(storageSlug: string): Record<string, string> {
	const prefix = `apatosaurus/v1/${projectFolder(storageSlug)}/`;
	const files: Record<string, string> = {};
	for (const [path, content] of backend.files) {
		if (path.startsWith(prefix)) files[path.slice(prefix.length)] = content;
	}
	return files;
}

function documentWithVerses(verses: string[]): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument' as const,
		pages: [
			{
				type: 'page',
				id: 'page-1',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: [
							{
								type: 'line',
								number: 1,
								items: verses.map(identifier => {
									const [book, chapterVerse] = identifier.split(' ');
									const [chapter, verse] = chapterVerse.split(':');
									return {
										type: 'milestone' as const,
										kind: 'verse' as const,
										attrs: { book, chapter, verse },
									};
								}),
							},
						],
					},
				],
			},
		],
	};
}

function zipEntries(entries: Record<string, string>): Uint8Array {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	const records = Object.entries(entries).map(([path, content]) => ({
		pathBytes: encoder.encode(path),
		contentBytes: encoder.encode(content),
	}));
	for (const record of records) {
		const local = new Uint8Array(30);
		const view = new DataView(local.buffer);
		view.setUint32(0, 0x04034b50, true);
		view.setUint16(4, 20, true);
		view.setUint16(8, 0, true);
		view.setUint32(18, record.contentBytes.length, true);
		view.setUint32(22, record.contentBytes.length, true);
		view.setUint16(26, record.pathBytes.length, true);
		chunks.push(local, record.pathBytes, record.contentBytes);
		const header = new Uint8Array(46 + record.pathBytes.length);
		const headerView = new DataView(header.buffer);
		headerView.setUint32(0, 0x02014b50, true);
		headerView.setUint32(20, record.contentBytes.length, true);
		headerView.setUint32(24, record.contentBytes.length, true);
		headerView.setUint16(28, record.pathBytes.length, true);
		headerView.setUint32(42, offset, true);
		header.set(record.pathBytes, 46);
		central.push(header);
		offset += local.length + record.pathBytes.length + record.contentBytes.length;
	}
	const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(8, records.length, true);
	endView.setUint16(10, records.length, true);
	endView.setUint32(12, centralSize, true);
	endView.setUint32(16, offset, true);
	return concat([...chunks, ...central, end]);
}

function readZipEntries(bytes: Uint8Array): Record<string, string> {
	const decoder = new TextDecoder();
	const entries: Record<string, string> = {};
	let offset = 0;
	while (offset < bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		const signature = view.getUint32(0, true);
		if (signature !== 0x04034b50) break;
		const compressedSize = view.getUint32(18, true);
		const pathLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const pathStart = offset + 30;
		const contentStart = pathStart + pathLength + extraLength;
		const path = decoder.decode(bytes.slice(pathStart, pathStart + pathLength));
		entries[path] = decoder.decode(bytes.slice(contentStart, contentStart + compressedSize));
		offset = contentStart + compressedSize;
	}
	return entries;
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}
