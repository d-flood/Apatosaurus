import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadZipArchive } from './download-blob';

describe('zip download lifecycle', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it.each(['Chromium', 'Firefox', 'Safari'])(
		'keeps the blob URL alive through the click task in %s-compatible browsers',
		() => {
			const click = vi.fn();
			const remove = vi.fn();
			const append = vi.fn();
			const revokeObjectURL = vi.fn();
			vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:backup'), revokeObjectURL });
			vi.stubGlobal('document', {
				createElement: vi.fn(() => ({ click, remove, href: '', download: '', hidden: false })),
				body: { append },
			});

			downloadZipArchive('project.zip', new Uint8Array([1, 2, 3]));

			expect(click).toHaveBeenCalledOnce();
			expect(append).toHaveBeenCalledOnce();
			expect(revokeObjectURL).not.toHaveBeenCalled();
			vi.runAllTimers();
			expect(remove).toHaveBeenCalledOnce();
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup');
		}
	);
});
