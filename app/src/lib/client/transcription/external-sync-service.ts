import type { TEIMetadata } from '$lib/tei/tei-exporter';
import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import type { TranscriptionRecord } from '$lib/client/transcription/model';
import { buildTEIMetadataFromTranscription } from '$lib/tei/transcription-record-metadata';
import type { ExternalSyncWorkerStatus } from './external-sync.worker';

interface SyncJob {
	jobId: string;
	transcriptionId: string;
	baseName: string;
	doc: StoredTranscriptionDocument;
	metadata: TEIMetadata;
}

type WorkerIncoming =
	| {
			type: 'configure';
			enabled: boolean;
			rootDirHandle?: FileSystemDirectoryHandle;
	  }
	| {
			type: 'sync';
			job: SyncJob;
	  }
	| {
			type: 'clear';
	  };

type WorkerOutgoing =
	| {
			type: 'status';
			status: ExternalSyncWorkerStatus;
	  }
	| {
			type: 'result';
			ok: boolean;
			jobId: string;
			transcriptionId: string;
			jsonPath?: string;
			teiPath?: string;
			error?: string;
	  };

export interface ExternalSyncState {
	supported: boolean;
	enabled: boolean;
	status: ExternalSyncWorkerStatus;
	directoryName: string | null;
	lastError: string | null;
	lastJsonPath: string | null;
	lastTeiPath: string | null;
}

type Listener = (state: ExternalSyncState) => void;

const IDB_NAME = 'apatopwa-external-sync';
const IDB_STORE = 'settings';
const IDB_KEY = 'root-dir-handle';

class ExternalSyncService {
	private worker: Worker | null = null;
	private initialized = false;
	private currentHandle: FileSystemDirectoryHandle | null = null;
	private listeners = new Set<Listener>();
	private state: ExternalSyncState = {
		supported: this.detectSupport(),
		enabled: false,
		status: this.detectSupport() ? 'disabled' : 'unsupported',
		directoryName: null,
		lastError: null,
		lastJsonPath: null,
		lastTeiPath: null,
	};

	getState(): ExternalSyncState {
		return { ...this.state };
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.getState());
		return () => {
			this.listeners.delete(listener);
		};
	}

	async init(): Promise<void> {
		if (this.initialized) {
			return;
		}
		this.initialized = true;

		if (!this.state.supported) {
			this.updateState({ status: 'unsupported' });
			return;
		}

		this.worker = new Worker(new URL('./external-sync.worker.ts', import.meta.url), {
			type: 'module',
		});
		this.worker.onmessage = (event: MessageEvent<WorkerOutgoing>) => {
			this.handleWorkerMessage(event.data);
		};

		const handle = await this.loadPersistedDirectoryHandle();
		if (!handle) {
			this.updateState({ enabled: false, status: 'disabled' });
			return;
		}
		this.currentHandle = handle;

		const hasPermission = await this.ensureHandleReadWritePermission(handle, false);
		if (!hasPermission) {
			await this.clear();
			this.updateState({
				enabled: false,
				status: 'permission_required',
				directoryName: null,
				lastError: 'External directory permission is no longer granted.',
			});
			return;
		}

		this.worker.postMessage({
			type: 'configure',
			enabled: true,
			rootDirHandle: handle,
		} satisfies WorkerIncoming);
		this.updateState({ enabled: true, status: 'ready' });
		this.updateState({ directoryName: handle.name || null });
	}

	async chooseDirectory(): Promise<void> {
		if (!this.state.supported) {
			throw new Error('External folder sync is not supported in this browser.');
		}
		const picker = this.getDirectoryPicker();
		if (!picker) {
			throw new Error('Directory picker is unavailable in this browser.');
		}
		await this.init();
		const handle = await picker({ mode: 'readwrite' });
		const granted = await this.ensureHandleReadWritePermission(handle, true);
		if (!granted) {
			throw new Error('Read/write permission was not granted for the selected directory.');
		}

		await this.persistDirectoryHandle(handle);
		this.currentHandle = handle;
		this.worker?.postMessage({
			type: 'configure',
			enabled: true,
			rootDirHandle: handle,
		} satisfies WorkerIncoming);
		this.updateState({
			enabled: true,
			status: 'ready',
			directoryName: handle.name || null,
			lastError: null,
		});
	}

	async clear(): Promise<void> {
		await this.clearPersistedDirectoryHandle();
		this.currentHandle = null;
		this.worker?.postMessage({ type: 'clear' } satisfies WorkerIncoming);
		this.updateState({
			enabled: false,
			status: this.state.supported ? 'disabled' : 'unsupported',
			directoryName: null,
			lastError: null,
			lastJsonPath: null,
			lastTeiPath: null,
		});
	}

	enqueueSync(transcription: TranscriptionRecord, doc: StoredTranscriptionDocument): void {
		if (!this.worker || !this.state.enabled || this.state.status === 'permission_required') {
			return;
		}

		const transcriptionId = transcription._djazzkit_id;
		const title = (transcription.title || '').trim();
		const siglum = (transcription.siglum || '').trim();
		const slugSource = title || siglum || 'transcription';
		const baseName = `${slugify(slugSource)}__${transcriptionId}`;
		const metadata: TEIMetadata = buildTEIMetadataFromTranscription(transcription);

		const job: SyncJob = {
			jobId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
			transcriptionId,
			baseName,
			doc,
			metadata,
		};

		this.worker.postMessage({ type: 'sync', job } satisfies WorkerIncoming);
	}

	private detectSupport(): boolean {
		return typeof window !== 'undefined' && typeof Worker !== 'undefined' && !!this.getDirectoryPicker();
	}

	private handleWorkerMessage(message: WorkerOutgoing): void {
		if (message.type === 'status') {
			this.updateState({ status: message.status });
			return;
		}

		if (message.ok) {
			this.updateState({
				lastError: null,
				lastJsonPath: message.jsonPath ?? null,
				lastTeiPath: message.teiPath ?? null,
			});
			return;
		}

		this.updateState({
			lastError: message.error ?? 'Failed to write external sync files.',
		});
	}

	private updateState(patch: Partial<ExternalSyncState>): void {
		this.state = {
			...this.state,
			...patch,
		};
		for (const listener of this.listeners) {
			listener(this.getState());
		}
	}

	private async ensureHandleReadWritePermission(
		handle: FileSystemDirectoryHandle,
		requestIfNeeded: boolean
	): Promise<boolean> {
		const withPermission = handle as FileSystemDirectoryHandle & {
			queryPermission?: (descriptor: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
			requestPermission?: (descriptor: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
		};
		if (!withPermission.queryPermission) {
			return false;
		}
		const current = await withPermission.queryPermission({ mode: 'readwrite' });
		if (current === 'granted') {
			return true;
		}
		if (!requestIfNeeded || !withPermission.requestPermission) {
			return false;
		}
		const requested = await withPermission.requestPermission({ mode: 'readwrite' });
		return requested === 'granted';
	}

	private getDirectoryPicker():
		| ((options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>)
		| null {
		if (typeof window === 'undefined') {
			return null;
		}
		const maybeWindow = window as Window & {
			showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
		};
		return maybeWindow.showDirectoryPicker ?? null;
	}

	private async openSettingsDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(IDB_NAME, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(IDB_STORE)) {
					db.createObjectStore(IDB_STORE);
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
		});
	}

	private async persistDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
		const db = await this.openSettingsDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error('Failed to persist external sync directory.'));
			tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
		});
		db.close();
	}

	private async loadPersistedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
		const db = await this.openSettingsDb();
		const value = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readonly');
			tx.onerror = () => reject(tx.error ?? new Error('Failed to read external sync directory.'));
			const request = tx.objectStore(IDB_STORE).get(IDB_KEY);
			request.onsuccess = () => {
				resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
			};
			request.onerror = () => reject(request.error ?? new Error('Failed to read external sync directory.'));
		});
		db.close();
		return value;
	}

	private async clearPersistedDirectoryHandle(): Promise<void> {
		const db = await this.openSettingsDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error('Failed to clear external sync directory.'));
			tx.objectStore(IDB_STORE).delete(IDB_KEY);
		});
		db.close();
	}
}

function slugify(value: string): string {
	const normalized = value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return normalized || 'transcription';
}

export const externalSyncService = new ExternalSyncService();
