import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createProject as createProjectRepository } from '$lib/client/db/repositories/projects';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import {
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FIXTURE,
	WORKING_COLLATION_FORMAT,
	WORKING_TRANSCRIPTION_CURRENT_VERSION,
	WORKING_TRANSCRIPTION_FIXTURE,
	WORKING_TRANSCRIPTION_FORMAT,
	joinStorePath,
	projectFolder,
	sealDocument,
	serializeSealedDocument,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from '$lib/client/store';
import { zipExportBackupPathMessage } from '$lib/onboarding-guidance';
import {
	exportAllProjectsZip,
	exportProjectZip,
	projectBackupCapabilityMessage,
} from './project-zip-export';
import { importProjectZip } from './project-zip-import';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
let storeOptions: StoreOperationOptions;

class ByteReadingMemoryStoreBackend extends MemoryStoreBackend {
	readonly byteOverrides = new Map<string, Uint8Array>();

	async readFileBytes(path: string): Promise<Uint8Array> {
		return this.byteOverrides.get(path) ?? new TextEncoder().encode(await this.readTextFile(path));
	}
}

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	storeOptions = { backend };
});

afterEach(async () => {
	await harness.destroy();
});

function createProject(
	db: Parameters<typeof createProjectRepository>[0],
	input: Parameters<typeof createProjectRepository>[1]
) {
	return createProjectRepository(db, input, storeOptions);
}

describe('project zip export', () => {
	it('exports committed project files byte-for-byte without working files by default', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		await writeProjectFile('romans-a1b2', 'transcriptions/tx-1.json', '{"format":"tx"}');
		await writeProjectFile('romans-a1b2', 'transcriptions/tx-1.tei.xml', '<TEI>tx</TEI>');
		await writeProjectFile('romans-a1b2', 'transcriptions/tx-1.working.json', '{"draft":true}');
		await writeProjectFile('romans-a1b2', 'history/transcriptions/tx-1/cp-1.json', '{"cp":1}');
		await writeProjectFile('romans-a1b2', 'transcriptions/tx-1.json.tmp-1', 'temporary');

		const result = await exportProjectZip(harness.db, 'project-1', {
			storeOptions,
			now: () => new Date('2026-07-07T09:00:00.000Z'),
		});

		expect(result.fileName).toBe('romans-a1b2-2026-07-07.zip');
		expect(result.entryPaths).toEqual([
			'history/transcriptions/tx-1/cp-1.json',
			'project.json',
			'transcriptions/tx-1.json',
			'transcriptions/tx-1.tei.xml',
		]);
		expect(readZipEntries(result.bytes)).toEqual({
			'history/transcriptions/tx-1/cp-1.json': '{"cp":1}',
			'project.json': backend.files.get('apatosaurus/v1/projects/romans-a1b2/project.json'),
			'transcriptions/tx-1.json': '{"format":"tx"}',
			'transcriptions/tx-1.tei.xml': '<TEI>tx</TEI>',
		});
	});

	it('includes working files only when drafts are requested', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		await writeProjectFile('romans-a1b2', 'collations/col-1.working.json', '{"draft":true}');
		await writeTextFileAtomic('app/settings.json', '{"local":true}', storeOptions);

		const result = await exportProjectZip(harness.db, 'project-1', {
			includeDrafts: true,
			storeOptions,
		});

		expect(result.entryPaths).toEqual(['collations/col-1.working.json', 'project.json']);
		expect(readZipEntries(result.bytes)).toEqual({
			'collations/col-1.working.json': '{"draft":true}',
			'project.json': backend.files.get('apatosaurus/v1/projects/romans-a1b2/project.json'),
		});
	});

	it('preserves every complete-project entry as exact bytes and includes both draft formats on request', async () => {
		const byteBackend = new ByteReadingMemoryStoreBackend();
		backend = byteBackend;
		storeOptions = { backend };
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		const files = {
			'transcriptions/tx-1.json': '{"kind":"transcription"}',
			'transcriptions/tx-1.working.json': '{"kind":"transcription-draft"}',
			'transcriptions/tx-1.tei.xml': '<TEI>α transcription</TEI>',
			'collations/col-1.json': '{"kind":"collation"}',
			'collations/col-1.working.json': '{"kind":"collation-draft"}',
			'collations/col-1.tei.xml': '<TEI>β collation</TEI>',
			'history/transcriptions/tx-1/cp-tx.json': '{"kind":"transcription-history"}',
			'history/collations/col-1/cp-col.json': '{"kind":"collation-history"}',
			'tombstones/transcription--old.json': '{"kind":"tombstone"}',
		};
		for (const [path, content] of Object.entries(files)) {
			await writeProjectFile('romans-a1b2', path, content);
		}
		const exactTeiBytes = new Uint8Array([0, 0xff, 0x54, 0x45, 0x49]);
		byteBackend.byteOverrides.set(
			'apatosaurus/v1/projects/romans-a1b2/transcriptions/tx-1.tei.xml',
			exactTeiBytes
		);
		const manifest = backend.files.get('apatosaurus/v1/projects/romans-a1b2/project.json');
		expect(manifest).toBeDefined();

		const result = await exportProjectZip(harness.db, 'project-1', {
			includeDrafts: true,
			storeOptions,
		});

		const entries = readZipEntryBytes(result.bytes);
		const expected = { 'project.json': manifest!, ...files };
		expect(Object.keys(entries).sort()).toEqual(Object.keys(expected).sort());
		for (const [path, content] of Object.entries(expected)) {
			expect(entries[path]).toEqual(
				path === 'transcriptions/tx-1.tei.xml'
					? exactTeiBytes
					: new TextEncoder().encode(content)
			);
		}
	});

	it('restores both draft formats and identifies them in the import report', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		await writeProjectFile(
			'romans-a1b2',
			'transcriptions/pt-1.working.json',
			serializeSealedDocument(
				await sealDocument(
					WORKING_TRANSCRIPTION_FORMAT,
					WORKING_TRANSCRIPTION_CURRENT_VERSION,
					WORKING_TRANSCRIPTION_FIXTURE
				)
			)
		);
		await writeProjectFile(
			'romans-a1b2',
			'collations/col-1.working.json',
			serializeSealedDocument(
				await sealDocument(
					WORKING_COLLATION_FORMAT,
					WORKING_COLLATION_CURRENT_VERSION,
					WORKING_COLLATION_FIXTURE
				)
			)
		);
		const exported = await exportProjectZip(harness.db, 'project-1', {
			includeDrafts: true,
			storeOptions,
		});

		const targetHarness = createLocalDbTestHarness();
		const targetBackend = new MemoryStoreBackend();
		try {
			const imported = await importProjectZip(targetHarness.db, exported.bytes, {
				storeOptions: { backend: targetBackend },
			});
			expect(imported.draftFilesRestored).toEqual([
				'collations/col-1.working.json',
				'transcriptions/pt-1.working.json',
			]);
		} finally {
			await targetHarness.destroy();
		}
	});

	it('exports canonical store folders as independently restorable project zips when the index is stale', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		await createProject(harness.db, {
			id: 'project-2',
			storageSlug: 'john-c3d4',
			name: 'John',
		});
		await harness.db.deleteFrom('projects').where('id', '=', 'project-2').execute();

		const result = await exportAllProjectsZip(harness.db, {
			storeOptions,
			now: () => new Date('2026-07-07T09:00:00.000Z'),
		});

		expect(result.archives.map(archive => archive.fileName)).toEqual([
			'john-c3d4-2026-07-07.zip',
			'romans-a1b2-2026-07-07.zip',
		]);
		expect(result.invalidProjects).toEqual([]);

		const targetHarness = createLocalDbTestHarness();
		const targetBackend = new MemoryStoreBackend();
		try {
			await createProjectRepository(
				targetHarness.db,
				{ id: 'project-1', storageSlug: 'local-romans', name: 'Local Romans' },
				{ backend: targetBackend }
			);
			const modes: string[] = [];
			for (const archive of result.archives) {
				const imported = await importProjectZip(targetHarness.db, archive.bytes, {
					storeOptions: { backend: targetBackend },
					collisionMode: archive.fileName.startsWith('romans-a1b2-') ? 'replace' : undefined,
				});
				expect(imported.ok).toBe(true);
				modes.push(imported.mode);
			}
			expect(modes).toEqual(['created', 'replaced']);
			const copied = await importProjectZip(targetHarness.db, result.archives[0]!.bytes, {
				storeOptions: { backend: targetBackend },
				collisionMode: 'copy',
			});
			expect(copied.mode).toBe('copied');
			const restored = await targetHarness.db
				.selectFrom('projects')
				.select('id')
				.orderBy('id')
				.execute();
			expect(restored.map(project => project.id)).toEqual(
				expect.arrayContaining(['project-1', 'project-2', copied.projectId])
			);
		} finally {
			await targetHarness.destroy();
		}
	});

	it('reports invalid canonical project folders instead of silently omitting them', async () => {
		await writeProjectFile('broken-project', 'project.json', '{"not":"canonical"}');

		const result = await exportAllProjectsZip(harness.db, { storeOptions });

		expect(result.archives).toEqual([]);
		expect(result.invalidProjects).toEqual([
			expect.objectContaining({ storageSlug: 'broken-project', path: 'project.json' }),
		]);
	});

	it('rejects configured ZIP count and size limits instead of wrapping ZIP32 fields', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		await writeProjectFile('romans-a1b2', 'transcriptions/tx-1.tei.xml', '<TEI/>');

		await expect(
			exportProjectZip(harness.db, 'project-1', {
				storeOptions,
				zipLimits: { maxEntries: 1 },
			})
		).rejects.toThrow('ZIP entry count');
		await expect(
			exportProjectZip(harness.db, 'project-1', {
				storeOptions,
				zipLimits: { maxArchiveBytes: 32 },
			})
		).rejects.toThrow('ZIP archive size');
	});

	it('identifies zip export as the non-Chromium backup path', () => {
		expect(projectBackupCapabilityMessage(false)).toEqual({
			primaryAction: 'zip-export',
			message: zipExportBackupPathMessage,
		});
		expect(projectBackupCapabilityMessage(true).primaryAction).toBe('folder-sync');
	});
});

async function writeProjectFile(projectSlug: string, path: string, content: string): Promise<void> {
	await writeTextFileAtomic(
		joinStorePath(projectFolder(projectSlug), path),
		content,
		storeOptions
	);
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

function readZipEntryBytes(bytes: Uint8Array): Record<string, Uint8Array> {
	const decoder = new TextDecoder();
	const entries: Record<string, Uint8Array> = {};
	let offset = 0;
	while (offset < bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		if (view.getUint32(0, true) !== 0x04034b50) break;
		const size = view.getUint32(18, true);
		const pathLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const pathStart = offset + 30;
		const contentStart = pathStart + pathLength + extraLength;
		const path = decoder.decode(bytes.slice(pathStart, pathStart + pathLength));
		entries[path] = bytes.slice(contentStart, contentStart + size);
		offset = contentStart + size;
	}
	return entries;
}
