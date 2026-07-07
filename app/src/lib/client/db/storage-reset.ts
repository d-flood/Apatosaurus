import { isOpfsSupported, openOriginPrivateFileSystemRoot } from '$lib/client/capabilities';
import {
	INDEX_DATABASE_DIRECTORY,
	INDEX_DATABASE_PREFIX,
	INDEX_SCHEMA_VERSION,
	LEGACY_INDEX_DATABASE_PREFIXES,
} from './schema-version.generated';

const LOCAL_DB_OPFS_PREFIXES = [INDEX_DATABASE_PREFIX, ...LEGACY_INDEX_DATABASE_PREFIXES];
const LOCAL_DB_IDB_DATABASES = [
	`${INDEX_DATABASE_PREFIX}${INDEX_SCHEMA_VERSION}-idb`,
	'apatosaurus-local-v1-idb',
];

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
	entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

type IndexedDbWithDatabases = IDBFactory & {
	databases?: () => Promise<Array<{ name?: string }>>;
};

export async function purgeLocalDbStorage(): Promise<void> {
	await Promise.allSettled([purgeLocalDbIndexedDbStorage(), purgeLocalDbOpfsStorage()]);
}

async function purgeLocalDbIndexedDbStorage(): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	const names = await getLocalIndexedDbNames();
	await Promise.allSettled(names.map(name => deleteIndexedDb(name)));
}

async function getLocalIndexedDbNames(): Promise<string[]> {
	const names = new Set(LOCAL_DB_IDB_DATABASES);
	const indexedDbWithDatabases = indexedDB as IndexedDbWithDatabases;
	if (typeof indexedDbWithDatabases.databases === 'function') {
		const databases = await indexedDbWithDatabases.databases().catch(() => []);
		for (const database of databases) {
			if (database.name && hasLocalDbPrefix(database.name)) names.add(database.name);
		}
	}
	return [...names];
}

function deleteIndexedDb(name: string): Promise<void> {
	return new Promise(resolve => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}

async function purgeLocalDbOpfsStorage(): Promise<void> {
	if (!isOpfsSupported()) return;
	const root = (await openOriginPrivateFileSystemRoot()) as DirectoryHandleWithEntries;
	if (typeof root.entries !== 'function') return;
	await purgeDirectoryEntriesWithPrefixes(root, LOCAL_DB_OPFS_PREFIXES);
	const indexDirectory = await getNestedDirectoryIfExists(root, INDEX_DATABASE_DIRECTORY);
	if (indexDirectory) await purgeDirectoryEntriesWithPrefixes(indexDirectory, [INDEX_DATABASE_PREFIX]);
}

async function purgeDirectoryEntriesWithPrefixes(
	directory: DirectoryHandleWithEntries,
	prefixes: readonly string[]
): Promise<void> {
	if (typeof directory.entries !== 'function') return;
	for await (const [name, handle] of directory.entries()) {
		if (!prefixes.some(prefix => name.startsWith(prefix))) continue;
		await directory
			.removeEntry(name, { recursive: handle.kind === 'directory' })
			.catch(() => undefined);
	}
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

function hasLocalDbPrefix(name: string): boolean {
	return LOCAL_DB_OPFS_PREFIXES.some(prefix => name.startsWith(prefix));
}

function isNotFoundError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: unknown }).name === 'NotFoundError'
	);
}
