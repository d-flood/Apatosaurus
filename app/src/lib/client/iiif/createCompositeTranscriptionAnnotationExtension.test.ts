import { describe, expect, it } from 'vitest';

import { createCompositeTranscriptionAnnotationExtension } from './createCompositeTranscriptionAnnotationExtension';

describe('createCompositeTranscriptionAnnotationExtension', () => {
	it('gates creation outside composite mode', () => {
		const extension = createCompositeTranscriptionAnnotationExtension(() => ({
			isCompositeSelected: false,
			persistenceContext: null,
			selectionQuote: null,
		}));

		expect(
			extension.canCreate?.({
				manifestId: 'm1',
				canvasId: 'c1',
				isEditing: false,
				selectedAnnotation: null,
				hostContext: extension.getContext?.() || null,
			})
		).toBe(false);
		expect(
			extension.getCreateDisabledReason?.({
				manifestId: 'm1',
				canvasId: 'c1',
				isEditing: false,
				selectedAnnotation: null,
				hostContext: extension.getContext?.() || null,
			})
		).toBe('Annotations are available only in the composite local manifest.');
	});

	it('prefills a new draft with the selected transcription text', () => {
		const extension = createCompositeTranscriptionAnnotationExtension(() => ({
			isCompositeSelected: true,
			persistenceContext: {
				manifestSourceId: 'source-1',
				sourceCanvasId: 'canvas-1',
				pageId: 'page-1',
				anchor: { pageName: 'Page 1' },
			},
			selectionQuote: {
				text: 'Selected text',
				pageId: 'page-1',
				pageName: 'Page 1',
				pageOrder: 1,
				from: 10,
				to: 23,
			},
		}));

		const context = {
			manifestId: 'm1',
			canvasId: 'c1',
			isEditing: true,
			selectedAnnotation: null,
			hostContext: extension.getContext?.() || null,
		};

		const annotation = extension.prepareDraft?.(
			{ id: 'anno-1', type: 'Annotation', body: [] },
			context
		) as { body: Array<{ value?: string }> };

		expect(annotation.body).toHaveLength(1);
		expect(annotation.body[0]?.value).toBe('Selected text');
	});
});
