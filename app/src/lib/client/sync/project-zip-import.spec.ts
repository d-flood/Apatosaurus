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
	joinStorePath,
	projectFolder,
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
		expect(blocked.quarantinedFiles[0].message).toContain('Choose replace or import as copy');

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

		await cleanStaleProjectImportStaging(storeOptions);

		expect([...backend.files.keys()].filter(path => path.includes('/staging/'))).toEqual([]);
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
