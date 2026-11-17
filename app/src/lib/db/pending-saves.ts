const flushers = new Set<() => Promise<unknown>>();

export function registerPendingSave(flush: () => Promise<unknown>): () => void {
	// Wraps so a shared flush can register twice and a synchronous throw becomes a rejection.
	const entry = async () => flush();
	flushers.add(entry);
	return () => flushers.delete(entry);
}

export async function flushPendingSaves(): Promise<void> {
	await Promise.allSettled([...flushers].map(flush => flush()));
}
