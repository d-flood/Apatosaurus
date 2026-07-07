import { openOriginPrivateFileSystemRoot as openOpfsRoot } from '$lib/client/capabilities';
import {
	INDEX_DATABASE_DIRECTORY,
	INDEX_DATABASE_FILENAME,
	INDEX_DATABASE_PREFIX,
	LEGACY_INDEX_DATABASE_PREFIXES,
} from './schema-version.generated';

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
	entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

export interface StaleIndexFileCleanupReport {
	removedPaths: string[];
	failedPaths: Array<{ path: string; error: string }>;
}

export interface CurrentIndexFileRemovalReport {
	removedPaths: string[];
	failedPaths: Array<{ path: string; error: string }>;
}

export async function cleanupStaleIndexFiles(
	rootHandle?: FileSystemDirectoryHandle
): Promise<StaleIndexFileCleanupReport> {
	const report: StaleIndexFileCleanupReport = { removedPaths: [], failedPaths: [] };
	const root = (rootHandle ?? (await openOriginPrivateFileSystemRoot())) as DirectoryHandleWithEntries;
	if (typeof root.entries !== 'function') return report;

	await removeMatchingEntries(root, '', isStaleRootIndexEntry, report);
	const indexDirectory = await getNestedDirectoryIfExists(root, INDEX_DATABASE_DIRECTORY);
	if (indexDirectory) {
		await removeMatchingEntries(
			indexDirectory,
			INDEX_DATABASE_DIRECTORY,
			isStaleNestedIndexEntry,
			report
		);
	}

	return report;
}

export async function removeCurrentIndexFiles(
	rootHandle?: FileSystemDirectoryHandle
): Promise<CurrentIndexFileRemovalReport> {
	const report: CurrentIndexFileRemovalReport = { removedPaths: [], failedPaths: [] };
	const root = (rootHandle ?? (await openOriginPrivateFileSystemRoot())) as DirectoryHandleWithEntries;
	const indexDirectory = await getNestedDirectoryIfExists(root, INDEX_DATABASE_DIRECTORY);
	if (!indexDirectory) return report;

	await removeMatchingEntries(
		indexDirectory,
		INDEX_DATABASE_DIRECTORY,
		name => name.startsWith(INDEX_DATABASE_FILENAME),
		report
	);
	return report;
}

async function removeMatchingEntries(
	directory: DirectoryHandleWithEntries,
	directoryPath: string,
	shouldRemove: (name: string) => boolean,
	report: StaleIndexFileCleanupReport
): Promise<void> {
	if (typeof directory.entries !== 'function') return;
	for await (const [name, handle] of directory.entries()) {
		if (!shouldRemove(name)) continue;
		const path = formatPath(directoryPath, name);
		try {
			await directory.removeEntry(name, { recursive: handle.kind === 'directory' });
			report.removedPaths.push(path);
		} catch (error) {
			report.failedPaths.push({ path, error: errorMessage(error) });
		}
	}
}

function isStaleRootIndexEntry(name: string): boolean {
	return (
		name.startsWith(INDEX_DATABASE_PREFIX) ||
		LEGACY_INDEX_DATABASE_PREFIXES.some(prefix => name.startsWith(prefix))
	);
}

function isStaleNestedIndexEntry(name: string): boolean {
	return name.startsWith(INDEX_DATABASE_PREFIX) && !name.startsWith(INDEX_DATABASE_FILENAME);
}

async function getNestedDirectoryIfExists(
	root: FileSystemDirectoryHandle,
	path: string
): Promise<DirectoryHandleWithEntries | null> {
	let current = root;
	try {
		for (const segment of path.split('/').filter(Boolean)) {
			current = await current.getDirectoryHandle(segment, { create: false });
		}
		return current as DirectoryHandleWithEntries;
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
}

async function openOriginPrivateFileSystemRoot(): Promise<FileSystemDirectoryHandle> {
	return openOpfsRoot();
}

function formatPath(directoryPath: string, name: string): string {
	return directoryPath ? `${directoryPath}/${name}` : name;
}

function isNotFoundError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: unknown }).name === 'NotFoundError'
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
