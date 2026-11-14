import { describe, expect, it, vi } from 'vitest';
import { coalesce } from './coalesce';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => (resolve = r));
	return { promise, resolve };
}

describe('coalesce', () => {
	it('folds calls made during a load into one follow-up load', async () => {
		const loads = [deferred<string>(), deferred<string>()];
		const load = vi.fn((_projectId: string) => loads[load.mock.calls.length - 1].promise);
		const list = coalesce(load);

		const first = list('p1');
		const second = list('p1');
		const third = list('p1');
		loads[0].resolve('stale');
		await expect(first).resolves.toBe('stale');
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
		loads[1].resolve('fresh');

		await expect(second).resolves.toBe('fresh');
		await expect(third).resolves.toBe('fresh');
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('keeps different arguments independent and recovers after a failed load', async () => {
		const load = vi.fn(async (projectId: string) => {
			if (load.mock.calls.length === 1) throw new Error('boom');
			return projectId;
		});
		const list = coalesce(load);

		const failed = list('p1');
		const retried = list('p1');
		const other = list('p2');

		await expect(failed).rejects.toThrow('boom');
		await expect(retried).resolves.toBe('p1');
		await expect(other).resolves.toBe('p2');
		expect(load).toHaveBeenCalledTimes(3);
	});
});
