const LEGACY_DJAZZKIT_IDB_DATABASES = ['djazzkit-idb'];
const LEGACY_DJAZZKIT_OPFS_PREFIX = 'djazzkit';
const LEGACY_DJAZZKIT_PURGE_MARKER = 'apatosaurus:legacy-djazzkit-purged';

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
	entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

export async function purgeLegacyDjazzkitStorage(): Promise<void> {
	if (hasLegacyDjazzkitPurgeMarker()) {
		console.debug('[local-db] legacy djazzkit purge skipped', { marker: LEGACY_DJAZZKIT_PURGE_MARKER });
		return;
	}

	let failed = false;
	let idbFound = 0;
	let opfsFound = 0;
	const startedAt = now();
	try {
		if (typeof indexedDB !== 'undefined') {
			const idbStartedAt = now();
			const idbNames = await getLegacyIndexedDbNames();
			idbFound = idbNames.length;
			await Promise.allSettled(idbNames.map((name) => deleteIndexedDb(name)));
			console.debug('[local-db] legacy djazzkit IndexedDB purge completed', {
				found: idbFound,
				elapsedMs: elapsed(idbStartedAt),
			});
		}
	} catch (error) {
		failed = true;
		console.warn('[local-db] failed to purge legacy djazzkit IndexedDB storage', error);
	}

	try {
		if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
			const opfsStartedAt = now();
			opfsFound = await deleteOpfsEntriesWithPrefix(LEGACY_DJAZZKIT_OPFS_PREFIX);
			console.debug('[local-db] legacy djazzkit OPFS purge completed', {
				found: opfsFound,
				elapsedMs: elapsed(opfsStartedAt),
			});
		}
	} catch (error) {
		failed = true;
		console.warn('[local-db] failed to purge legacy djazzkit OPFS storage', error);
	}
	if (!failed) setLegacyDjazzkitPurgeMarker();
	console.debug('[local-db] legacy djazzkit purge completed', {
		idbFound,
		opfsFound,
		markedComplete: !failed,
		elapsedMs: elapsed(startedAt),
	});
}

export function clearLegacyDjazzkitPurgeMarker(): void {
	try {
		globalThis.localStorage?.removeItem(LEGACY_DJAZZKIT_PURGE_MARKER);
	} catch {
		// Ignore storage access failures; the next startup can retry the purge.
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

async function deleteOpfsEntriesWithPrefix(prefix: string): Promise<number> {
	const root = (await navigator.storage.getDirectory()) as DirectoryHandleWithEntries;
	if (typeof root.entries !== 'function') return 0;
	let deleted = 0;
	for await (const [name, handle] of root.entries()) {
		if (!name.startsWith(prefix)) continue;
		await root.removeEntry(name, { recursive: handle.kind === 'directory' }).catch(() => undefined);
		deleted += 1;
	}
	return deleted;
}

function hasLegacyDjazzkitPurgeMarker(): boolean {
	try {
		return globalThis.localStorage?.getItem(LEGACY_DJAZZKIT_PURGE_MARKER) === '1';
	} catch {
		return false;
	}
}

function setLegacyDjazzkitPurgeMarker(): void {
	try {
		globalThis.localStorage?.setItem(LEGACY_DJAZZKIT_PURGE_MARKER, '1');
	} catch {
		// Ignore storage access failures; the marker is an optimization only.
	}
}

function now(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function elapsed(startedAt: number): number {
	return Math.round(now() - startedAt);
}
