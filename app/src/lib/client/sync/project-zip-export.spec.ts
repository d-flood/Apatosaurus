import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createProject } from '$lib/client/db/repositories/projects';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { joinStorePath, projectFolder, writeTextFileAtomic, type StoreOperationOptions } from '$lib/client/store';
import { zipExportBackupPathMessage } from '$lib/onboarding-guidance';
import {
	exportAllProjectsZip,
	exportProjectZip,
	projectBackupCapabilityMessage,
} from './project-zip-export';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
let storeOptions: StoreOperationOptions;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	storeOptions = { backend };
});

afterEach(async () => {
	await harness.destroy();
});

describe('project zip export', () => {
	it('exports committed project files byte-for-byte without working files by default', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'romans-a1b2',
			name: 'Romans',
		});
		await writeProjectFile('romans-a1b2', 'project.json', '{"format":"manifest"}');
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
			'project.json': '{"format":"manifest"}',
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
		await writeProjectFile('romans-a1b2', 'project.json', '{"format":"manifest"}');
		await writeProjectFile('romans-a1b2', 'collations/col-1.working.json', '{"draft":true}');
		await writeTextFileAtomic('app/settings.json', '{"local":true}', storeOptions);

		const result = await exportProjectZip(harness.db, 'project-1', {
			includeDrafts: true,
			storeOptions,
		});

		expect(result.entryPaths).toEqual(['collations/col-1.working.json', 'project.json']);
		expect(readZipEntries(result.bytes)).toEqual({
			'collations/col-1.working.json': '{"draft":true}',
			'project.json': '{"format":"manifest"}',
		});
	});

	it('exports all projects under top-level storage-slug directories', async () => {
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
		await writeProjectFile('romans-a1b2', 'project.json', '{"id":"project-1"}');
		await writeProjectFile('john-c3d4', 'project.json', '{"id":"project-2"}');

		const result = await exportAllProjectsZip(harness.db, {
			storeOptions,
			now: () => new Date('2026-07-07T09:00:00.000Z'),
		});

		expect(result.fileName).toBe('apatosaurus-projects-2026-07-07.zip');
		expect(readZipEntries(result.bytes)).toEqual({
			'john-c3d4/project.json': '{"id":"project-2"}',
			'romans-a1b2/project.json': '{"id":"project-1"}',
		});
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
	await writeTextFileAtomic(joinStorePath(projectFolder(projectSlug), path), content, storeOptions);
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
