import { describe, expect, it } from 'vitest';

import { createCompositeTranscriptionAnnotationExtension } from './createCompositeTranscriptionAnnotationExtension';

describe('createCompositeTranscriptionAnnotationExtension', () => {
	it('allows creation for a linked source canvas', () => {
		const extension = createCompositeTranscriptionAnnotationExtension(() => ({
			isCompositeSelected: false,
			isAnnotationEditorOpen: true,
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

		expect(
			extension.canCreate?.({
				manifestId: 'm1',
				canvasId: 'c1',
				isEditing: false,
				selectedAnnotation: null,
				hostContext: extension.getContext?.() || null,
			})
		).toBe(true);
		expect(
			extension.getCreateDisabledReason?.({
				manifestId: 'm1',
				canvasId: 'c1',
				isEditing: false,
				selectedAnnotation: null,
				hostContext: extension.getContext?.() || null,
			})
		).toBe(null);
	});

	it('allows creation without selected transcription text', () => {
		const extension = createCompositeTranscriptionAnnotationExtension(() => ({
			isCompositeSelected: true,
			isAnnotationEditorOpen: true,
			persistenceContext: {
				manifestSourceId: 'source-1',
				sourceCanvasId: 'canvas-1',
				pageId: 'page-1',
				anchor: { pageName: 'Page 1' },
			},
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
		).toBe(true);
	});

	it('gates creation while the annotation editor is closed', () => {
		const extension = createCompositeTranscriptionAnnotationExtension(() => ({
			isCompositeSelected: true,
			isAnnotationEditorOpen: false,
			persistenceContext: {
				manifestSourceId: 'source-1',
				sourceCanvasId: 'canvas-1',
				pageId: 'page-1',
				anchor: { pageName: 'Page 1' },
			},
			selectionQuote: null,
		}));

		const context = {
			manifestId: 'm1',
			canvasId: 'c1',
			isEditing: true,
			selectedAnnotation: null,
			hostContext: extension.getContext?.() || null,
		};
		expect(extension.canCreate?.(context)).toBe(false);
		expect(extension.getCreateDisabledReason?.(context)).toBe(
			'Open the annotation editor to create annotations.'
		);
	});

	it('prefills a new draft with the selected transcription text', () => {
		const extension = createCompositeTranscriptionAnnotationExtension(() => ({
			isCompositeSelected: true,
			isAnnotationEditorOpen: true,
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
			{ id: 'anno-1', type: 'Annotation', target: { source: 'c1' }, body: [] },
			context
		) as { body: Array<{ value?: string }> };

		expect(annotation.body).toHaveLength(1);
		expect(annotation.body[0]?.value).toBe('Selected text');
	});
});
