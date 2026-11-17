export type QueuePriority = 'user' | 'background';

export const BACKGROUND_AGING_MS = 5_000;

interface Section {
	enqueuedAt: number;
	start: () => void;
}

/** Runs one section at a time: waiting user sections first, unless a background section has aged. */
export function createExclusiveQueue(now: () => number = () => performance.now()) {
	const waiting: Record<QueuePriority, Section[]> = { user: [], background: [] };
	let running = false;
	let backgroundEndedAt = -Infinity;

	function next(): void {
		const oldestBackground = waiting.background[0];
		// Ages from the last background turn too, so an aged backlog never runs back to back.
		const aged =
			oldestBackground &&
			now() - Math.max(oldestBackground.enqueuedAt, backgroundEndedAt) > BACKGROUND_AGING_MS;
		const section = aged
			? waiting.background.shift()
			: (waiting.user.shift() ?? waiting.background.shift());
		running = Boolean(section);
		section?.start();
	}

	return function exclusive<T>(
		work: () => Promise<T>,
		priority: QueuePriority = 'user'
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			waiting[priority].push({
				enqueuedAt: now(),
				start: () => {
					Promise.resolve()
						.then(work)
						.then(resolve, reject)
						.finally(() => {
							if (priority === 'background') backgroundEndedAt = now();
							next();
						});
				},
			});
			if (!running) next();
		});
	};
}
