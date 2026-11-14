/**
 * Runs at most one load per argument list at a time; calls made while one is in flight
 * share a single follow-up load, so bursts of invalidations cost two loads, not one each.
 */
export function coalesce<A extends unknown[], R>(
	load: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
	const inFlight = new Map<string, Promise<R>>();
	const queued = new Map<string, Promise<R>>();

	function start(key: string, args: A): Promise<R> {
		const run: Promise<R> = load(...args).finally(() => {
			if (inFlight.get(key) === run) inFlight.delete(key);
		});
		inFlight.set(key, run);
		return run;
	}

	return (...args: A) => {
		const key = JSON.stringify(args);
		const running = inFlight.get(key);
		if (!running) return start(key, args);
		let next = queued.get(key);
		if (!next) {
			next = running
				.catch(() => undefined)
				.then(() => {
					queued.delete(key);
					return start(key, args);
				});
			queued.set(key, next);
		}
		return next;
	};
}
