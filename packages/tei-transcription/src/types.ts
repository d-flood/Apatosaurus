export interface TranscriptionDocument {
	type: 'transcriptionDocument';
	pages: TranscriptionPage[];
	metadata?: TeiMetadata;
	header?: TeiHeaderInfo;
	teiAttrs?: Record<string, string>;
	textAttrs?: Record<string, string>;
	bodyAttrs?: Record<string, string>;
	teiHeader?: TeiElementNode;
	front?: TeiElementNode;
	back?: TeiElementNode;
	textLeading?: TeiNode[];
	textBetweenFrontBody?: TeiNode[];
	textBetweenBodyBack?: TeiNode[];
	textTrailing?: TeiNode[];
	resourceNodes?: TeiElementNode[];
	nestedTei?: TeiElementNode[];
	facsimile?: TeiElementNode[];
	standOff?: TeiElementNode[];
	sourceDoc?: TeiElementNode[];
}

export type TeiNode = TeiElementNode | TeiTextNode;

export interface TeiElementNode {
	type: 'element';
	tag: string;
	attrs?: Record<string, string>;
	children?: TeiNode[];
}

export interface TeiTextNode {
	type: 'text';
	text: string;
}

export interface TranscriptionPage {
	type: 'page';
	id: string;
	pageId?: string;
	wrapped?: boolean;
	teiAttrs?: Record<string, string>;
	columns: TranscriptionColumn[];
}

export type FrameZone = 'top' | 'left' | 'center' | 'right' | 'bottom';

export interface TranscriptionColumn {
	type: 'column';
	number: number;
	wrapped?: boolean;
	zone?: FrameZone;
	teiAttrs?: Record<string, string>;
	lines: TranscriptionLine[];
}

export interface TranscriptionLine {
	type: 'line';
	number: number;
	wrapped?: boolean;
	paragraphStart?: boolean;
	teiAttrs?: Record<string, string>;
	items: LineItem[];
}

export type LineItem =
	| TextItem
	| BoundaryItem
	| MilestoneItem
	| TeiMilestoneItem
	| GapItem
	| SpaceItem
	| HandShiftItem
	| MetamarkItem
	| TeiAtomItem
	| TeiWrapperItem
	| EditorialActionItem
	| UntranscribedItem
	| CorrectionOnlyItem
	| FormWorkItem;

export interface TextItem {
	type: 'text';
	text: string;
	marks?: TextMark[];
}

export interface BoundaryItem {
	type: 'boundary';
	kind: 'word';
}

export interface MilestoneItem {
	type: 'milestone';
	kind: 'book' | 'chapter' | 'verse';
	attrs: Record<string, string>;
}

export interface TeiMilestoneItem {
	type: 'teiMilestone';
	attrs: Record<string, string>;
}

export interface GapItem {
	type: 'gap';
	attrs: {
		reason?: string;
		unit?: string;
		extent?: string;
	};
}

export interface SpaceItem {
	type: 'space';
	attrs: Record<string, string>;
}

export interface HandShiftItem {
	type: 'handShift';
	attrs: Record<string, string>;
}

export interface MetamarkItem {
	type: 'metamark';
	attrs: Record<string, string>;
	summary: string;
	wordInline?: boolean;
}

export interface TeiAtomItem {
	type: 'teiAtom';
	tag: 'gb' | 'ptr' | 'media' | 'note' | 'ellipsis';
	summary: string;
	attrs?: Record<string, string>;
	node: TeiElementNode;
	wordInline?: boolean;
	text?: string;
}

export interface TeiWrapperItem {
	type: 'teiWrapper';
	tag: string;
	summary: string;
	attrs?: Record<string, string>;
	children: TeiNode[];
	wordInline?: boolean;
	text?: string;
}

export interface EditorialActionItem {
	type: 'editorialAction';
	tag: 'undo' | 'redo' | 'substJoin' | 'transpose' | 'listTranspose';
	summary: string;
	attrs?: Record<string, string>;
	structure?: EditorialActionStructure;
}

export type EditorialActionStructure =
	| EditorialPointerAction
	| EditorialTranspose
	| EditorialTransposeList;

export interface EditorialPointerAction {
	kind: 'undo' | 'redo' | 'substJoin';
	attrs?: Record<string, string>;
	targets: string[];
}

export interface EditorialTranspose {
	kind: 'transpose';
	attrs?: Record<string, string>;
	targets: string[];
}

export interface EditorialTransposeList {
	kind: 'listTranspose';
	attrs?: Record<string, string>;
	items: EditorialTranspose[];
}

export interface UntranscribedItem {
	type: 'untranscribed';
	attrs: {
		reason?: string;
		extent?: string;
	};
}

export interface CorrectionOnlyItem {
	type: 'correctionOnly';
	corrections: CorrectionReading[];
}

export interface FormWorkItem {
	type: 'fw';
	attrs: {
		type?: string;
		subtype?: string;
		place?: string;
		hand?: string;
		n?: string;
		rend?: string;
		teiAttrs?: Record<string, string>;
		segType?: string;
		segSubtype?: string;
		segPlace?: string;
		segHand?: string;
		segRend?: string;
		segN?: string;
		segAttrs?: Record<string, string>;
	};
	content: InlineItem[];
}

export type InlineItem =
	| TextItem
	| BoundaryItem
	| InlinePageBreakItem
	| InlineLineBreakItem
	| InlineColumnBreakItem
	| GapItem
	| SpaceItem
	| HandShiftItem
	| MetamarkItem
	| TeiAtomItem
	| TeiWrapperItem
	| TeiMilestoneItem
	| CorrectionOnlyItem
	| FormWorkItem;

export interface InlinePageBreakItem {
	type: 'pageBreak';
	attrs?: Record<string, string>;
}

export interface InlineLineBreakItem {
	type: 'lineBreak';
	attrs?: Record<string, string>;
}

export interface InlineColumnBreakItem {
	type: 'columnBreak';
	attrs?: Record<string, string>;
}

export type TextMark =
	| { type: 'lacunose'; attrs: Record<string, string> }
	| { type: 'unclear'; attrs: Record<string, string> }
	| { type: 'punctuation'; attrs?: Record<string, string> }
	| { type: 'word'; attrs: Record<string, string> }
	| { type: 'abbreviation'; attrs: { type?: string; expansion?: string; rend?: string } }
	| { type: 'hi'; attrs: Record<string, string> }
	| { type: 'damage'; attrs: Record<string, string> }
	| { type: 'surplus'; attrs: Record<string, string> }
	| { type: 'secl'; attrs: Record<string, string> }
	| { type: 'teiSpan'; attrs: { tag: string; teiAttrs: Record<string, string> } }
	| { type: 'correction'; attrs: { corrections: CorrectionReading[] } };

export interface CorrectionReading {
	hand: string;
	content: InlineItem[];
	type?: string;
	position?: string;
	rend?: string;
	segmentAttrs?: Record<string, string>;
	readingAttrs?: Record<string, string>;
}

export interface TeiMetadata {
	title?: string;
	transcriber?: string;
	date?: string;
	repository?: string;
	settlement?: string;
	idno?: string;
	language?: string;
}

export interface TeiHeaderInfo {
	titles?: TeiTitle[];
	responsibilities?: TeiResponsibility[];
	msIdentifier?: TeiMsIdentifier;
	msDescription?: TeiMsDescriptionInfo;
	language?: string;
	witnessIds?: string[];
	publication?: TeiPublicationInfo;
	encoding?: TeiEncodingInfo;
	encodingVersion?: string;
	revisionChanges?: TeiRevisionChange[];
	publicationDate?: string;
}

export interface TeiTitle {
	text: string;
	type?: string;
	lang?: string;
	n?: string;
	key?: string;
}

export interface TeiResponsibility {
	resp: string;
	name?: string;
	nameType?: string;
	when?: string;
}

export interface TeiMsIdentifier {
	country?: string;
	settlement?: string;
	repository?: string;
	idno?: string;
}

export interface TeiMsDescriptionInfo {
	msName?: string;
	objectType?: string;
	material?: string;
	origDate?: string;
	origPlace?: string;
	foliation?: string;
	condition?: string;
	layouts?: TeiLayoutInfo[];
	hands?: TeiHandInfo[];
	contents?: TeiMsItemInfo[];
	provenance?: string[];
	surrogates?: string[];
}

export interface TeiLayoutInfo {
	columns?: string;
	writtenLines?: string;
	text?: string;
}

export interface TeiHandInfo {
	attrs?: Record<string, string>;
	text?: string;
}

export interface TeiMsItemInfo {
	locus?: string;
	titles?: string[];
	authors?: string[];
	textLang?: string;
	notes?: string[];
}

export interface TeiRevisionChange {
	n?: string;
	when?: string;
	text: string;
}

export interface TeiPublicationInfo {
	publisher?: string;
	date?: string;
	availability?: string;
}

export interface TeiEncodingInfo {
	version?: string;
	projectDesc?: string;
	editorialDecl?: string;
	variantEncodingMethod?: string;
	variantEncodingLocation?: string;
}

export interface PlainTextOptions {
	includeHeader?: boolean;
	includePageBreaks?: boolean;
	includeLineNumbers?: boolean;
}

export interface ProseMirrorJSON {
	type: string;
	attrs?: Record<string, any>;
	content?: ProseMirrorJSON[];
	marks?: Array<{ type: string; attrs?: Record<string, any> }>;
	text?: string;
}
