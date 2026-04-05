import { manifestsState } from 'triiiceratops';
import type { AnnotationStorageAdapter, W3CAnnotation } from 'triiiceratops/plugins/annotation-editor';

import {
	deleteCanvasAnnotation,
	findLinkedPageForCanvas,
	getCanvasAnnotation,
	getManifestSource,
	listCanvasAnnotations,
	upsertCanvasAnnotation,
} from './storage';
import type { AnnotationAnchor } from './types';

interface PersistenceContext {
	manifestSourceId: string;
	sourceCanvasId: string;
	pageId: string;
	anchor: AnnotationAnchor;
}

export class AppAnnotationAdapter implements AnnotationStorageAdapter {
	readonly id = 'apatopwa';
	readonly name = 'Apatopwa';

	private injectedCanvases = new Set<string>();

	constructor(
		private readonly resolveTranscriptionId: () => string,
		private readonly resolveContext: (
			manifestId: string,
			canvasId: string
		) => PersistenceContext | null
	) {}

	async load(manifestId: string, canvasId: string): Promise<W3CAnnotation[]> {
		const context = await this.resolvePersistenceContext(manifestId, canvasId);
		if (!context) return [];
		const transcriptionId = this.resolveTranscriptionId();
		const annotations = (await listCanvasAnnotations({
			transcriptionId,
			manifestSourceIds: [context.manifestSourceId],
			canvasId: context.sourceCanvasId,
			mode: 'headers',
		})).map(annotation => this.mapAnnotationTargetToViewerCanvas(annotation, canvasId));
		this.injectIntoManifestState(manifestId, canvasId, annotations);
		return annotations;
	}

	async hydrate(
		manifestId: string,
		canvasId: string,
		annotationId: string
	): Promise<W3CAnnotation | null> {
		const context = await this.resolvePersistenceContext(manifestId, canvasId);
		if (!context) return null;
		const transcriptionId = this.resolveTranscriptionId();
		const annotation = await getCanvasAnnotation({
			transcriptionId,
			manifestSourceId: context.manifestSourceId,
			annotationId,
		});
		if (!annotation) return null;
		const viewerAnnotation = this.mapAnnotationTargetToViewerCanvas(annotation, canvasId);
		this.mergeAnnotationIntoManifestState(manifestId, canvasId, viewerAnnotation);
		return viewerAnnotation;
	}

	async create(manifestId: string, canvasId: string, annotation: W3CAnnotation): Promise<void> {
		const context = await this.resolvePersistenceContext(manifestId, canvasId);
		if (!context) return;
		const transcriptionId = this.resolveTranscriptionId();
		await upsertCanvasAnnotation({
			transcriptionId,
			pageId: context.pageId,
			manifestSourceId: context.manifestSourceId,
			canvasId: context.sourceCanvasId,
			annotation: this.mapAnnotationTargetToStorageCanvas(annotation, context.sourceCanvasId),
			anchor: context.anchor,
			createdBy: annotation.creator?.id || annotation.creator?.name,
		});
		await this.load(manifestId, canvasId);
	}

	async update(manifestId: string, canvasId: string, annotation: W3CAnnotation): Promise<void> {
		const context = await this.resolvePersistenceContext(manifestId, canvasId);
		if (!context) return;
		const transcriptionId = this.resolveTranscriptionId();
		await upsertCanvasAnnotation({
			transcriptionId,
			pageId: context.pageId,
			manifestSourceId: context.manifestSourceId,
			canvasId: context.sourceCanvasId,
			annotation: this.mapAnnotationTargetToStorageCanvas(annotation, context.sourceCanvasId),
			anchor: context.anchor,
			createdBy: annotation.creator?.id || annotation.creator?.name,
		});
		await this.load(manifestId, canvasId);
	}

	async delete(manifestId: string, canvasId: string, annotationId: string): Promise<void> {
		const context = await this.resolvePersistenceContext(manifestId, canvasId);
		if (!context) return;
		const transcriptionId = this.resolveTranscriptionId();
		await deleteCanvasAnnotation({
			transcriptionId,
			manifestSourceId: context.manifestSourceId,
			annotationId,
		});
		await this.load(manifestId, canvasId);
	}

	destroy(): void {
		for (const entry of this.injectedCanvases) {
			const [manifestId, canvasId] = entry.split('::');
			manifestsState.clearUserAnnotations(manifestId, canvasId);
		}
		this.injectedCanvases.clear();
	}

	private injectIntoManifestState(
		manifestId: string,
		canvasId: string,
		annotations: W3CAnnotation[]
	): void {
		this.injectedCanvases.add(`${manifestId}::${canvasId}`);
		manifestsState.setUserAnnotations(manifestId, canvasId, annotations);
	}

	private mergeAnnotationIntoManifestState(
		manifestId: string,
		canvasId: string,
		annotation: W3CAnnotation
	): void {
		const existing = manifestsState.getUserAnnotations(manifestId, canvasId);
		const next = existing.some((entry: W3CAnnotation) => entry.id === annotation.id)
			? existing.map((entry: W3CAnnotation) => (entry.id === annotation.id ? annotation : entry))
			: [...existing, annotation];
		this.injectIntoManifestState(manifestId, canvasId, next);
	}

	private async resolvePersistenceContext(
		manifestId: string,
		canvasId: string
	): Promise<PersistenceContext | null> {
		const transcriptionId = this.resolveTranscriptionId();
		const resolved = this.resolveContext(manifestId, canvasId);
		if (resolved?.manifestSourceId && resolved.pageId) {
			return resolved;
		}

		const manifestSource = await getManifestSource(transcriptionId, manifestId);
		if (!manifestSource) {
			return null;
		}

		const link = await findLinkedPageForCanvas({
			transcriptionId,
			manifestSourceId: manifestSource.id,
			canvasId,
		});
		if (!link) {
			return null;
		}

		return {
			manifestSourceId: manifestSource.id,
			sourceCanvasId: canvasId,
			pageId: link.pageId,
			anchor: {
				pageId: link.pageId,
				pageName: link.pageNameSnapshot,
				pageOrder: link.pageOrder,
				canvasId,
				manifestSourceId: manifestSource.id,
			},
		};
	}

	private mapAnnotationTargetToViewerCanvas(
		annotation: W3CAnnotation,
		canvasId: string
	): W3CAnnotation {
		const next = structuredClone(annotation);
		if (typeof next.target === 'string') {
			next.target = { source: canvasId };
			return next;
		}
		next.target = {
			...next.target,
			source: canvasId,
		};
		return next;
	}

	private mapAnnotationTargetToStorageCanvas(
		annotation: W3CAnnotation,
		canvasId: string
	): W3CAnnotation {
		const next = structuredClone(annotation);
		if (typeof next.target === 'string') {
			next.target = { source: canvasId };
			return next;
		}
		next.target = {
			...next.target,
			source: canvasId,
		};
		return next;
	}
}
