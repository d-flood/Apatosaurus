import {
	openOriginPrivateFileSystemRoot as openOpfsRoot,
	requestPersistentStorageForMeaningfulWrite,
} from '$lib/client/capabilities';
import {
	APP_STORE_ROOT,
	joinStorePath,
	normalizeStoreFilePath,
	normalizeStorePath,
	storePathBasename,
	storePathDirname,
} from './layout';
import type { StoreQuarantineSink } from './quarantine';

export type StoreEntryKind = 'file' | 'directory';

export interface StoreDirectoryEntry {
	name: string;
	kind: StoreEntryKind;
	path: string;
}

export interface StoreBackendDirectoryEntry {
	name: string;
	kind: StoreEntryKind;
}

export interface StoreBackend {
	readTextFile(path: string): Promise<string>;
	readFileBytes?(path: string): Promise<Uint8Array>;
	writeTextFile(path: string, content: string): Promise<void>;
	replaceTextFile?(path: string, content: string): Promise<void>;
	deleteFile(path: string): Promise<void>;
	deleteDirectory?(path: string, options?: { recursive?: boolean }): Promise<void>;
	listDirectory(path: string): Promise<StoreBackendDirectoryEntry[]>;
	ensureDirectory(path: string): Promise<void>;
	moveFile?(fromPath: string, toPath: string): Promise<void>;
}

export interface StoreOperationOptions {
	backend?: StoreBackend;
	nonce?: () => string;
	quarantineSink?: StoreQuarantineSink;
	/** Set only by withDocumentStoreWriterLock callbacks to avoid reacquiring the same Web Lock. */
	writerLockHeld?: boolean;
}

interface SyncAccessHandle {
	write(buffer: BufferSource, options?: { at?: number }): number;
	truncate(size: number): void;
	flush(): void;
	close(): void;
}

type SyncAccessFileHandle = FileSystemFileHandle & {
	createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
	move?: (
		...args: [newName: string] | [targetDirectory: FileSystemDirectoryHandle, newName?: string]
	) => Promise<void>;
};

export class StoreMoveUnavailableError extends Error {
	constructor() {
		super('FileSystemFileHandle.move() is unavailable.');
		this.name = 'StoreMoveUnavailableError';
	}
}

let defaultBackendPromise: Promise<StoreBackend> | null = null;
let storeMutationQueue: Promise<void> = Promise.resolve();

export const STORE_WRITER_LOCK_NAME = 'apatosaurus:document-store-writer';

export async function readTextFile(
	path: string,
	options: StoreOperationOptions = {}
): Promise<string> {
	const backend = await resolveBackend(options);
	return backend.readTextFile(toBackendPath(normalizeStoreFilePath(path)));
}

export async function readFileBytes(
	path: string,
	options: StoreOperationOptions = {}
): Promise<Uint8Array> {
	const backend = await resolveBackend(options);
	const backendPath = toBackendPath(normalizeStoreFilePath(path));
	if (backend.readFileBytes) return backend.readFileBytes(backendPath);
	return new TextEncoder().encode(await backend.readTextFile(backendPath));
}

export async function writeTextFileAtomic(
	path: string,
	content: string,
	options: StoreOperationOptions = {}
): Promise<void> {
	return options.writerLockHeld
		? writeTextFileAtomicUnlocked(path, content, options)
		: runStoreMutation(() => writeTextFileAtomicUnlocked(path, content, options));
}

async function writeTextFileAtomicUnlocked(
	path: string,
	content: string,
	options: StoreOperationOptions
): Promise<void> {
	const backend = await resolveBackend(options);
	const targetPath = normalizeStoreFilePath(path);
	const parentPath = storePathDirname(targetPath);
	const fileName = storePathBasename(targetPath);
	const tempPath = joinStorePath(
		parentPath,
		`${fileName}.tmp-${(options.nonce ?? createNonce)()}`
	);
	const targetBackendPath = toBackendPath(targetPath);
	const tempBackendPath = toBackendPath(tempPath);

	await backend.ensureDirectory(toBackendPath(parentPath));
	await backend.writeTextFile(tempBackendPath, content);
	await assertTextMatches(backend, tempBackendPath, content, `Temporary file ${tempPath}`);

	try {
		await moveBackendFile(backend, tempBackendPath, targetBackendPath);
		if (!options.backend) void requestPersistentStorageForMeaningfulWrite();
		return;
	} catch (error) {
		if (!(error instanceof StoreMoveUnavailableError) && !isUnsupportedMoveError(error))
			throw error;
	}

	if (!backend.replaceTextFile) {
		throw new Error('Store backend cannot transactionally replace files without move().');
	}
	await backend.replaceTextFile(targetBackendPath, content);
	await assertTextMatches(backend, targetBackendPath, content, `Target file ${targetPath}`);
	await deleteTempFile(backend, tempBackendPath);
	if (!options.backend) void requestPersistentStorageForMeaningfulWrite();
}

export async function deleteFile(path: string, options: StoreOperationOptions = {}): Promise<void> {
	const operation = async () => {
		const backend = await resolveBackend(options);
		await backend.deleteFile(toBackendPath(normalizeStoreFilePath(path)));
	};
	await (options.writerLockHeld ? operation() : runStoreMutation(operation));
}

export async function deleteDirectory(
	path: string,
	options: StoreOperationOptions & { recursive?: boolean } = {}
): Promise<void> {
	const operation = async () => {
		const backend = await resolveBackend(options);
		const normalizedPath = normalizeStorePath(path);
		if (!normalizedPath) throw new Error('Store directory path is required.');
		if (!backend.deleteDirectory) throw new Error('Store backend cannot delete directories.');
		await backend.deleteDirectory(toBackendPath(normalizedPath), {
			recursive: options.recursive,
		});
	};
	await (options.writerLockHeld ? operation() : runStoreMutation(operation));
}

export async function listDirectory(
	path = '',
	options: StoreOperationOptions = {}
): Promise<StoreDirectoryEntry[]> {
	const backend = await resolveBackend(options);
	const normalizedPath = normalizeStorePath(path);
	const entries = await backend.listDirectory(toBackendPath(normalizedPath));
	return entries
		.map(entry => ({
			...entry,
			path: joinStorePath(normalizedPath, entry.name),
		}))
		.sort((left, right) => left.path.localeCompare(right.path));
}

export async function ensureDirectory(
	path = '',
	options: StoreOperationOptions = {}
): Promise<void> {
	const backend = await resolveBackend(options);
	await backend.ensureDirectory(toBackendPath(normalizeStorePath(path)));
}

export async function moveFile(
	fromPath: string,
	toPath: string,
	options: StoreOperationOptions = {}
): Promise<void> {
	return options.writerLockHeld
		? moveFileUnlocked(fromPath, toPath, options)
		: runStoreMutation(() => moveFileUnlocked(fromPath, toPath, options));
}

export async function withDocumentStoreWriterLock<T>(
	operation: (options: StoreOperationOptions) => Promise<T>,
	options: StoreOperationOptions = {}
): Promise<T> {
	return runStoreMutation(() => operation({ ...options, writerLockHeld: true }));
}

async function moveFileUnlocked(
	fromPath: string,
	toPath: string,
	options: StoreOperationOptions
): Promise<void> {
	const backend = await resolveBackend(options);
	const fromBackendPath = toBackendPath(normalizeStoreFilePath(fromPath));
	const toBackendPathValue = toBackendPath(normalizeStoreFilePath(toPath));
	try {
		await moveBackendFile(backend, fromBackendPath, toBackendPathValue);
		return;
	} catch (error) {
		if (!(error instanceof StoreMoveUnavailableError) && !isUnsupportedMoveError(error))
			throw error;
	}
	const content = await backend.readTextFile(fromBackendPath);
	await backend.ensureDirectory(storePathDirname(toBackendPathValue));
	if (!backend.replaceTextFile) {
		throw new Error('Store backend cannot transactionally replace files without move().');
	}
	await backend.replaceTextFile(toBackendPathValue, content);
	await assertTextMatches(backend, toBackendPathValue, content, `Moved file ${toPath}`);
	await backend.deleteFile(fromBackendPath);
}

export async function createOpfsStoreBackend(
	rootHandle?: FileSystemDirectoryHandle
): Promise<StoreBackend> {
	const opfsRoot = rootHandle ?? (await openOriginPrivateFileSystemRoot());
	return new OpfsStoreBackend(opfsRoot);
}

export function resetDefaultStoreBackendForTests(): void {
	defaultBackendPromise = null;
}

function toBackendPath(path: string): string {
	return joinStorePath(APP_STORE_ROOT, path);
}

async function runStoreMutation<T>(operation: () => Promise<T>): Promise<T> {
	const locks = globalThis.navigator?.locks;
	if (locks) return locks.request(STORE_WRITER_LOCK_NAME, operation);

	const result = storeMutationQueue.then(operation, operation);
	storeMutationQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

async function resolveBackend(options: StoreOperationOptions): Promise<StoreBackend> {
	if (options.backend) return options.backend;
	if (!defaultBackendPromise) defaultBackendPromise = createOpfsStoreBackend();
	return defaultBackendPromise;
}

async function moveBackendFile(
	backend: StoreBackend,
	fromBackendPath: string,
	toBackendPathValue: string
): Promise<void> {
	if (!backend.moveFile) throw new StoreMoveUnavailableError();
	await backend.ensureDirectory(storePathDirname(toBackendPathValue));
	await backend.moveFile(fromBackendPath, toBackendPathValue);
}

function isUnsupportedMoveError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'NotSupportedError';
}

async function assertTextMatches(
	backend: StoreBackend,
	path: string,
	expectedContent: string,
	label: string
): Promise<void> {
	const [expectedHash, actualHash] = await Promise.all([
		hashText(expectedContent),
		backend.readTextFile(path).then(hashText),
	]);
	if (expectedHash !== actualHash) {
		throw new Error(`${label} hash verification failed.`);
	}
}

async function deleteTempFile(backend: StoreBackend, tempBackendPath: string): Promise<void> {
	try {
		await backend.deleteFile(tempBackendPath);
	} catch (error) {
		console.warn('[document-store] Could not delete temporary file.', error);
	}
}

async function openOriginPrivateFileSystemRoot(): Promise<FileSystemDirectoryHandle> {
	return openOpfsRoot();
}

async function hashText(content: string): Promise<string> {
	const digest = await globalThis.crypto?.subtle?.digest(
		'SHA-256',
		new TextEncoder().encode(content)
	);
	if (!digest) throw new Error('SHA-256 hashing requires Web Crypto support.');
	return `sha256:${[...new Uint8Array(digest)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')}`;
}

function createNonce(): string {
	const bytes = new Uint8Array(12);
	globalThis.crypto?.getRandomValues(bytes);
	if (!globalThis.crypto) {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	}
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

class OpfsStoreBackend implements StoreBackend {
	constructor(private readonly root: FileSystemDirectoryHandle) {}

	async readTextFile(path: string): Promise<string> {
		const handle = await this.requireFileHandle(path);
		return (await handle.getFile()).text();
	}

	async readFileBytes(path: string): Promise<Uint8Array> {
		const handle = await this.requireFileHandle(path);
		return new Uint8Array(await (await handle.getFile()).arrayBuffer());
	}

	async writeTextFile(path: string, content: string): Promise<void> {
		const parent = await this.ensureParentDirectory(path);
		const handle = await parent.getFileHandle(storePathBasename(path), { create: true });
		await writeFileHandle(handle, content);
	}

	async replaceTextFile(path: string, content: string): Promise<void> {
		const parent = await this.ensureParentDirectory(path);
		const handle = await parent.getFileHandle(storePathBasename(path), { create: true });
		await replaceFileHandle(handle, content);
	}

	async deleteFile(path: string): Promise<void> {
		const parent = await this.requireDirectory(storePathDirname(path));
		await parent.removeEntry(storePathBasename(path));
	}

	async deleteDirectory(path: string, options: { recursive?: boolean } = {}): Promise<void> {
		const parent = await this.requireDirectory(storePathDirname(path));
		await parent.removeEntry(storePathBasename(path), { recursive: options.recursive });
	}

	async listDirectory(path: string): Promise<StoreBackendDirectoryEntry[]> {
		const directory = await this.requireDirectory(path);
		const entries: StoreBackendDirectoryEntry[] = [];
		for await (const [name, handle] of directory.entries()) {
			entries.push({ name, kind: handle.kind });
		}
		return entries;
	}

	async ensureDirectory(path: string): Promise<void> {
		await this.ensureDirectoryHandle(path);
	}

	async moveFile(fromPath: string, toPath: string): Promise<void> {
		const source = (await this.requireFileHandle(fromPath)) as SyncAccessFileHandle;
		if (typeof source.move !== 'function') throw new StoreMoveUnavailableError();
		const fromParent = storePathDirname(fromPath);
		const toParent = storePathDirname(toPath);
		const toName = storePathBasename(toPath);
		if (fromParent === toParent) {
			await source.move(toName);
			return;
		}
		const targetDirectory = await this.ensureDirectoryHandle(toParent);
		await source.move(targetDirectory, toName);
	}

	private async ensureParentDirectory(path: string): Promise<FileSystemDirectoryHandle> {
		return this.ensureDirectoryHandle(storePathDirname(path));
	}

	private async requireFileHandle(path: string): Promise<FileSystemFileHandle> {
		const parent = await this.requireDirectory(storePathDirname(path));
		return parent.getFileHandle(storePathBasename(path), { create: false });
	}

	private async requireDirectory(path: string): Promise<FileSystemDirectoryHandle> {
		const normalizedPath = normalizeStorePath(path);
		if (!normalizedPath) return this.root;
		let current = this.root;
		for (const segment of normalizedPath.split('/')) {
			current = await current.getDirectoryHandle(segment, { create: false });
		}
		return current;
	}

	private async ensureDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle> {
		const normalizedPath = normalizeStorePath(path);
		if (!normalizedPath) return this.root;
		let current = this.root;
		for (const segment of normalizedPath.split('/')) {
			current = await current.getDirectoryHandle(segment, { create: true });
		}
		return current;
	}
}

async function writeFileHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
	const syncHandleFactory = (handle as SyncAccessFileHandle).createSyncAccessHandle;
	if (typeof syncHandleFactory === 'function') {
		const syncHandle = await syncHandleFactory.call(handle);
		try {
			const bytes = new TextEncoder().encode(content);
			syncHandle.truncate(0);
			syncHandle.write(bytes, { at: 0 });
			syncHandle.flush();
		} finally {
			syncHandle.close();
		}
		return;
	}

	const writable = await handle.createWritable();
	try {
		await writable.write(content);
		await writable.close();
	} catch (error) {
		await writable.abort().catch(() => undefined);
		throw error;
	}
}

async function replaceFileHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
	const writable = await handle.createWritable({ keepExistingData: false });
	try {
		await writable.write(content);
		await writable.close();
	} catch (error) {
		await writable.abort().catch(() => undefined);
		throw error;
	}
}
