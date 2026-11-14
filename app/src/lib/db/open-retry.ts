export const OPEN_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000];

export async function openWithRetry<T>(
	open: () => Promise<T>,
	reset: () => Promise<void>,
	{
		delaysMs = OPEN_RETRY_DELAYS_MS,
		wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
		onRetry,
	}: {
		delaysMs?: number[];
		wait?: (ms: number) => Promise<void>;
		onRetry?: (error: unknown, delayMs: number) => void;
	} = {}
): Promise<T> {
	for (const delayMs of delaysMs) {
		try {
			return await open();
		} catch (error) {
			onRetry?.(error, delayMs);
			await reset().catch(() => undefined);
			await wait(delayMs);
		}
	}
	return open();
}
