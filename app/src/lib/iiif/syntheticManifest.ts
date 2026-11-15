import { guessImageFormat } from './externalImageManifest';
import type { IiifSyntheticCanvas } from './types';

const SYNTHETIC_MANIFEST_PREFIX = 'urn:apatopwa:iiif:';

export function isSyntheticManifestUrl(manifestUrl: string): boolean {
	return manifestUrl.startsWith(SYNTHETIC_MANIFEST_PREFIX);
}

export function syntheticCanvasesFromManifest(
	manifestJson: Record<string, any>
): IiifSyntheticCanvas[] {
	const canvases: unknown[] = Array.isArray(manifestJson.items) ? manifestJson.items : [];
	return canvases.flatMap(entry => {
		const canvas = entry as Record<string, any>;
		const body = canvas?.items?.[0]?.items?.[0]?.body;
		if (typeof canvas?.id !== 'string' || typeof body?.id !== 'string') return [];
		const thumbnail = Array.isArray(canvas.thumbnail) ? canvas.thumbnail[0]?.id : null;
		const metadata: unknown[] = Array.isArray(canvas.metadata) ? canvas.metadata : [];
		return [
			{
				canvas_id: canvas.id,
				label: languageMapValue(canvas.label),
				width: Number(canvas.width) || 0,
				height: Number(canvas.height) || 0,
				image_url: body.id,
				thumbnail_url: typeof thumbnail === 'string' ? thumbnail : null,
				metadata: metadata.map(item => ({
					label: languageMapValue((item as Record<string, unknown>)?.label),
					value: languageMapValue((item as Record<string, unknown>)?.value),
				})),
			},
		];
	});
}

export function buildSyntheticManifest(input: {
	manifestUrl: string;
	label: string;
	canvases: IiifSyntheticCanvas[];
}): Record<string, any> {
	return {
		'@context': 'http://iiif.io/api/presentation/3/context.json',
		id: input.manifestUrl,
		type: 'Manifest',
		label: { none: [input.label] },
		items: input.canvases.map(canvas => ({
			id: canvas.canvas_id,
			type: 'Canvas',
			label: { none: [canvas.label] },
			width: canvas.width,
			height: canvas.height,
			...(canvas.thumbnail_url
				? {
						thumbnail: [
							{
								id: canvas.thumbnail_url,
								type: 'Image',
								format: guessImageFormat(canvas.thumbnail_url),
							},
						],
					}
				: {}),
			items: [
				{
					id: `${canvas.canvas_id}/page/1`,
					type: 'AnnotationPage',
					items: [
						{
							id: `${canvas.canvas_id}/painting/1`,
							type: 'Annotation',
							motivation: 'painting',
							target: canvas.canvas_id,
							body: {
								id: canvas.image_url,
								type: 'Image',
								format: guessImageFormat(canvas.image_url),
								width: canvas.width,
								height: canvas.height,
							},
						},
					],
				},
			],
			...(canvas.metadata.length > 0
				? {
						metadata: canvas.metadata.map(item => ({
							label: { none: [item.label] },
							value: { none: [item.value] },
						})),
					}
				: {}),
		})),
	};
}

function languageMapValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return '';
	const first = Object.values(value as Record<string, unknown>)[0];
	return Array.isArray(first) && typeof first[0] === 'string' ? first[0] : '';
}
