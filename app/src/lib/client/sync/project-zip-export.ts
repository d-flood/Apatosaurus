import type { Kysely, Transaction } from 'kysely';

import type { Database } from '$lib/client/db/types.generated';
import { listProjects } from '$lib/client/db/repositories/projects';
import { joinStorePath, type StoreOperationOptions } from '$lib/client/store';
import { listProjectArchiveFiles, type ProjectArchiveFile } from './sync-manager';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface ProjectZipExportOptions {
	includeDrafts?: boolean;
	storeOptions?: StoreOperationOptions;
	now?: () => Date;
}

export interface ProjectZipExportResult {
	fileName: string;
	bytes: Uint8Array;
	entryPaths: string[];
	exportedAt: string;
}

export interface ProjectBackupCapabilityMessage {
	primaryAction: 'folder-sync' | 'zip-export';
	message: string;
}

interface ZipEntryInput {
	path: string;
	content: string;
}

const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

export async function exportProjectZip(
	db: DbExecutor,
	projectId: string,
	options: ProjectZipExportOptions = {}
): Promise<ProjectZipExportResult> {
	const project = await db
		.selectFrom('projects')
		.select(['id', 'storage_slug'])
		.where('id', '=', projectId)
		.executeTakeFirst();
	if (!project) throw new Error(`Project ${projectId} was not found.`);

	const archiveOptions = {
		includeDrafts: options.includeDrafts,
		storeOptions: options.storeOptions,
	};
	const files = await listProjectArchiveFiles(db, projectId, archiveOptions);
	const exportedAt = (options.now?.() ?? new Date()).toISOString();
	return {
		fileName: zipFileName(project.storage_slug, exportedAt),
		bytes: createStoreOnlyZip(files.map(file => ({ path: file.path, content: file.content }))),
		entryPaths: files.map(file => file.path),
		exportedAt,
	};
}

export async function exportAllProjectsZip(
	db: DbExecutor,
	options: ProjectZipExportOptions = {}
): Promise<ProjectZipExportResult> {
	const projects = await listProjects(db);
	const entries: ZipEntryInput[] = [];
	for (const project of projects.sort((left, right) => left.storageSlug.localeCompare(right.storageSlug))) {
		const files = await listProjectArchiveFiles(db, project.id, {
			includeDrafts: options.includeDrafts,
			storeOptions: options.storeOptions,
		});
		entries.push(
			...files.map(file => ({
				path: joinStorePath(project.storageSlug, file.path),
				content: file.content,
			}))
		);
	}
	const exportedAt = (options.now?.() ?? new Date()).toISOString();
	return {
		fileName: zipFileName('apatosaurus-projects', exportedAt),
		bytes: createStoreOnlyZip(entries),
		entryPaths: entries.map(entry => entry.path),
		exportedAt,
	};
}

export function projectBackupCapabilityMessage(
	folderSyncSupported: boolean
): ProjectBackupCapabilityMessage {
	if (folderSyncSupported) {
		return {
			primaryAction: 'folder-sync',
			message: 'Folder sync can mirror committed files continuously; zip export is also available.',
		};
	}
	return {
		primaryAction: 'zip-export',
		message: 'Folder sync is unavailable in this browser. Use zip export as your backup path.',
	};
}

function zipFileName(slug: string, exportedAt: string): string {
	return `${slug}-${exportedAt.slice(0, 10)}.zip`;
}

function createStoreOnlyZip(entries: ZipEntryInput[]): Uint8Array {
	const encoder = new TextEncoder();
	const fileRecords = entries.map(entry => {
		const pathBytes = encoder.encode(entry.path);
		const contentBytes = encoder.encode(entry.content);
		return {
			...entry,
			pathBytes,
			contentBytes,
			crc32: crc32(contentBytes),
		};
	});

	const chunks: Uint8Array[] = [];
	const centralDirectory: Uint8Array[] = [];
	let offset = 0;
	for (const entry of fileRecords) {
		const localHeader = localFileHeader(entry.pathBytes, entry.contentBytes, entry.crc32);
		chunks.push(localHeader, entry.pathBytes, entry.contentBytes);
		centralDirectory.push(
			centralDirectoryHeader(entry.pathBytes, entry.contentBytes, entry.crc32, offset)
		);
		offset += localHeader.length + entry.pathBytes.length + entry.contentBytes.length;
	}

	const centralDirectoryOffset = offset;
	const centralDirectorySize = centralDirectory.reduce((size, chunk) => size + chunk.length, 0);
	const end = endOfCentralDirectory(fileRecords.length, centralDirectorySize, centralDirectoryOffset);
	return concatUint8Arrays([...chunks, ...centralDirectory, end]);
}

function localFileHeader(pathBytes: Uint8Array, contentBytes: Uint8Array, crc: number): Uint8Array {
	const header = new Uint8Array(30);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x04034b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 0x0800, true);
	view.setUint16(8, 0, true);
	writeDosDateTime(view, 10);
	view.setUint32(14, crc, true);
	view.setUint32(18, contentBytes.length, true);
	view.setUint32(22, contentBytes.length, true);
	view.setUint16(26, pathBytes.length, true);
	return header;
}

function centralDirectoryHeader(
	pathBytes: Uint8Array,
	contentBytes: Uint8Array,
	crc: number,
	localHeaderOffset: number
): Uint8Array {
	const header = new Uint8Array(46 + pathBytes.length);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x02014b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 20, true);
	view.setUint16(8, 0x0800, true);
	view.setUint16(10, 0, true);
	writeDosDateTime(view, 12);
	view.setUint32(16, crc, true);
	view.setUint32(20, contentBytes.length, true);
	view.setUint32(24, contentBytes.length, true);
	view.setUint16(28, pathBytes.length, true);
	view.setUint32(42, localHeaderOffset, true);
	header.set(pathBytes, 46);
	return header;
}

function endOfCentralDirectory(
	entryCount: number,
	centralDirectorySize: number,
	centralDirectoryOffset: number
): Uint8Array {
	const end = new Uint8Array(22);
	const view = new DataView(end.buffer);
	view.setUint32(0, 0x06054b50, true);
	view.setUint16(8, entryCount, true);
	view.setUint16(10, entryCount, true);
	view.setUint32(12, centralDirectorySize, true);
	view.setUint32(16, centralDirectoryOffset, true);
	return end;
}

function writeDosDateTime(view: DataView, offset: number): void {
	const year = Math.max(ZIP_EPOCH.getUTCFullYear(), 1980);
	const dosTime = 0;
	const dosDate = ((year - 1980) << 9) | ((ZIP_EPOCH.getUTCMonth() + 1) << 5) | ZIP_EPOCH.getUTCDate();
	view.setUint16(offset, dosTime, true);
	view.setUint16(offset + 2, dosDate, true);
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
	const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}
