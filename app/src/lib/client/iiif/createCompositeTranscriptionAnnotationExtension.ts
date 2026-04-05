import type {
	AnnotationEditorExtension,
	AnnotationEditorRuntimeContext,
	W3CAnnotation,
	W3CAnnotationBody,
} from 'triiiceratops/plugins/annotation-editor';

import type { TranscriptionSelectionQuote } from './types';

export interface CompositeAnnotationPersistenceContext {
	manifestSourceId: string;
	sourceCanvasId: string;
	pageId: string;
	anchor: {
		pageName?: string | null;
	};
}

export interface CompositeTranscriptionAnnotationHostContext {
	isCompositeSelected: boolean;
	persistenceContext: CompositeAnnotationPersistenceContext | null;
	selectionQuote: TranscriptionSelectionQuote | null;
}

function buildTextBody(text: string): W3CAnnotationBody {
	return {
		type: 'TextualBody',
		purpose: 'commenting',
		value: text,
		format: 'text/plain',
	};
}

function canCreateFromContext(hostContext: CompositeTranscriptionAnnotationHostContext | null): boolean {
	return !!(
		hostContext?.isCompositeSelected &&
		hostContext.persistenceContext &&
		hostContext.selectionQuote?.text &&
		hostContext.selectionQuote.pageId === hostContext.persistenceContext.pageId
	);
}

function getDisabledReason(hostContext: CompositeTranscriptionAnnotationHostContext | null): string | null {
	if (!hostContext?.isCompositeSelected) {
		return 'Annotations are available only in the composite local manifest.';
	}
	if (!hostContext.persistenceContext) {
		return 'Link this composite canvas to a transcription page before annotating it.';
	}
	if (!hostContext.selectionQuote?.text) {
		return null;
	}
	if (hostContext.selectionQuote.pageId !== hostContext.persistenceContext.pageId) {
		return `Select text on ${hostContext.persistenceContext.anchor.pageName || hostContext.persistenceContext.pageId} to annotate this image.`;
	}
	return null;
}

export function createCompositeTranscriptionAnnotationExtension(
	getHostContext: () => CompositeTranscriptionAnnotationHostContext
): AnnotationEditorExtension<CompositeTranscriptionAnnotationHostContext> {
	return {
		getContext: getHostContext,
		canCreate: ({ hostContext }: AnnotationEditorRuntimeContext<CompositeTranscriptionAnnotationHostContext>) =>
			canCreateFromContext(hostContext),
		getCreateDisabledReason: ({
			hostContext,
		}: AnnotationEditorRuntimeContext<CompositeTranscriptionAnnotationHostContext>) =>
			getDisabledReason(hostContext),
		prepareDraft: (
			annotation: W3CAnnotation,
			{ hostContext }: AnnotationEditorRuntimeContext<CompositeTranscriptionAnnotationHostContext>
		) => {
			const selectedText = hostContext?.selectionQuote?.text?.trim();
			if (!selectedText) return annotation;
			return {
				...annotation,
				body: [buildTextBody(selectedText)],
			};
		},
		beforeSave: async (
			annotation: W3CAnnotation,
			{ hostContext }: AnnotationEditorRuntimeContext<CompositeTranscriptionAnnotationHostContext>
		) => {
			const selectedText = hostContext?.selectionQuote?.text?.trim();
			if (!selectedText) return annotation;
			const currentBodies = Array.isArray(annotation.body)
				? annotation.body
				: annotation.body
					? [annotation.body]
					: [];
			if (currentBodies.length > 0) return annotation;
			return {
				...annotation,
				body: [buildTextBody(selectedText)],
			};
		},
	};
}
