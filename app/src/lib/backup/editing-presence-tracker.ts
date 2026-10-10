import { clearEditingPresence, writeEditingPresence } from '$lib/db/client';

const WRITE_INTERVAL_MS = 60_000;

export interface EditingPresenceTracker {
	noteEdit(): void;
	close(): void;
}

export function trackEditingPresence(
	projectId: string,
	documentId: string
): EditingPresenceTracker {
	let lastWriteAt: number | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function write() {
		lastWriteAt = Date.now();
		void writeEditingPresence(projectId, documentId).catch(error =>
			console.warn('[presence] write failed', error)
		);
	}

	return {
		noteEdit() {
			if (timer) return;
			const wait = lastWriteAt === null ? 0 : lastWriteAt + WRITE_INTERVAL_MS - Date.now();
			if (wait <= 0) {
				write();
				return;
			}
			timer = setTimeout(() => {
				timer = null;
				write();
			}, wait);
		},
		close() {
			if (timer) clearTimeout(timer);
			timer = null;
			if (lastWriteAt === null) return;
			void clearEditingPresence(projectId, documentId).catch(error =>
				console.warn('[presence] clear failed', error)
			);
		},
	};
}
