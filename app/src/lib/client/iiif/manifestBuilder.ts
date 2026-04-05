import type { CompositeCanvasSourceRef, ManifestSourceSummary, PageCanvasLink } from './types';

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function extractManifestLabel(manifestJson: Record<string, any> | null | undefined): string {
	if (!manifestJson) return 'Linked canvases';
	const label = manifestJson.label;
	if (typeof label === 'string' && label) return label;
	if (label && typeof label === 'object') {
		const none = label.none;
		if (Array.isArray(none) && typeof none[0] === 'string') return none[0];
	}
	return 'Linked canvases';
}

function formatCompositeCanvasLabel(link: PageCanvasLink): string {
	const pageLabel = link.pageNameSnapshot.trim() || `Page ${link.pageOrder}`;
	const canvasLabel = link.canvasLabel.trim() || `Image ${link.canvasOrder}`;
	return `${pageLabel}:${canvasLabel}`;
}

function buildCompositeCanvasId(transcriptionId: string, link: PageCanvasLink): string {
	return [
		`urn:apatopwa:transcription:${transcriptionId}:composite-canvas`,
		encodeURIComponent(link.manifestSourceId),
		encodeURIComponent(link.pageId),
		encodeURIComponent(link.canvasId),
	].join('/');
}

function extractCanvasFromManifest(
	manifestJson: Record<string, any> | null,
	canvasId: string
): Record<string, any> | null {
	if (!manifestJson) return null;
	if (Array.isArray(manifestJson.items)) {
		return (
			manifestJson.items.find((canvas: Record<string, any>) => canvas?.id === canvasId) || null
		);
	}
	const v2Canvases = manifestJson.sequences?.[0]?.canvases;
	if (Array.isArray(v2Canvases)) {
		return (
			v2Canvases.find((canvas: Record<string, any>) => canvas?.id === canvasId || canvas?.['@id'] === canvasId) || null
		);
	}
	return null;
}

function convertCanvasToPresentation3(canvas: Record<string, any>): Record<string, any> {
	if (canvas.type === 'Canvas') {
		return cloneJson(canvas);
	}

	const canvasId = canvas.id || canvas['@id'];
	const width = Number(canvas.width || 0) || undefined;
	const height = Number(canvas.height || 0) || undefined;
	const images = Array.isArray(canvas.images) ? canvas.images : [];
	const items = images.map((image: Record<string, any>, index: number) => {
		const annotationId = image['@id'] || image.id || `${canvasId}/painting/${index + 1}`;
		const body = image.resource || image.body || {};
		return {
			id: annotationId,
			type: 'Annotation',
			motivation: 'painting',
			target: canvasId,
			body: cloneJson(body),
		};
	});

	return {
		id: canvasId,
		type: 'Canvas',
		label:
			typeof canvas.label === 'string'
				? { none: [canvas.label] }
				: cloneJson(canvas.label || { none: ['Canvas'] }),
		...(width ? { width } : {}),
		...(height ? { height } : {}),
		items: [
			{
				id: `${canvasId}/page/1`,
				type: 'AnnotationPage',
				items,
			},
		],
	};
}

function reidentifyCanvas(canvas: Record<string, any>, canvasId: string): Record<string, any> {
	const nextCanvas = cloneJson(canvas);
	nextCanvas.id = canvasId;
	if (Array.isArray(nextCanvas.items)) {
		nextCanvas.items = nextCanvas.items.map((page: Record<string, any>, pageIndex: number) => ({
			...page,
			id: `${canvasId}/page/${pageIndex + 1}`,
			items: Array.isArray(page.items)
				? page.items.map((annotation: Record<string, any>) => ({
					...annotation,
					target: canvasId,
				}))
				: [],
		}));
	}
	return nextCanvas;
}

function buildCompositeCanvasSource(link: PageCanvasLink): CompositeCanvasSourceRef {
	return {
		manifestSourceId: link.manifestSourceId,
		sourceCanvasId: link.canvasId,
		pageId: link.pageId,
		pageOrder: link.pageOrder,
	};
}

export function buildLinkedManifest(input: {
	transcriptionId: string;
	transcriptionTitle: string;
	manifestSources: ManifestSourceSummary[];
	pageLinks: PageCanvasLink[];
}): Record<string, any> | null {
	const links = [...input.pageLinks].sort(
		(a, b) => a.pageOrder - b.pageOrder || a.canvasOrder - b.canvasOrder
	);
	if (links.length === 0) return null;

	const sourceMap = new Map(input.manifestSources.map(source => [source.id, source]));
	const items = links
		.map(link => {
			const source = sourceMap.get(link.manifestSourceId);
			const canvas = extractCanvasFromManifest(source?.manifestJson || null, link.canvasId);
			if (!canvas) return null;
			const nextCanvas = reidentifyCanvas(
				convertCanvasToPresentation3(canvas),
				buildCompositeCanvasId(input.transcriptionId, link)
			);
			nextCanvas.label = { none: [formatCompositeCanvasLabel(link)] };
			nextCanvas.apatopwaSource = buildCompositeCanvasSource(link);
			nextCanvas.metadata = [
				{ label: { none: ['Page'] }, value: { none: [link.pageNameSnapshot || link.pageId] } },
				{ label: { none: ['Source manifest'] }, value: { none: [source?.label || extractManifestLabel(source?.manifestJson)] } },
			];
			return nextCanvas;
		})
		.filter((canvas): canvas is Record<string, any> => canvas !== null);

	if (items.length === 0) return null;

	return {
		'@context': 'http://iiif.io/api/presentation/3/context.json',
		id: `urn:apatopwa:transcription:${input.transcriptionId}:linked-manifest`,
		type: 'Manifest',
		label: { none: [`${input.transcriptionTitle} linked canvases`] },
		items,
	};
}
