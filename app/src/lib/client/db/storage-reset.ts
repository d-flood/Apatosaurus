const LOCAL_DB_OPFS_PREFIX = 'apatosaurus-local-v1';
const LOCAL_DB_IDB_DATABASES = ['apatosaurus-local-v1-idb'];

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
			if (database.name?.startsWith(LOCAL_DB_OPFS_PREFIX)) names.add(database.name);
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
	if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function')
		return;
	const root = (await navigator.storage.getDirectory()) as DirectoryHandleWithEntries;
	if (typeof root.entries !== 'function') return;
	for await (const [name, handle] of root.entries()) {
		if (!name.startsWith(LOCAL_DB_OPFS_PREFIX)) continue;
		await root
			.removeEntry(name, { recursive: handle.kind === 'directory' })
			.catch(() => undefined);
	}
}
