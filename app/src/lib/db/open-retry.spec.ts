import { describe, expect, it, vi } from 'vitest';
import { openWithRetry } from './open-retry';

describe('openWithRetry', () => {
	it('retries a transient open failure after resetting the half-open database', async () => {
		const open = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('sqlite3_open_v2'))
			.mockRejectedValueOnce(new Error('sqlite3_open_v2'))
			.mockResolvedValue('opened');
		const reset = vi.fn(async () => undefined);
		const wait = vi.fn(async () => undefined);

		await expect(openWithRetry(open, reset, { delaysMs: [1, 2, 3], wait })).resolves.toBe(
			'opened'
		);
		expect(open).toHaveBeenCalledTimes(3);
		expect(reset).toHaveBeenCalledTimes(2);
		expect(wait.mock.calls).toEqual([[1], [2]]);
	});

	it('surfaces the final failure once retries are exhausted', async () => {
		const open = vi.fn(async () => {
			throw new Error('sqlite3_open_v2');
		});

		await expect(
			openWithRetry(open, async () => undefined, {
				delaysMs: [1, 1],
				wait: async () => undefined,
			})
		).rejects.toThrow('sqlite3_open_v2');
		expect(open).toHaveBeenCalledTimes(3);
	});
});
