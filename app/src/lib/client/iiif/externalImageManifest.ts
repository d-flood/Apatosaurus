import type { ExternalImageImportMetadata, ManifestSourceSummary } from './types';

export interface ExternalImageProbe {
	url: string;
	width: number;
	height: number;
	label: string;
	canvasId: string;
	annotationId: string;
	annotationPageId: string;
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\r\n?/g, '\n').trim();
}

function hashString(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function decodePathSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function parseExternalImageUrls(input: string): string[] {
	const normalized = normalizeWhitespace(input);
	if (!normalized) return [];
	return normalized
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);
}

export function validateExternalImageUrl(value: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`Invalid URL: ${value}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`Only http(s) image URLs are supported: ${value}`);
	}
	return parsed;
}

export function getExternalImageLabel(url: string, index: number): string {
	try {
		const parsed = new URL(url);
		const pathname = parsed.pathname.replace(/\/+$/, '');
		const filename = pathname.split('/').filter(Boolean).pop();
		if (filename) {
			const decoded = decodePathSegment(filename).replace(/\.[a-z0-9]+$/i, '');
			if (decoded) return decoded;
		}
	} catch {
		// ignore and fall back
	}
	return `Image ${index + 1}`;
}

export function buildSyntheticManifestUrl(imageUrls: string[]): string {
	const normalized = imageUrls.map(url => validateExternalImageUrl(url).toString());
	return `urn:apatopwa:iiif:external-images:${hashString(normalized.join('\n'))}`;
}

export function createExternalImageImportMetadata(
	imageUrls: string[]
): ExternalImageImportMetadata {
	const normalized = imageUrls.map(url => validateExternalImageUrl(url).toString());
	return {
		inputKind: 'external-image-list',
		synthetic: true,
		imageUrls: normalized,
		imageCount: normalized.length,
	};
}

export function isExternalImageManifestSource(source: ManifestSourceSummary | null | undefined): boolean {
	return source?.metadata?.inputKind === 'external-image-list';
}

export function buildExternalImageManifest(input: {
	manifestUrl: string;
	label?: string;
	images: Array<Pick<ExternalImageProbe, 'url' | 'width' | 'height' | 'label' | 'canvasId' | 'annotationId' | 'annotationPageId'>>;
}): Record<string, any> {
	return {
		'@context': 'http://iiif.io/api/presentation/3/context.json',
		id: input.manifestUrl,
		type: 'Manifest',
		label: { none: [input.label || `External images (${input.images.length})`] },
		items: input.images.map(image => ({
			id: image.canvasId,
			type: 'Canvas',
			label: { none: [image.label] },
			width: image.width,
			height: image.height,
			items: [
				{
					id: image.annotationPageId,
					type: 'AnnotationPage',
					items: [
						{
							id: image.annotationId,
							type: 'Annotation',
							motivation: 'painting',
							target: image.canvasId,
							body: {
								id: image.url,
								type: 'Image',
								format: guessImageFormat(image.url),
								width: image.width,
								height: image.height,
							},
						},
					],
				},
			],
		})),
	};
}

export async function probeExternalImageUrls(input: string): Promise<ExternalImageProbe[]> {
	const urls = parseExternalImageUrls(input);
	if (urls.length === 0) {
		throw new Error('Enter at least one external image URL.');
	}

	const manifestUrl = buildSyntheticManifestUrl(urls);
	const probes: ExternalImageProbe[] = [];
	for (const [index, rawUrl] of urls.entries()) {
		const url = validateExternalImageUrl(rawUrl).toString();
		const dimensions = await probeImageDimensions(url);
		const canvasId = `${manifestUrl}/canvas/${index + 1}`;
		probes.push({
			url,
			width: dimensions.width,
			height: dimensions.height,
			label: getExternalImageLabel(url, index),
			canvasId,
			annotationPageId: `${canvasId}/page/1`,
			annotationId: `${canvasId}/painting/1`,
		});
	}
	return probes;
}

function probeImageDimensions(url: string): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			if (!image.naturalWidth || !image.naturalHeight) {
				reject(new Error(`Image did not report dimensions: ${url}`));
				return;
			}
			resolve({ width: image.naturalWidth, height: image.naturalHeight });
		};
		image.onerror = () => {
			reject(new Error(`Could not load image URL: ${url}`));
		};
		image.src = url;
	});
}

function guessImageFormat(url: string): string {
	const pathname = (() => {
		try {
			return new URL(url).pathname.toLowerCase();
		} catch {
			return url.toLowerCase();
		}
	})();
	if (pathname.endsWith('.png')) return 'image/png';
	if (pathname.endsWith('.gif')) return 'image/gif';
	if (pathname.endsWith('.webp')) return 'image/webp';
	if (pathname.endsWith('.tif') || pathname.endsWith('.tiff')) return 'image/tiff';
	if (pathname.endsWith('.jp2')) return 'image/jp2';
	if (pathname.endsWith('.avif')) return 'image/avif';
	if (pathname.endsWith('.svg')) return 'image/svg+xml';
	return 'image/jpeg';
}
