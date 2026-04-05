export interface PageRef {
	pageId: string;
	pageName: string | null;
	pageOrder: number;
}

export interface CanvasRef {
	manifestId: string;
	canvasId: string;
	canvasLabel: string;
	canvasOrder: number;
	imageServiceUrl: string | null;
	thumbnailUrl: string | null;
}

export interface ManifestSourceSummary {
	id: string;
	transcriptionId: string;
	manifestUrl: string;
	label: string;
	sourceKind: 'external' | 'app';
	defaultCanvasId: string | null;
	defaultImageServiceUrl: string | null;
	manifestJson: Record<string, any> | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export type IiifSourceCategory = 'iiif' | 'intf' | 'urls';
export type IiifWorkspaceSelection = string | 'composite';

export interface ExternalImageImportMetadata {
	inputKind: 'external-image-list';
	synthetic: true;
	imageUrls: string[];
	imageCount: number;
}

export interface IntfImportMetadata {
	inputKind: 'intf-manuscript-json';
	synthetic: true;
	docId: number | null;
	primaryName: string | null;
	pageCount: number;
	imageCount: number;
}

export interface IntfImportEntry {
	pageId: number | null;
	pageOrder: number;
	folio: string | null;
	shelfFolioNums: string | null;
	sortOrder: number | null;
	imageUrl: string;
	thumbnailUrl: string | null;
	viewUrl: string | null;
	surrId: number | null;
	canvasId: string;
	annotationPageId: string;
	annotationId: string;
	label: string;
	width: number;
	height: number;
}

export interface IntfAutoLinkPage {
	pageId: string;
	pageName: string | null;
	pageOrder: number;
	matchCandidates: string[];
}

export interface IntfAutoLinkCanvas {
	canvasId: string;
	canvasLabel: string;
	canvasOrder: number;
	imageServiceUrl: string | null;
	thumbnailUrl: string | null;
	folio: string | null;
	shelfFolioNums: string | null;
	sortOrder: number | null;
}

export interface IntfAutoLinkAssignment {
	page: IntfAutoLinkPage;
	canvas: IntfAutoLinkCanvas;
	score: number;
	matchedOn: string;
}

export interface IntfAutoLinkResult {
	assignments: IntfAutoLinkAssignment[];
	matchedCount: number;
	ambiguousCount: number;
	skippedCount: number;
	message: string;
}

export interface PageCanvasLink {
	id: string;
	transcriptionId: string;
	pageId: string;
	pageNameSnapshot: string;
	pageOrder: number;
	manifestSourceId: string;
	manifestUrlSnapshot: string;
	canvasId: string;
	canvasOrder: number;
	canvasLabel: string;
	imageServiceUrl: string | null;
	thumbnailUrl: string | null;
	linkRole: string;
	createdAt: string;
	updatedAt: string;
}

export interface CompositeCanvasSourceRef {
	manifestSourceId: string;
	sourceCanvasId: string;
	pageId: string;
	pageOrder: number;
}

export interface TranscriptionSelectionQuote {
	text: string;
	pageId: string;
	pageName: string | null;
	pageOrder: number;
	from: number;
	to: number;
}

export interface SavePageCanvasLinkInput {
	transcriptionId: string;
	pageId: string;
	pageNameSnapshot: string;
	pageOrder: number;
	manifestSourceId: string;
	manifestUrlSnapshot: string;
	canvasId: string;
	canvasOrder: number;
	canvasLabel: string;
	imageServiceUrl: string | null;
	thumbnailUrl: string | null;
	linkRole?: string;
}

export interface AnnotationAnchor {
	pageId: string;
	pageName?: string | null;
	pageOrder?: number;
	role?: 'page' | 'column' | 'line' | 'line-range' | 'marginalia' | 'note' | 'word-region';
	columnId?: string | null;
	columnNumber?: number | null;
	lineId?: string | null;
	lineNumber?: number | null;
	lineEndId?: string | null;
	lineEndNumber?: number | null;
	marginaliaId?: string | null;
	quote?: string | null;
	canvasId?: string;
	manifestSourceId?: string;
}

export interface SmartLinkAssignment {
	page: PageRef;
	canvas: CanvasRef;
}

export interface SmartLinkPlan {
	status: 'ready' | 'mismatch' | 'invalid';
	assignments: SmartLinkAssignment[];
	pageCount: number;
	canvasCount: number;
	message: string;
}
