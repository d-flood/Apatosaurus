import type { IntfImportEntry, IntfImportMetadata, ManifestSourceSummary } from './types';

interface RawIntfImage {
	webFriendlyURL?: unknown;
	uri?: unknown;
	thumbURL?: unknown;
	viewURL?: unknown;
	surrID?: unknown;
}

interface RawIntfPage {
	pageID?: unknown;
	folio?: unknown;
	shelfFolioNums?: unknown;
	sortOrder?: unknown;
	images?: {
		image?: RawIntfImage | RawIntfImage[] | null;
	} | null;
}

interface ParsedIntfPageImage {
	pageId: number | null;
	pageOrder: number;
	folio: string | null;
	shelfFolioNums: string | null;
	sortOrder: number | null;
	imageUrl: string;
	thumbnailUrl: string | null;
	viewUrl: string | null;
	surrId: number | null;
	label: string;
}

const DEFAULT_INTF_IMAGE_DIMENSIONS = { width: 1500, height: 2000 } as const;
const INTF_IMAGE_PROBE_TIMEOUT_MS = 8000;

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

function toArray<T>(value: T | T[] | null | undefined): T[] {
	if (Array.isArray(value)) return value;
	if (value == null) return [];
	return [value];
}

function asTrimmedString(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

function validateHttpUrl(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`Invalid INTF image URL: ${value}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`Only http(s) INTF image URLs are supported: ${value}`);
	}
	return parsed.toString();
}

function pickIntfImageUrl(image: RawIntfImage): string | null {
	const candidates = [image.webFriendlyURL, image.uri, image.thumbURL]
		.map(asTrimmedString)
		.filter((value): value is string => Boolean(value));
	for (const candidate of candidates) {
		try {
			return validateHttpUrl(candidate);
		} catch {
			continue;
		}
	}
	return null;
}

function getIntfEntryLabel(input: {
	folio: string | null;
	shelfFolioNums: string | null;
	pageId: number | null;
	surrId: number | null;
	duplicateIndex: number;
	totalForPage: number;
}): string {
	const baseLabel = input.folio || input.shelfFolioNums || (input.pageId ? `Page ${input.pageId}` : 'INTF image');
	if (input.totalForPage <= 1) return baseLabel;
	if (input.surrId !== null) return `${baseLabel} (surr ${input.surrId})`;
	return `${baseLabel} (${input.duplicateIndex + 1})`;
}

function getManifestLabel(input: { primaryName: string | null; docId: number | null; imageCount: number }): string {
	if (input.primaryName && input.docId !== null) {
		return `${input.primaryName} (INTF ${input.docId})`;
	}
	if (input.primaryName) return `${input.primaryName} (INTF)`;
	if (input.docId !== null) return `INTF manuscript ${input.docId}`;
	return `INTF manuscript (${input.imageCount} images)`;
}

export function buildIntfManifestUrl(input: {
	docId: number | null;
	pageImages: Array<Pick<ParsedIntfPageImage, 'pageId' | 'sortOrder' | 'surrId' | 'imageUrl'>>;
}): string {
	const docPart = input.docId !== null ? String(input.docId) : 'unknown';
	const fingerprint = input.pageImages
		.map(image => `${image.pageId ?? 'x'}:${image.sortOrder ?? 'x'}:${image.surrId ?? 'x'}:${image.imageUrl}`)
		.join('\n');
	return `urn:apatopwa:iiif:intf:${docPart}:${hashString(fingerprint)}`;
}

export function createIntfImportMetadata(input: {
	docId: number | null;
	primaryName: string | null;
	pageCount: number;
	imageCount: number;
}): IntfImportMetadata {
	return {
		inputKind: 'intf-manuscript-json',
		synthetic: true,
		docId: input.docId,
		primaryName: input.primaryName,
		pageCount: input.pageCount,
		imageCount: input.imageCount,
	};
}

export function isIntfManifestSource(source: ManifestSourceSummary | null | undefined): boolean {
	return source?.metadata?.inputKind === 'intf-manuscript-json';
}

export function parseIntfPageImages(input: string): {
	docId: number | null;
	primaryName: string | null;
	label: string;
	pageCount: number;
	pageImages: ParsedIntfPageImage[];
} {
	const normalized = normalizeWhitespace(input);
	if (!normalized) {
		throw new Error('Paste an INTF manuscript JSON response.');
	}

	let parsed: any;
	try {
		parsed = JSON.parse(normalized);
	} catch {
		throw new Error('INTF input is not valid JSON.');
	}

	if (parsed?.status && parsed.status !== 'success') {
		throw new Error(`INTF response status was ${String(parsed.status)}.`);
	}

	const manuscript = parsed?.data?.manuscript;
	const rawPages = manuscript?.pages?.page;
	const pages = toArray<RawIntfPage>(rawPages);
	if (pages.length === 0) {
		throw new Error('INTF manuscript JSON does not contain any pages.');
	}

	const docId = asNumber(manuscript?.docID);
	const primaryName = asTrimmedString(manuscript?.primaryName);
	const pageImages: ParsedIntfPageImage[] = [];

	pages.forEach((page, pageIndex) => {
		const images = toArray<RawIntfImage>(page?.images?.image);
		if (images.length === 0) return;

		const pageId = asNumber(page.pageID);
		const folio = asTrimmedString(page.folio);
		const shelfFolioNums = asTrimmedString(page.shelfFolioNums);
		const sortOrder = asNumber(page.sortOrder);
		const totalForPage = images.length;

		images.forEach((image, imageIndex) => {
			const imageUrl = pickIntfImageUrl(image);
			if (!imageUrl) return;
			const surrId = asNumber(image.surrID);
			pageImages.push({
				pageId,
				pageOrder: pageIndex + 1,
				folio,
				shelfFolioNums,
				sortOrder,
				imageUrl,
				thumbnailUrl: asTrimmedString(image.thumbURL),
				viewUrl: asTrimmedString(image.viewURL),
				surrId,
				label: getIntfEntryLabel({
					folio,
					shelfFolioNums,
					pageId,
					surrId,
					duplicateIndex: imageIndex,
					totalForPage,
				}),
			});
		});
	});

	if (pageImages.length === 0) {
		throw new Error('INTF manuscript JSON does not contain any importable image URLs.');
	}

	pageImages.sort(
		(a, b) =>
			(a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
			a.pageOrder - b.pageOrder ||
			(a.surrId ?? Number.MAX_SAFE_INTEGER) - (b.surrId ?? Number.MAX_SAFE_INTEGER) ||
			a.imageUrl.localeCompare(b.imageUrl)
	);

	return {
		docId,
		primaryName,
		label: getManifestLabel({ primaryName, docId, imageCount: pageImages.length }),
		pageCount: pages.length,
		pageImages,
	};
}

export function buildIntfManifest(input: {
	manifestUrl: string;
	label: string;
	images: IntfImportEntry[];
}): Record<string, any> {
	return {
		'@context': 'http://iiif.io/api/presentation/3/context.json',
		id: input.manifestUrl,
		type: 'Manifest',
		label: { none: [input.label] },
		items: input.images.map(image => ({
			id: image.canvasId,
			type: 'Canvas',
			label: { none: [image.label] },
			width: image.width,
			height: image.height,
			thumbnail: image.thumbnailUrl
				? [
						{
							id: image.thumbnailUrl,
							type: 'Image',
							format: guessImageFormat(image.thumbnailUrl),
						},
					]
				: undefined,
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
								id: image.imageUrl,
								type: 'Image',
								format: guessImageFormat(image.imageUrl),
								width: image.width,
								height: image.height,
							},
						},
					],
				},
			],
			metadata: [
				...(image.folio
					? [{ label: { none: ['folio'] }, value: { none: [image.folio] } }]
					: []),
				...(image.shelfFolioNums
					? [{ label: { none: ['shelfFolioNums'] }, value: { none: [image.shelfFolioNums] } }]
					: []),
				...(image.pageId !== null
					? [{ label: { none: ['pageID'] }, value: { none: [String(image.pageId)] } }]
					: []),
			],
		})),
	};
}

interface IntfImportProgressOptions {
	onStageChange?: (stage: 'parsing' | 'probing-images' | 'building-manifest') => void;
}

export async function importIntfManuscript(
	input: string,
	options: IntfImportProgressOptions = {}
): Promise<{
	manifestUrl: string;
	label: string;
	manifestJson: Record<string, any>;
	metadata: IntfImportMetadata;
	entries: IntfImportEntry[];
}> {
	options.onStageChange?.('parsing');
	const parsed = parseIntfPageImages(input);
	const manifestUrl = buildIntfManifestUrl({
		docId: parsed.docId,
		pageImages: parsed.pageImages,
	});
	options.onStageChange?.('probing-images');
	const entries = await Promise.all(
		parsed.pageImages.map(async (image, index): Promise<IntfImportEntry> => {
			const dimensions = await probeImageDimensionsWithFallback(image.imageUrl);
			const canvasId = `${manifestUrl}/canvas/${index + 1}`;
			return {
				...image,
				width: dimensions.width,
				height: dimensions.height,
				canvasId,
				annotationPageId: `${canvasId}/page/1`,
				annotationId: `${canvasId}/painting/1`,
			};
		})
	);
	options.onStageChange?.('building-manifest');

	return {
		manifestUrl,
		label: parsed.label,
		manifestJson: buildIntfManifest({ manifestUrl, label: parsed.label, images: entries }),
		metadata: createIntfImportMetadata({
			docId: parsed.docId,
			primaryName: parsed.primaryName,
			pageCount: parsed.pageCount,
			imageCount: entries.length,
		}),
		entries,
	};
}

async function probeImageDimensionsWithFallback(
	url: string
): Promise<{ width: number; height: number }> {
	try {
		return await probeImageDimensions(url);
	} catch {
		return { ...DEFAULT_INTF_IMAGE_DIMENSIONS };
	}
}

function probeImageDimensions(url: string): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		const timeout = window.setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out while loading INTF image URL: ${url}`));
		}, INTF_IMAGE_PROBE_TIMEOUT_MS);

		function cleanup() {
			window.clearTimeout(timeout);
			image.onload = null;
			image.onerror = null;
		}

		image.onload = () => {
			cleanup();
			if (!image.naturalWidth || !image.naturalHeight) {
				reject(new Error(`Image did not report dimensions: ${url}`));
				return;
			}
			resolve({ width: image.naturalWidth, height: image.naturalHeight });
		};
		image.onerror = () => {
			cleanup();
			reject(new Error(`Could not load INTF image URL: ${url}`));
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
