const LEGACY_DJAZZKIT_IDB_DATABASES = ['djazzkit-idb'];
const LEGACY_DJAZZKIT_OPFS_PREFIX = 'djazzkit';

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
	entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

export async function purgeLegacyDjazzkitStorage(): Promise<void> {
	try {
		if (typeof indexedDB !== 'undefined') {
			const idbNames = await getLegacyIndexedDbNames();
			await Promise.allSettled(idbNames.map((name) => deleteIndexedDb(name)));
		}
	} catch (error) {
		console.warn('[local-db] failed to purge legacy djazzkit IndexedDB storage', error);
	}

	try {
		if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
			await deleteOpfsEntriesWithPrefix(LEGACY_DJAZZKIT_OPFS_PREFIX);
		}
	} catch (error) {
		console.warn('[local-db] failed to purge legacy djazzkit OPFS storage', error);
	}
}

async function getLegacyIndexedDbNames(): Promise<string[]> {
	const names = new Set(LEGACY_DJAZZKIT_IDB_DATABASES);
	const indexedDbWithDatabases = indexedDB as IDBFactory & {
		databases?: () => Promise<Array<{ name?: string }>>;
	};
	if (typeof indexedDbWithDatabases.databases === 'function') {
		const databases = await indexedDbWithDatabases.databases().catch(() => []);
		for (const database of databases) {
			if (database.name?.startsWith('djazzkit')) names.add(database.name);
		}
	}
	return [...names];
}

function deleteIndexedDb(name: string): Promise<void> {
	return new Promise((resolve) => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}

async function deleteOpfsEntriesWithPrefix(prefix: string): Promise<void> {
	const root = (await navigator.storage.getDirectory()) as DirectoryHandleWithEntries;
	if (typeof root.entries !== 'function') return;
	for await (const [name, handle] of root.entries()) {
		if (!name.startsWith(prefix)) continue;
		await root.removeEntry(name, { recursive: handle.kind === 'directory' }).catch(() => undefined);
	}
}
