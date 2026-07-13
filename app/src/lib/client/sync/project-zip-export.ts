import type { Kysely, Transaction } from 'kysely';

import type { Database } from '$lib/client/db/types.generated';
import {
	PROJECT_MANIFEST_FORMAT,
	listDirectory,
	projectFolder,
	projectsFolder,
	readCanonicalDocument,
	readFileBytes,
	readTextFile,
	type ProjectManifestPayload,
	type StoreOperationOptions,
} from '$lib/client/store';
import { zipExportBackupPathMessage } from '$lib/onboarding-guidance';
import { listProjectArchiveFilePaths } from './sync-manager';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface ProjectZipExportOptions {
	includeDrafts?: boolean;
	storeOptions?: StoreOperationOptions;
	now?: () => Date;
	zipLimits?: Partial<ZipLimits>;
}

export interface ProjectZipExportResult {
	storageSlug: string;
	fileName: string;
	bytes: Uint8Array;
	entryPaths: string[];
	exportedAt: string;
}

export interface InvalidProjectExport {
	storageSlug: string;
	path: string;
	code: string;
	message: string;
}

export interface AllProjectsZipExportResult {
	archives: ProjectZipExportResult[];
	invalidProjects: InvalidProjectExport[];
	exportedAt: string;
}

export interface ProjectBackupCapabilityMessage {
	primaryAction: 'folder-sync' | 'zip-export';
	message: string;
}

interface ZipEntryInput {
	path: string;
	bytes: Uint8Array;
}

interface ZipLimits {
	maxEntries: number;
	maxEntryBytes: number;
	maxArchiveBytes: number;
}

const ZIP32_MAX_ENTRIES = 0xffff;
const ZIP32_MAX_VALUE = 0xffffffff;
const DEFAULT_ZIP_LIMITS: ZipLimits = {
	maxEntries: ZIP32_MAX_ENTRIES,
	maxEntryBytes: ZIP32_MAX_VALUE,
	// The worker RPC returns one Uint8Array, so fail clearly before a browser-hostile allocation.
	maxArchiveBytes: 512 * 1024 * 1024,
};

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

	const root = projectFolder(project.storage_slug);
	const manifestValidation = await validateProjectManifest(project.storage_slug, options.storeOptions);
	if (manifestValidation) throw new Error(manifestValidation.message);
	const entries = await readProjectArchiveEntries(root, options);
	const exportedAt = (options.now?.() ?? new Date()).toISOString();
	return {
		storageSlug: project.storage_slug,
		fileName: zipFileName(project.storage_slug, exportedAt),
		bytes: createStoreOnlyZip(entries, options.zipLimits),
		entryPaths: entries.map(entry => entry.path),
		exportedAt,
	};
}

export async function exportAllProjectsZip(
	_db: DbExecutor,
	options: ProjectZipExportOptions = {}
): Promise<AllProjectsZipExportResult> {
	const exportedAt = (options.now?.() ?? new Date()).toISOString();
	const archives: ProjectZipExportResult[] = [];
	const invalidProjects: InvalidProjectExport[] = [];
	let totalArchiveBytes = 0;
	let projectDirectories;
	try {
		projectDirectories = (await listDirectory(projectsFolder(), options.storeOptions)).filter(
			entry => entry.kind === 'directory'
		);
	} catch (error) {
		if (isMissingStoreEntryError(error)) return { archives, invalidProjects, exportedAt };
		throw error;
	}
	for (const directory of projectDirectories) {
		const invalid = await validateProjectManifest(directory.name, options.storeOptions);
		if (invalid) {
			invalidProjects.push(invalid);
			continue;
		}
		const entries = await readProjectArchiveEntries(directory.path, options);
		const bytes = createStoreOnlyZip(entries, options.zipLimits);
		totalArchiveBytes += bytes.length;
		const totalLimit = options.zipLimits?.maxArchiveBytes ?? DEFAULT_ZIP_LIMITS.maxArchiveBytes;
		if (totalArchiveBytes > totalLimit) {
			throw new Error(
				`Whole-account ZIP archive size ${totalArchiveBytes} exceeds the supported limit ${totalLimit}.`
			);
		}
		archives.push({
			storageSlug: directory.name,
			fileName: zipFileName(directory.name, exportedAt),
			bytes,
			entryPaths: entries.map(entry => entry.path),
			exportedAt,
		});
	}
	return { archives, invalidProjects, exportedAt };
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
		message: zipExportBackupPathMessage,
	};
}

function zipFileName(slug: string, exportedAt: string): string {
	return `${slug}-${exportedAt.slice(0, 10)}.zip`;
}

async function readProjectArchiveEntries(
	root: string,
	options: ProjectZipExportOptions
): Promise<ZipEntryInput[]> {
	const files = await listProjectArchiveFilePaths(root, {
		includeDrafts: options.includeDrafts,
		storeOptions: options.storeOptions,
	});
	const entries: ZipEntryInput[] = [];
	for (const file of files) {
		entries.push({ path: file.path, bytes: await readFileBytes(file.storePath, options.storeOptions) });
	}
	return entries;
}

async function validateProjectManifest(
	storageSlug: string,
	storeOptions: StoreOperationOptions = {}
): Promise<InvalidProjectExport | null> {
	const path = 'project.json';
	try {
		const raw = await readTextFile(`${projectFolder(storageSlug)}/${path}`, storeOptions);
		const parsed = await readCanonicalDocument<ProjectManifestPayload>(PROJECT_MANIFEST_FORMAT, raw, {
			projectPath: path,
		});
		if (parsed.ok) return null;
		return {
			storageSlug,
			path,
			code: parsed.quarantine.code,
			message: parsed.quarantine.message,
		};
	} catch (error) {
		return {
			storageSlug,
			path,
			code: 'missing_manifest',
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function createStoreOnlyZip(
	entries: ZipEntryInput[],
	configuredLimits: Partial<ZipLimits> = {}
): Uint8Array {
	const encoder = new TextEncoder();
	const limits = { ...DEFAULT_ZIP_LIMITS, ...configuredLimits };
	if (entries.length > Math.min(limits.maxEntries, ZIP32_MAX_ENTRIES)) {
		throw new Error(`ZIP entry count ${entries.length} exceeds the supported limit ${limits.maxEntries}.`);
	}
	const fileRecords = entries.map(entry => {
		const pathBytes = encoder.encode(entry.path);
		if (pathBytes.length > 0xffff) throw new Error(`ZIP entry path is too long: ${entry.path}.`);
		if (entry.bytes.length > Math.min(limits.maxEntryBytes, ZIP32_MAX_VALUE)) {
			throw new Error(
				`ZIP entry ${entry.path} size ${entry.bytes.length} exceeds the supported limit ${limits.maxEntryBytes}.`
			);
		}
		return {
			...entry,
			pathBytes,
			crc32: crc32(entry.bytes),
		};
	});

	let localSize = 0;
	let centralDirectorySize = 0;
	for (const entry of fileRecords) {
		localSize += 30 + entry.pathBytes.length + entry.bytes.length;
		centralDirectorySize += 46 + entry.pathBytes.length;
	}
	const totalSize = localSize + centralDirectorySize + 22;
	if (localSize > ZIP32_MAX_VALUE || centralDirectorySize > ZIP32_MAX_VALUE) {
		throw new Error('ZIP32 offset or central directory size limit exceeded.');
	}
	if (totalSize > limits.maxArchiveBytes) {
		throw new Error(`ZIP archive size ${totalSize} exceeds the supported limit ${limits.maxArchiveBytes}.`);
	}

	const result = new Uint8Array(totalSize);
	const localOffsets: number[] = [];
	let offset = 0;
	for (const entry of fileRecords) {
		localOffsets.push(offset);
		const header = localFileHeader(entry.pathBytes, entry.bytes, entry.crc32);
		result.set(header, offset);
		offset += header.length;
		result.set(entry.pathBytes, offset);
		offset += entry.pathBytes.length;
		result.set(entry.bytes, offset);
		offset += entry.bytes.length;
	}
	const centralDirectoryOffset = offset;
	for (const [index, entry] of fileRecords.entries()) {
		const header = centralDirectoryHeader(entry.pathBytes, entry.bytes, entry.crc32, localOffsets[index]!);
		result.set(header, offset);
		offset += header.length;
	}
	result.set(endOfCentralDirectory(fileRecords.length, centralDirectorySize, centralDirectoryOffset), offset);
	return result;
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

function isMissingStoreEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
