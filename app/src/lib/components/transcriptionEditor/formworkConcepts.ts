export type FormWorkContentConcept =
	| 'runningTitle'
	| 'header'
	| 'footer'
	| 'pageLabel'
	| 'lineLabel'
	| 'quireSignature'
	| 'catchword'
	| 'marginalLabel'
	| 'genericFormwork';

export type FormWorkPlacementConcept =
	| 'pageTop'
	| 'pageBottom'
	| 'columnTop'
	| 'columnBottom'
	| 'margin'
	| 'lineAbove'
	| 'lineBelow'
	| 'lineLeft'
	| 'lineRight'
	| 'inline'
	| 'inSpace'
	| 'oppositePage'
	| 'overleaf'
	| 'pageEnd'
	| 'unknown';

export type FormWorkEditorSurface =
	| 'pageChrome'
	| 'pageMetadata'
	| 'lineMetadata'
	| 'pageBoundary'
	| 'marginPlacement'
	| 'interlinearPlacement'
	| 'codicology'
	| 'inlineWidget'
	| 'genericFormwork';

export type FormWorkEntryPoint = 'page' | 'line' | 'codicology' | 'marginalia';

export type MarginaliaCategory = 'Marginal' | 'Interlinear' | 'Column' | 'Inline' | 'Other' | null;

export interface FormWorkClassification {
	concept: FormWorkContentConcept;
	functionConcept: FormWorkContentConcept;
	contentConcept: FormWorkContentConcept;
	placementConcept: FormWorkPlacementConcept;
	label: string;
	description: string;
	editorSurface: FormWorkEditorSurface;
	entryPoint: FormWorkEntryPoint;
	marginaliaCategory: MarginaliaCategory;
	editorStrategy: string;
	placementLabel: string;
	placementDescription: string;
}

export interface FormWorkAttrsLike {
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
}

function normalize(value: unknown): string {
	return String(value || '').trim().toLowerCase();
}

function getAttr(attrs: FormWorkAttrsLike | null | undefined, key: string): string {
	const direct = normalize((attrs as Record<string, unknown> | null | undefined)?.[key]);
	if (direct) return direct;

	if (key.startsWith('seg')) {
		const segKey = key.slice(3);
		const normalizedSegKey = segKey ? segKey[0].toLowerCase() + segKey.slice(1) : segKey;
		return normalize(attrs?.segAttrs?.[normalizedSegKey]);
	}

	return normalize(attrs?.teiAttrs?.[key]);
}

function parsePlaceTokens(...sources: string[]): Set<string> {
	const tokens = new Set<string>();

	for (const source of sources) {
		for (const token of source.split(/\s+/).map(normalize).filter(Boolean)) {
			tokens.add(token);
		}
	}

	return tokens;
}

function classifyPlacement(
	segType: string,
	segSubtype: string,
	placeTokens: Set<string>
): FormWorkPlacementConcept {
	if (segSubtype === 'coltop') {
		return 'columnTop';
	}

	if (segSubtype === 'colbottom') {
		return 'columnBottom';
	}

	if (
		segSubtype === 'lineleft' ||
		(
			placeTokens.has('left') &&
			(placeTokens.has('margin') || segType === 'margin' || segType === 'marginalia')
		)
	) {
		return 'lineLeft';
	}

	if (
		segSubtype === 'lineright' ||
		(
			placeTokens.has('right') &&
			(placeTokens.has('margin') || segType === 'margin' || segType === 'marginalia')
		)
	) {
		return 'lineRight';
	}

	if ((segType === 'line' && segSubtype === 'above') || placeTokens.has('above')) {
		return 'lineAbove';
	}

	if ((segType === 'line' && segSubtype === 'below') || placeTokens.has('below')) {
		return 'lineBelow';
	}

	if (segSubtype === 'pagetop' || placeTokens.has('top')) {
		return 'pageTop';
	}

	if (segSubtype === 'pagebottom' || placeTokens.has('bottom')) {
		return 'pageBottom';
	}

	if (
		segType === 'margin' ||
		segType === 'marginalia' ||
		placeTokens.has('margin') ||
		segSubtype.includes('margin')
	) {
		return 'margin';
	}

	if (placeTokens.has('inline')) {
		return 'inline';
	}

	if (placeTokens.has('inspace')) {
		return 'inSpace';
	}

	if (placeTokens.has('opposite')) {
		return 'oppositePage';
	}

	if (placeTokens.has('overleaf')) {
		return 'overleaf';
	}

	if (placeTokens.has('end')) {
		return 'pageEnd';
	}

	return 'unknown';
}

function classifyContent(
	type: string,
	placement: FormWorkPlacementConcept
): FormWorkContentConcept {
	if (['runtitle', 'runningtitle'].includes(type)) {
		return 'runningTitle';
	}

	if (['header', 'head'].includes(type)) {
		return 'header';
	}

	if (['footer'].includes(type)) {
		return 'footer';
	}

	if (['pagenum', 'pageno', 'pagination', 'folio', 'foliation'].includes(type)) {
		return 'pageLabel';
	}

	if (['linenum', 'lineno', 'linenumber'].includes(type)) {
		return 'lineLabel';
	}

	if (['quiresig', 'quiresignature', 'signature', 'sig'].includes(type)) {
		return 'quireSignature';
	}

	if (['catch', 'catchword'].includes(type)) {
		return 'catchword';
	}

	if (placement === 'pageTop') {
		return 'header';
	}

	if (placement === 'pageBottom') {
		return 'footer';
	}

	if (['margin', 'lineAbove', 'lineBelow', 'lineLeft', 'lineRight', 'columnTop', 'columnBottom'].includes(placement)) {
		return 'marginalLabel';
	}

	return 'genericFormwork';
}

function buildClassification(
	contentConcept: FormWorkContentConcept,
	placementConcept: FormWorkPlacementConcept
): FormWorkClassification {
	const placementInfo = getPlacementInfo(placementConcept);
	const entryPoint = getEntryPoint(contentConcept);
	const marginaliaCategory =
		entryPoint === 'marginalia' ? getMarginaliaCategory(placementConcept) : null;

	switch (contentConcept) {
		case 'runningTitle':
			return {
				concept: contentConcept,
				functionConcept: contentConcept,
				contentConcept,
				placementConcept,
				label: 'Running Title',
				description: 'A recurring title or book label carried in page chrome rather than the main text flow.',
				editorSurface: 'pageChrome',
				entryPoint,
				marginaliaCategory,
				editorStrategy: 'Use a page-header/running-title control and collapse it to fw on export.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
		case 'header':
			return {
				concept: contentConcept,
				functionConcept: contentConcept,
				contentConcept,
				placementConcept,
				label: 'Page Header',
				description: 'Top-of-page header content that belongs to page chrome.',
				editorSurface: 'pageChrome',
				entryPoint,
				marginaliaCategory,
				editorStrategy: 'Represent it in page-level chrome controls, not as ordinary transcription text.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
		case 'footer':
			return {
				concept: contentConcept,
				functionConcept: contentConcept,
				contentConcept,
				placementConcept,
				label: 'Page Footer',
				description: 'Bottom-of-page footer content outside the normal transcription flow.',
				editorSurface: 'pageBoundary',
				entryPoint,
				marginaliaCategory,
				editorStrategy: 'Treat it as page-boundary layout content with dedicated footer/catchword controls.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
		case 'pageLabel':
			return {
				concept: contentConcept,
				functionConcept: contentConcept,
				contentConcept,
				placementConcept,
				label: 'Page Label',
				description: 'A page number, folio label, or pagination mark tied to page identity.',
				editorSurface: 'pageMetadata',
				entryPoint,
				marginaliaCategory,
				editorStrategy: 'Use page metadata UI as the primary editor surface and export to fw when needed.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
		case 'lineLabel':
			return {
				concept: contentConcept,
				functionConcept: contentConcept,
				contentConcept,
				placementConcept,
				label: 'Line Label',
				description: 'A line number or line-identifying label that should stay tied to line structure.',
				editorSurface: 'lineMetadata',
				entryPoint,
				marginaliaCategory,
				editorStrategy: 'Edit it through line metadata controls rather than inline prose editing.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
		case 'quireSignature':
			return {
				concept: contentConcept,
				functionConcept: contentConcept,
				contentConcept,
				placementConcept,
				label: 'Quire Signature',
				description: 'A codicological signature or quire label associated with manuscript structure.',
				editorSurface: 'codicology',
				entryPoint,
				marginaliaCategory,
				editorStrategy: 'Use a codicology-focused inspector and export it as fw only at the TEI boundary.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
		case 'catchword':
			return {
				concept: contentConcept,
				functionConcept: contentConcept,
				contentConcept,
				placementConcept,
				label: 'Catchword',
				description: 'A catchword used at a page boundary to support reading order across openings.',
				editorSurface: 'pageBoundary',
				entryPoint,
				marginaliaCategory,
				editorStrategy: 'Represent it as a page-boundary widget and export it as bottom-placed fw.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
		case 'marginalLabel':
			return {
				concept: contentConcept,
				functionConcept: contentConcept,
				contentConcept,
				placementConcept,
				label: placementConcept === 'lineAbove' || placementConcept === 'lineBelow'
					? 'Interlinear Annotation'
					: 'Margin Annotation',
				description: placementConcept === 'lineAbove' || placementConcept === 'lineBelow'
					? 'A layout annotation positioned relative to a line, such as above-line or below-line content.'
					: 'A margin- or column-bound layout annotation rather than running text.',
				editorSurface:
					placementConcept === 'lineAbove' || placementConcept === 'lineBelow'
						? 'interlinearPlacement'
						: 'marginPlacement',
				entryPoint,
				marginaliaCategory,
				editorStrategy:
					placementConcept === 'lineAbove' || placementConcept === 'lineBelow'
						? 'Use a line-attachment widget with explicit above/below placement controls.'
						: 'Use a margin/column placement widget with side and boundary controls.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
		case 'genericFormwork':
		default:
			return {
				concept: 'genericFormwork',
				functionConcept: 'genericFormwork',
				contentConcept: 'genericFormwork',
				placementConcept,
				label: 'Layout Annotation',
				description: 'Layout-bound content that is distinct from the main transcription but not yet a narrower editor concept.',
				editorSurface:
					placementConcept === 'inline' || placementConcept === 'inSpace'
						? 'inlineWidget'
						: 'genericFormwork',
				entryPoint,
				marginaliaCategory,
				editorStrategy:
					placementConcept === 'inline' || placementConcept === 'inSpace'
						? 'Keep as a small inline layout widget until a stronger concept emerges.'
						: 'Keep as a dedicated layout-annotation widget and refine once manuscript-specific usage is clearer.',
				placementLabel: placementInfo.label,
				placementDescription: placementInfo.description,
			};
	}
}

function getEntryPoint(contentConcept: FormWorkContentConcept): FormWorkEntryPoint {
	if (['runningTitle', 'header', 'footer', 'pageLabel', 'catchword'].includes(contentConcept)) {
		return 'page';
	}

	if (contentConcept === 'lineLabel') {
		return 'line';
	}

	if (contentConcept === 'quireSignature') {
		return 'codicology';
	}

	return 'marginalia';
}

function getMarginaliaCategory(placementConcept: FormWorkPlacementConcept): MarginaliaCategory {
	if (placementConcept === 'lineAbove' || placementConcept === 'lineBelow') {
		return 'Interlinear';
	}

	if (placementConcept === 'columnTop' || placementConcept === 'columnBottom') {
		return 'Column';
	}

	if (
		placementConcept === 'margin' ||
		placementConcept === 'lineLeft' ||
		placementConcept === 'lineRight'
	) {
		return 'Marginal';
	}

	if (placementConcept === 'inline' || placementConcept === 'inSpace') {
		return 'Inline';
	}

	return 'Other';
}

function getPlacementInfo(placementConcept: FormWorkPlacementConcept): {
	label: string;
	description: string;
} {
	switch (placementConcept) {
		case 'pageTop':
			return { label: 'Page Top', description: 'Placed at the top of the page.' };
		case 'pageBottom':
			return { label: 'Page Bottom', description: 'Placed at the foot or lower boundary of the page.' };
		case 'columnTop':
			return { label: 'Column Top', description: 'Placed at the top of a text column.' };
		case 'columnBottom':
			return { label: 'Column Bottom', description: 'Placed at the bottom of a text column.' };
		case 'margin':
			return { label: 'Margin', description: 'Placed in a margin outside the main text block.' };
		case 'lineAbove':
			return { label: 'Above Line', description: 'Placed above the main text line.' };
		case 'lineBelow':
			return { label: 'Below Line', description: 'Placed below the main text line.' };
		case 'lineLeft':
			return { label: 'Line Left', description: 'Placed to the left side of the relevant line.' };
		case 'lineRight':
			return { label: 'Line Right', description: 'Placed to the right side of the relevant line.' };
		case 'inline':
			return { label: 'Inline', description: 'Placed inline with the main text.' };
		case 'inSpace':
			return { label: 'Reserved Space', description: 'Placed in a predefined or reserved space.' };
		case 'oppositePage':
			return { label: 'Opposite Page', description: 'Placed on the facing page.' };
		case 'overleaf':
			return { label: 'Overleaf', description: 'Placed on the other side of the leaf.' };
		case 'pageEnd':
			return { label: 'At End', description: 'Placed at the end of a page or textual unit.' };
		case 'unknown':
		default:
			return {
				label: 'Unspecified Placement',
				description: 'No stronger placement concept can be inferred yet from the available TEI attrs.',
			};
	}
}

export function classifyFormWork(attrs: FormWorkAttrsLike | null | undefined): FormWorkClassification {
	const type = getAttr(attrs, 'type');
	const segType = getAttr(attrs, 'segType');
	const segSubtype = getAttr(attrs, 'segSubtype');
	const placeTokens = parsePlaceTokens(getAttr(attrs, 'place'), getAttr(attrs, 'segPlace'));
	const placementConcept = classifyPlacement(segType, segSubtype, placeTokens);
	const contentConcept = classifyContent(type, placementConcept);

	return buildClassification(contentConcept, placementConcept);
}
