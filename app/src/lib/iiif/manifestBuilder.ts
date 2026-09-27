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

function formatPageLabel(link: PageCanvasLink): string {
	return link.pageNameSnapshot.trim() || `Page ${link.pageOrder}`;
}

function buildCompositeCanvasId(transcriptionId: string, link: PageCanvasLink): string {
	return [
		`urn:apatopwa:transcription:${transcriptionId}:composite-canvas`,
		encodeURIComponent(link.manifestSourceId),
		encodeURIComponent(link.pageId),
		encodeURIComponent(link.canvasId),
	].join('/');
}

function buildCompositePageCanvasId(transcriptionId: string, pageId: string): string {
	return [
		`urn:apatopwa:transcription:${transcriptionId}:composite-canvas`,
		encodeURIComponent(pageId),
	].join('/');
}

function extractCanvasFromManifest(
	manifestJson: Record<string, any> | null,
	canvasId: string
): Record<string, any> | null {
	if (!manifestJson) return null;
	if (Array.isArray(manifestJson.items)) {
		return (
			manifestJson.items.find((canvas: Record<string, any>) => canvas?.id === canvasId) ||
			null
		);
	}
	const v2Canvases = manifestJson.sequences?.[0]?.canvases;
	if (Array.isArray(v2Canvases)) {
		return (
			v2Canvases.find(
				(canvas: Record<string, any>) =>
					canvas?.id === canvasId || canvas?.['@id'] === canvasId
			) || null
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

function extractChoiceItems(body: unknown): Record<string, any>[] {
	if (!body || typeof body !== 'object') return [];
	const candidate = body as Record<string, any>;
	if (candidate.type !== 'Choice' && candidate.type !== 'oa:Choice') return [];
	const items = candidate.items || candidate.item || [];
	if (Array.isArray(items)) {
		return items.filter((item): item is Record<string, any> =>
			Boolean(item && typeof item === 'object')
		);
	}
	return items && typeof items === 'object' ? [items] : [];
}

function extractFirstPaintingBody(canvas: Record<string, any>): Record<string, any> | null {
	const annotationPages = Array.isArray(canvas.items) ? canvas.items : [];
	for (const page of annotationPages) {
		const annotations = Array.isArray(page?.items) ? page.items : [];
		for (const annotation of annotations) {
			if (annotation?.motivation !== 'painting') continue;
			const body = annotation?.body;
			if (Array.isArray(body)) {
				const firstBody = body.find((item): item is Record<string, any> =>
					Boolean(item && typeof item === 'object')
				);
				if (firstBody) return cloneJson(firstBody);
				continue;
			}
			if (!body || typeof body !== 'object') continue;
			const choiceItems = extractChoiceItems(body);
			if (choiceItems.length > 0) {
				return cloneJson(choiceItems[0]);
			}
			return cloneJson(body);
		}
	}
	return null;
}

function buildCompositeCanvasMetadata(
	link: PageCanvasLink,
	manifestLabels: string[]
): Record<string, any>[] {
	const pageLabel = link.pageNameSnapshot || link.pageId;
	const metadata = [{ label: { none: ['Page'] }, value: { none: [pageLabel] } }];
	if (manifestLabels.length > 0) {
		metadata.push({
			label: { none: ['Source manifest'] },
			value: { none: manifestLabels },
		});
	}
	return metadata;
}

function buildSingleCompositeCanvas(
	transcriptionId: string,
	link: PageCanvasLink,
	source: ManifestSourceSummary | undefined
): Record<string, any> | null {
	const canvas = extractCanvasFromManifest(source?.manifestJson || null, link.canvasId);
	if (!canvas) return null;
	const nextCanvas = reidentifyCanvas(
		convertCanvasToPresentation3(canvas),
		buildCompositeCanvasId(transcriptionId, link)
	);
	nextCanvas.label = { none: [formatCompositeCanvasLabel(link)] };
	nextCanvas.apatopwaSource = buildCompositeCanvasSource(link);
	nextCanvas.metadata = buildCompositeCanvasMetadata(link, [
		source?.label || extractManifestLabel(source?.manifestJson),
	]);
	return nextCanvas;
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
	const linksByPage = new Map<string, PageCanvasLink[]>();
	for (const link of links) {
		const pageLinks = linksByPage.get(link.pageId);
		if (pageLinks) {
			pageLinks.push(link);
		} else {
			linksByPage.set(link.pageId, [link]);
		}
	}

	const items = Array.from(linksByPage.values())
		.map(pageGroup => {
			const [firstLink] = pageGroup;
			if (!firstLink) return null;
			if (pageGroup.length === 1) {
				return buildSingleCompositeCanvas(
					input.transcriptionId,
					firstLink,
					sourceMap.get(firstLink.manifestSourceId)
				);
			}

			const choiceEntries = pageGroup
				.map(link => {
					const source = sourceMap.get(link.manifestSourceId);
					const canvas = extractCanvasFromManifest(
						source?.manifestJson || null,
						link.canvasId
					);
					if (!canvas) return null;
					const normalizedCanvas = convertCanvasToPresentation3(canvas);
					const imageBody = extractFirstPaintingBody(normalizedCanvas);
					if (!imageBody) return null;
					imageBody.label = {
						none: [link.canvasLabel.trim() || `Image ${link.canvasOrder}`],
					};
					imageBody.apatopwaSource = buildCompositeCanvasSource(link);
					return {
						link,
						source,
						normalizedCanvas,
						imageBody,
					};
				})
				.filter(
					(
						entry
					): entry is {
						link: PageCanvasLink;
						source: ManifestSourceSummary | undefined;
						normalizedCanvas: Record<string, any>;
						imageBody: Record<string, any>;
					} => entry !== null
				);

			if (choiceEntries.length === 0) return null;
			if (choiceEntries.length === 1) {
				return buildSingleCompositeCanvas(
					input.transcriptionId,
					choiceEntries[0].link,
					choiceEntries[0].source
				);
			}

			const baseEntry = choiceEntries[0];
			const nextCanvas = reidentifyCanvas(
				baseEntry.normalizedCanvas,
				buildCompositePageCanvasId(input.transcriptionId, firstLink.pageId)
			);
			nextCanvas.label = { none: [formatPageLabel(firstLink)] };
			nextCanvas.apatopwaSource = buildCompositeCanvasSource(baseEntry.link);
			nextCanvas.metadata = buildCompositeCanvasMetadata(
				firstLink,
				Array.from(
					new Set(
						choiceEntries.map(
							entry =>
								entry.source?.label ||
								extractManifestLabel(entry.source?.manifestJson)
						)
					)
				)
			);

			const width = Math.max(
				...choiceEntries.map(entry =>
					Number(entry.normalizedCanvas.width || entry.imageBody.width || 0)
				)
			);
			const height = Math.max(
				...choiceEntries.map(entry =>
					Number(entry.normalizedCanvas.height || entry.imageBody.height || 0)
				)
			);
			if (width > 0) nextCanvas.width = width;
			if (height > 0) nextCanvas.height = height;

			nextCanvas.items = [
				{
					id: `${nextCanvas.id}/page/1`,
					type: 'AnnotationPage',
					items: [
						{
							id: `${nextCanvas.id}/painting/1`,
							type: 'Annotation',
							motivation: 'painting',
							target: nextCanvas.id,
							body: {
								type: 'Choice',
								items: choiceEntries.map(entry => entry.imageBody),
							},
						},
					],
				},
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
