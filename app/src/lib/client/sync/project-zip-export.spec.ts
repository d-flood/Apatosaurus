import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import {
	createCollationWithFiles,
	saveWorkingCollationMetadata,
} from '$lib/client/db/repositories/collation-files';
import { createProject as createProjectRepository } from '$lib/client/db/repositories/projects';
import {
	createTranscriptionWithFiles,
	saveWorkingTranscriptionMetadata,
} from '$lib/client/db/repositories/transcription-files';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import {
	listUserReferenceEditions,
	loadUserReferenceEditionXml,
	registerUserReferenceEdition,
} from '$lib/client/store/user-reference-editions';
import {
	InMemoryQuarantineReport,
	joinStorePath,
	projectFolder,
	readTextFile,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from '$lib/client/store';
import { zipExportBackupPathMessage } from '$lib/onboarding-guidance';
import {
	exportAllProjectsZip,
	exportProjectZip,
	createStoreOnlyZip,
	projectBackupCapabilityMessage,
} from './project-zip-export';
import { importProjectZip, restoreReferenceEditionsZip } from './project-zip-import';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
let storeOptions: StoreOperationOptions;

function editionXml(word = ''): string {
	return `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader/><text><body><div type="book" n="book"><ab n="1"><w>${word}</w></ab></div></body></text></TEI>`;
}

class ByteReadingMemoryStoreBackend extends MemoryStoreBackend {
	readonly byteOverrides = new Map<string, Uint8Array>();

	async readFileBytes(path: string): Promise<Uint8Array> {
		return (
			this.byteOverrides.get(path) ?? new TextEncoder().encode(await this.readTextFile(path))
		);
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

	it('excludes app-level user reference editions from a project archive', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		await writeProjectFile(
			'romans-a1b2',
			'transcriptions/tx-1.json',
			'{"referenceEditionsUsed":["user-licensed"]}'
		);
		await registerUserReferenceEdition(
			{ xml: editionXml(), fileName: 'licensed.xml' },
			{
				...storeOptions,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
					metadata: { title: 'Licensed edition', attribution: 'Private licence' },
				}),
			}
		);

		const result = await exportProjectZip(harness.db, 'project-1', { storeOptions });

		expect(result.entryPaths).toEqual(['project.json', 'transcriptions/tx-1.json']);
		expect([...backend.files.keys()]).toContainEqual(
			expect.stringMatching(/\/app\/reference-editions\/.+\.json$/)
		);
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
		await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-1',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-1',
				title: 'Witness 1',
				siglum: '01',
				document: { type: 'transcriptionDocument', pages: [] },
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			storeOptions
		);
		await saveWorkingTranscriptionMetadata(
			harness.db,
			{
				id: 'tx-1',
				title: 'Witness 1',
				siglum: '01',
				description: '',
				tags: [],
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			storeOptions
		);
		await createCollationWithFiles(
			harness.db,
			{
				id: 'col-1',
				projectId: 'project-1',
				title: 'Romans 1:1',
				verseIdentifier: 'Romans 1:1',
			},
			storeOptions
		);
		await saveWorkingCollationMetadata(
			harness.db,
			{ id: 'col-1', notes: 'Draft notes' },
			storeOptions
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
			expect(imported.ok, JSON.stringify(imported.quarantinedFiles)).toBe(true);
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
					collisionMode: archive.fileName.startsWith('romans-a1b2-')
						? 'replace'
						: undefined,
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

	it('exports and restores user editions while excluding bundled editions and project archives', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		const editions = [
			{ xml: editionXml('alpha'), title: 'Alpha edition' },
			{ xml: editionXml('beta'), title: 'Beta edition' },
		];
		for (const edition of editions) {
			await registerUserReferenceEdition(
				{ xml: edition.xml, fileName: `${edition.title}.xml` },
				{
					...storeOptions,
					parse: async () => ({
						source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
						metadata: { title: edition.title, attribution: 'Private licence' },
					}),
				}
			);
		}

		const exported = await exportAllProjectsZip(harness.db, { storeOptions });

		expect(exported.referenceEditionsArchive?.entryPaths).toHaveLength(2);
		expect(exported.referenceEditionsArchive?.entryPaths).toEqual([
			expect.stringMatching(/^reference-editions\/user-.+\.json$/),
			expect.stringMatching(/^reference-editions\/user-.+\.json$/),
		]);
		expect(exported.archives[0]?.entryPaths).toEqual(['project.json']);

		const targetBackend = new MemoryStoreBackend();
		const archive = exported.referenceEditionsArchive!;
		await expect(
			restoreReferenceEditionsZip(archive.bytes, { backend: targetBackend })
		).resolves.toEqual({ restored: 2, skipped: 0 });
		const restored = await listUserReferenceEditions({ backend: targetBackend });
		expect(restored.map(edition => edition.title)).toEqual(['Alpha edition', 'Beta edition']);
		await expect(
			loadUserReferenceEditionXml(restored[0]!, { backend: targetBackend })
		).resolves.toBe(editions[0]!.xml);
		await expect(
			restoreReferenceEditionsZip(archive.bytes, { backend: targetBackend })
		).resolves.toEqual({ restored: 0, skipped: 2 });
		await expect(listUserReferenceEditions({ backend: targetBackend })).resolves.toHaveLength(
			2
		);
	});

	it('does not overwrite a local edition with the same identity during restore', async () => {
		const xml = editionXml('same');
		await registerUserReferenceEdition(
			{ xml, fileName: 'remote.xml' },
			{
				...storeOptions,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
					metadata: { title: 'Remote title', attribution: 'Remote licence' },
				}),
			}
		);
		const exported = await exportAllProjectsZip(harness.db, { storeOptions });
		const targetBackend = new MemoryStoreBackend();
		await registerUserReferenceEdition(
			{ xml, fileName: 'local.xml' },
			{
				backend: targetBackend,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
					metadata: { title: 'Local title', attribution: 'Local licence' },
				}),
			}
		);

		await expect(
			restoreReferenceEditionsZip(exported.referenceEditionsArchive!.bytes, {
				backend: targetBackend,
			})
		).resolves.toEqual({ restored: 0, skipped: 1 });
		await expect(listUserReferenceEditions({ backend: targetBackend })).resolves.toEqual([
			expect.objectContaining({ title: 'Local title', attribution: 'Local licence' }),
		]);
	});

	it('validates every edition archive entry before restoring any files', async () => {
		for (const [title, word] of [
			['Alpha edition', 'alpha'],
			['Beta edition', 'beta'],
		] as const) {
			await registerUserReferenceEdition(
				{ xml: editionXml(word), fileName: `${word}.xml` },
				{
					...storeOptions,
					parse: async () => ({
						source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
						metadata: { title, attribution: 'Private licence' },
					}),
				}
			);
		}
		const exported = await exportAllProjectsZip(harness.db, { storeOptions });
		const bytes = exported.referenceEditionsArchive!.bytes.slice();
		corruptZipEntry(bytes, exported.referenceEditionsArchive!.entryPaths[1]!);
		const targetBackend = new MemoryStoreBackend();

		await expect(
			restoreReferenceEditionsZip(bytes, { backend: targetBackend })
		).rejects.toThrow();
		await expect(listUserReferenceEditions({ backend: targetBackend })).resolves.toEqual([]);
	});

	it.each([
		['empty input', new Uint8Array()],
		['non-ZIP input', new TextEncoder().encode('not a zip')],
	])('rejects %s as a reference-edition archive', async (_label, bytes) => {
		await expect(restoreReferenceEditionsZip(bytes, { backend })).rejects.toThrow(/ZIP/i);
		await expect(listUserReferenceEditions({ backend })).resolves.toEqual([]);
	});

	it('rejects an empty ZIP and trailing archive garbage', async () => {
		await expect(
			restoreReferenceEditionsZip(createStoreOnlyZip([]), { backend })
		).rejects.toThrow('at least one edition');

		await registerUserReferenceEdition(
			{ xml: editionXml('alpha'), fileName: 'alpha.xml' },
			{
				...storeOptions,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
					metadata: { title: 'Alpha', attribution: 'Private licence' },
				}),
			}
		);
		const archive = (await exportAllProjectsZip(harness.db, { storeOptions }))
			.referenceEditionsArchive!;
		const withGarbage = new Uint8Array(archive.bytes.length + 1);
		withGarbage.set(archive.bytes);
		withGarbage[withGarbage.length - 1] = 1;

		await expect(
			restoreReferenceEditionsZip(withGarbage, { backend: new MemoryStoreBackend() })
		).rejects.toThrow('trailing data');
	});

	it('rejects a self-consistent stored edition whose TEI has no milestones', async () => {
		const edition = await registerUserReferenceEdition(
			{
				xml: '<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader/><text><body><pb n="1"/><cb n="1"/><lb n="1"/><w>text</w></body></text></TEI>',
				fileName: 'invalid.xml',
			},
			{
				...storeOptions,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: 'fake' }, content: [] }] },
					metadata: { title: 'Invalid', attribution: 'Private licence' },
				}),
			}
		);
		const raw = await readTextFile(edition.storePath!, storeOptions);
		const archive = createStoreOnlyZip([
			{
				path: `reference-editions/${edition.id}.json`,
				bytes: new TextEncoder().encode(raw),
			},
		]);
		const targetBackend = new MemoryStoreBackend();

		await expect(
			restoreReferenceEditionsZip(archive, { backend: targetBackend })
		).rejects.toThrow('at least one milestone');
		await expect(listUserReferenceEditions({ backend: targetBackend })).resolves.toEqual([]);
	});

	it('rolls back every edition after a deterministic mid-write failure', async () => {
		for (const word of ['alpha', 'beta']) {
			await registerUserReferenceEdition(
				{ xml: editionXml(word), fileName: `${word}.xml` },
				{
					...storeOptions,
					parse: async () => ({
						source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
						metadata: { title: word, attribution: 'Private licence' },
					}),
				}
			);
		}
		const archive = (await exportAllProjectsZip(harness.db, { storeOptions }))
			.referenceEditionsArchive!;
		const targetBackend = new MemoryStoreBackend();
		targetBackend.failWritePathIncludesOnce = archive.entryPaths[1]!.split('/').at(-1)!;

		await expect(
			restoreReferenceEditionsZip(archive.bytes, { backend: targetBackend })
		).rejects.toThrow('simulated write failure');
		await expect(listUserReferenceEditions({ backend: targetBackend })).resolves.toEqual([]);
		expect(
			[...targetBackend.files.keys()].filter(path =>
				/reference-editions\/user-.+\.json$/.test(path)
			)
		).toEqual([]);
	});

	it('refuses to export a corrupt canonical edition envelope', async () => {
		const edition = await registerUserReferenceEdition(
			{ xml: editionXml('alpha'), fileName: 'alpha.xml' },
			{
				...storeOptions,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
					metadata: { title: 'Alpha edition', attribution: 'Private licence' },
				}),
			}
		);
		await writeTextFileAtomic(edition.storePath!, '{"corrupt":true}', storeOptions);

		await expect(exportAllProjectsZip(harness.db, { storeOptions })).rejects.toThrow();
	});

	it('quarantines and replaces a corrupt local edition from a valid backup', async () => {
		const source = await registerUserReferenceEdition(
			{ xml: editionXml('alpha'), fileName: 'alpha.xml' },
			{
				...storeOptions,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
					metadata: { title: 'Alpha edition', attribution: 'Private licence' },
				}),
			}
		);
		const exported = await exportAllProjectsZip(harness.db, { storeOptions });
		const targetBackend = new MemoryStoreBackend();
		const quarantineSink = new InMemoryQuarantineReport();
		await writeTextFileAtomic(source.storePath!, '{"corrupt":true}', {
			backend: targetBackend,
		});

		await expect(
			restoreReferenceEditionsZip(exported.referenceEditionsArchive!.bytes, {
				backend: targetBackend,
				quarantineSink,
			})
		).resolves.toEqual({ restored: 1, skipped: 0 });
		await expect(listUserReferenceEditions({ backend: targetBackend })).resolves.toEqual([
			expect.objectContaining({ id: source.id, title: 'Alpha edition' }),
		]);
		expect(quarantineSink.list()).toEqual([
			expect.objectContaining({ path: source.storePath, code: 'invalid_shape' }),
		]);
		const quarantined = [...targetBackend.files.entries()].filter(([path]) =>
			path.includes('/reference-editions/quarantine/')
		);
		expect(quarantined).toHaveLength(1);
		expect(quarantined[0]?.[1]).toBe('{"corrupt":true}');
	});

	it('keeps the whole-account output unchanged when there are no user editions', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});

		const direct = await exportProjectZip(harness.db, 'project-1', { storeOptions });
		const wholeAccount = await exportAllProjectsZip(harness.db, { storeOptions });

		expect(wholeAccount.referenceEditionsArchive).toBeNull();
		expect(wholeAccount.archives[0]?.entryPaths).toEqual(direct.entryPaths);
		expect(wholeAccount.archives[0]?.bytes).toEqual(direct.bytes);
	});

	it('exports an empty account without adding an edition archive', async () => {
		await expect(exportAllProjectsZip(harness.db, { storeOptions })).resolves.toEqual({
			archives: [],
			referenceEditionsArchive: null,
			invalidProjects: [],
			exportedAt: expect.any(String),
		});
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

function corruptZipEntry(bytes: Uint8Array, targetPath: string): void {
	const decoder = new TextDecoder();
	let offset = 0;
	while (offset + 30 <= bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		if (view.getUint32(0, true) !== 0x04034b50) break;
		const size = view.getUint32(18, true);
		const pathLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const pathStart = offset + 30;
		const contentStart = pathStart + pathLength + extraLength;
		const path = decoder.decode(bytes.slice(pathStart, pathStart + pathLength));
		if (path === targetPath) {
			bytes[contentStart] = 'x'.charCodeAt(0);
			return;
		}
		offset = contentStart + size;
	}
	throw new Error(`ZIP entry not found: ${targetPath}`);
}
