import { describe, expect, it } from 'vitest';

import { domDocumentSnapshot } from './editorFixtures';
import { createTestEditor, mountTranscriptionEditor } from './editorHarnesses.svelte';

describe('editor test harnesses', () => {
	it('creates a direct editor with a non-degenerate fixture', () => {
		const editor = createTestEditor({});
		try {
			expect(editor.state.doc.childCount).toBe(3);
		} finally {
			editor.destroy();
		}
	});

	it('mounts TranscriptionEditor with the real document fixture', async () => {
		const harness = await mountTranscriptionEditor({ id: 'mounted-editor-spec' });
		try {
			expect(domDocumentSnapshot(harness.container)).toEqual([
				[['a1', 'a2', 'a3', 'a4']],
				[
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
				[['d1', 'd2', 'd3', 'd4']],
			]);
		} finally {
			harness.dispose();
		}
	});
});
