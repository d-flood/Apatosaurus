import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebouncedSave } from './debounced-save';

describe('debounced save', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('waits for the delay, then saves once', async () => {
		const save = vi.fn(async () => true);
		const autosave = createDebouncedSave({ read: () => 'edit', save, delayMs: 100 });
		autosave.schedule();
		await vi.advanceTimersByTimeAsync(99);
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledExactlyOnceWith('edit');
		await vi.advanceTimersByTimeAsync(100);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('coalesces rapid edits and reads the latest value', async () => {
		let value = 'first';
		const save = vi.fn(async () => true);
		const autosave = createDebouncedSave({ read: () => value, save, delayMs: 100 });
		autosave.schedule();
		await vi.advanceTimersByTimeAsync(75);
		value = 'last';
		autosave.schedule();
		await vi.advanceTimersByTimeAsync(99);
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledExactlyOnceWith('last');
	});

	it('flushes pending edits and cancels the timer', async () => {
		const save = vi.fn(async () => true);
		const autosave = createDebouncedSave({ read: () => 'edit', save, delayMs: 100 });
		autosave.schedule();
		await expect(autosave.flush()).resolves.toBe(true);
		expect(save).toHaveBeenCalledExactlyOnceWith('edit');
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(100);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('runs saves one at a time', async () => {
		let finish!: (saved: boolean) => void;
		let value = 'first';
		const save = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<boolean>(resolve => {
						finish = resolve;
					})
			)
			.mockResolvedValue(true);
		const autosave = createDebouncedSave({ read: () => value, save, delayMs: 100 });
		autosave.schedule();
		await vi.advanceTimersByTimeAsync(100);
		value = 'last';
		autosave.schedule();
		await vi.advanceTimersByTimeAsync(100);
		expect(save).toHaveBeenCalledTimes(1);
		finish(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(save.mock.calls).toEqual([['first'], ['last']]);
	});

	it('keeps a failed save pending for the next flush', async () => {
		const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const autosave = createDebouncedSave({ read: () => 'edit', save, delayMs: 100 });
		autosave.schedule();
		await vi.advanceTimersByTimeAsync(100);
		expect(save).toHaveBeenCalledTimes(1);
		await expect(autosave.flush()).resolves.toBe(true);
		expect(save.mock.calls).toEqual([['edit'], ['edit']]);
	});
});
