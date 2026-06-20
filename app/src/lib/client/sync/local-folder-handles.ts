const DB_NAME = 'apatosaurus-provider-handles';
const STORE_NAME = 'directory-handles';
const DB_VERSION = 1;

export async function persistLocalFolderHandle(
	connectionId: string,
	handle: FileSystemDirectoryHandle
): Promise<void> {
	const db = await openHandleDb();
	try {
		await writeStore(db, store => store.put(handle, connectionId));
	} finally {
		db.close();
	}
}

export async function loadLocalFolderHandle(
	connectionId: string
): Promise<FileSystemDirectoryHandle | null> {
	const db = await openHandleDb();
	try {
		return await readStore<FileSystemDirectoryHandle | null>(db, store => {
			const request = store.get(connectionId);
			request.onsuccess = () => undefined;
			return request;
		});
	} finally {
		db.close();
	}
}

export async function deleteLocalFolderHandle(connectionId: string): Promise<void> {
	const db = await openHandleDb();
	try {
		await writeStore(db, store => store.delete(connectionId));
	} finally {
		db.close();
	}
}

export async function hasLocalFolderReadWritePermission(
	handle: FileSystemDirectoryHandle,
	requestIfNeeded: boolean
): Promise<boolean> {
	const withPermission = handle as FileSystemDirectoryHandle & {
		queryPermission?: (descriptor: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
		requestPermission?: (descriptor: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
	};
	if (!withPermission.queryPermission) return false;
	const current = await withPermission.queryPermission({ mode: 'readwrite' });
	if (current === 'granted') return true;
	if (!requestIfNeeded || !withPermission.requestPermission) return false;
	return (await withPermission.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export function getDirectoryPicker():
	| ((options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>)
	| null {
	const maybeGlobal = globalThis as typeof globalThis & {
		showDirectoryPicker?: (options?: {
			mode?: 'read' | 'readwrite';
		}) => Promise<FileSystemDirectoryHandle>;
	};
	return maybeGlobal.showDirectoryPicker ?? null;
}

export function isLocalFolderProviderSupported(): boolean {
	return typeof indexedDB !== 'undefined' && getDirectoryPicker() !== null;
}

async function openHandleDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('Local folder handle storage is unavailable in this browser.');
	}
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Failed to open local folder storage.'));
	});
}

async function writeStore(
	db: IDBDatabase,
	operation: (store: IDBObjectStore) => IDBRequest
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Failed to update local folder storage.'));
		operation(tx.objectStore(STORE_NAME));
	});
}

async function readStore<T>(
	db: IDBDatabase,
	operation: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		tx.onerror = () => reject(tx.error ?? new Error('Failed to read local folder storage.'));
		const request = operation(tx.objectStore(STORE_NAME));
		request.onsuccess = () => resolve((request.result as T | undefined) ?? (null as T));
		request.onerror = () =>
			reject(request.error ?? new Error('Failed to read local folder storage.'));
	});
}
