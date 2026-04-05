import { serializeTei, type TeiMetadata as TEIMetadata, type TranscriptionDocument } from '@apatopwa/tei-transcription';

interface SyncJob {
	jobId: string;
	transcriptionId: string;
	baseName: string;
	doc: TranscriptionDocument;
	metadata: TEIMetadata;
}

type IncomingMessage =
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

type OutgoingMessage =
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

export type ExternalSyncWorkerStatus =
	| 'disabled'
	| 'ready'
	| 'processing'
	| 'permission_required'
	| 'unsupported';

let rootDirHandle: FileSystemDirectoryHandle | null = null;
let enabled = false;
let processing = false;
const queuedByTranscriptionId = new Map<string, SyncJob>();

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
	void handleMessage(event.data);
};

async function handleMessage(message: IncomingMessage): Promise<void> {
	switch (message.type) {
		case 'configure': {
			enabled = message.enabled;
			rootDirHandle = message.rootDirHandle ?? null;
			if (!enabled || !rootDirHandle) {
				queuedByTranscriptionId.clear();
				emitStatus('disabled');
				return;
			}
			const hasPermission = await checkPermission(rootDirHandle);
			emitStatus(hasPermission ? 'ready' : 'permission_required');
			return;
		}
		case 'sync': {
			if (!enabled || !rootDirHandle) {
				return;
			}
			queuedByTranscriptionId.set(message.job.transcriptionId, message.job);
			void processQueue();
			return;
		}
		case 'clear': {
			enabled = false;
			rootDirHandle = null;
			queuedByTranscriptionId.clear();
			emitStatus('disabled');
			return;
		}
	}
}

async function processQueue(): Promise<void> {
	if (processing) {
		return;
	}
	processing = true;

	while (queuedByTranscriptionId.size > 0) {
		const nextEntry = queuedByTranscriptionId.entries().next().value as
			| [string, SyncJob]
			| undefined;
		if (!nextEntry) {
			break;
		}
		const [transcriptionId, job] = nextEntry;
		queuedByTranscriptionId.delete(transcriptionId);

		if (!rootDirHandle || !enabled) {
			break;
		}

		emitStatus('processing');
		try {
			const permission = await checkPermission(rootDirHandle);
			if (!permission) {
				emitResult({
					ok: false,
					jobId: job.jobId,
					transcriptionId: job.transcriptionId,
					error: 'Directory permission is no longer granted.',
				});
				emitStatus('permission_required');
				continue;
			}

			const jsonDir = await rootDirHandle.getDirectoryHandle('documents', { create: true });
			const teiDir = await rootDirHandle.getDirectoryHandle('tei', { create: true });

			const jsonFilename = `${job.baseName}.json`;
			const teiFilename = `${job.baseName}.xml`;

			const jsonPath = `documents/${jsonFilename}`;
			const teiPath = `tei/${teiFilename}`;

			await writeFile(jsonDir, jsonFilename, JSON.stringify(job.doc, null, 2));
			const xml = serializeTei(job.doc, job.metadata);
			await writeFile(teiDir, teiFilename, xml);

			emitResult({
				ok: true,
				jobId: job.jobId,
				transcriptionId: job.transcriptionId,
				jsonPath,
				teiPath,
			});
			emitStatus('ready');
		} catch (error) {
			emitResult({
				ok: false,
				jobId: job.jobId,
				transcriptionId: job.transcriptionId,
				error: error instanceof Error ? error.message : String(error),
			});
			emitStatus('ready');
		}
	}

	processing = false;
}

async function writeFile(
	directory: FileSystemDirectoryHandle,
	fileName: string,
	content: string
): Promise<void> {
	const fileHandle = await directory.getFileHandle(fileName, { create: true });
	const writable = await fileHandle.createWritable();
	try {
		await writable.write(content);
	} finally {
		await writable.close();
	}
}

async function checkPermission(directory: FileSystemDirectoryHandle): Promise<boolean> {
	const withPermission = directory as FileSystemDirectoryHandle & {
		queryPermission?: (descriptor: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
	};
	if (!withPermission.queryPermission) {
		return false;
	}
	const status = await withPermission.queryPermission({ mode: 'readwrite' });
	return status === 'granted';
}

function emitStatus(status: ExternalSyncWorkerStatus): void {
	emit({ type: 'status', status });
}

function emitResult(message: Omit<Extract<OutgoingMessage, { type: 'result' }>, 'type'>): void {
	emit({ type: 'result', ...message });
}

function emit(message: OutgoingMessage): void {
	self.postMessage(message);
}
