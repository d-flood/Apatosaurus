import type { DbApiContext } from './api';
import { verifyTranscriptionIndexRows } from './repositories/transcription-files';

export const SAVE_QUIET_MS = 10_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const queued = new Set<string>();
let draining = false;

/** Checks the transcription once `SAVE_QUIET_MS` passes without another save of it. */
export function checkTranscriptionRowsLater(context: DbApiContext, transcriptionId: string): void {
	queued.delete(transcriptionId);
	clearTimeout(timers.get(transcriptionId));
	timers.set(
		transcriptionId,
		setTimeout(() => checkTranscriptionRows(context, [transcriptionId]), SAVE_QUIET_MS)
	);
}

export function checkTranscriptionRows(context: DbApiContext, transcriptionIds: string[]): void {
	for (const id of transcriptionIds) {
		clearTimeout(timers.get(id));
		timers.delete(id);
		queued.add(id);
	}
	if (!draining) drain(context);
}

// Queues one background section at a time, so a backlog never ages ahead of user requests at once.
function drain(context: DbApiContext): void {
	const [transcriptionId] = queued;
	draining = transcriptionId !== undefined;
	if (transcriptionId === undefined) return;
	queued.delete(transcriptionId);
	context
		.defer('verifyTranscriptionRows', async db => {
			const result = await verifyTranscriptionIndexRows(db, transcriptionId);
			if (result.status !== 'corrected') return;
			context.invalidate('transcriptions', 'iiif');
			context.warn(result.warnings);
		})
		.catch(error =>
			console.warn('[local-db] transcription read-back check failed', {
				transcriptionId,
				error: error instanceof Error ? error.message : String(error),
			})
		)
		.finally(() => drain(context));
}
