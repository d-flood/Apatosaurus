type FormWorkContentConcept =
	| 'runningTitle'
	| 'header'
	| 'footer'
	| 'pageLabel'
	| 'lineLabel'
	| 'quireSignature'
	| 'catchword'
	| 'marginalLabel'
	| 'genericFormwork';

type FormWorkPlacementConcept =
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

type FormWorkEntryPoint = 'page' | 'line' | 'codicology' | 'marginalia';

export type MarginaliaCategory = 'Marginal' | 'Interlinear' | 'Column' | 'Inline' | 'Other' | null;

export interface FormWorkClassification {
	contentConcept: FormWorkContentConcept;
	placementConcept: FormWorkPlacementConcept;
	label: string;
	entryPoint: FormWorkEntryPoint;
	marginaliaCategory: MarginaliaCategory;
	placementLabel: string;
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
	return String(value || '')
		.trim()
		.toLowerCase();
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
		(placeTokens.has('left') &&
			(placeTokens.has('margin') || segType === 'margin' || segType === 'marginalia'))
	) {
		return 'lineLeft';
	}

	if (
		segSubtype === 'lineright' ||
		(placeTokens.has('right') &&
			(placeTokens.has('margin') || segType === 'margin' || segType === 'marginalia'))
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

	if (
		[
			'margin',
			'lineAbove',
			'lineBelow',
			'lineLeft',
			'lineRight',
			'columnTop',
			'columnBottom',
		].includes(placement)
	) {
		return 'marginalLabel';
	}

	return 'genericFormwork';
}

function buildClassification(
	contentConcept: FormWorkContentConcept,
	placementConcept: FormWorkPlacementConcept
): FormWorkClassification {
	const placementLabel = getPlacementLabel(placementConcept);
	const entryPoint = getEntryPoint(contentConcept);
	const marginaliaCategory =
		entryPoint === 'marginalia' ? getMarginaliaCategory(placementConcept) : null;

	switch (contentConcept) {
		case 'runningTitle':
			return {
				contentConcept,
				placementConcept,
				label: 'Running Title',
				entryPoint,
				marginaliaCategory,
				placementLabel,
			};
		case 'header':
			return {
				contentConcept,
				placementConcept,
				label: 'Page Header',
				entryPoint,
				marginaliaCategory,
				placementLabel,
			};
		case 'footer':
			return {
				contentConcept,
				placementConcept,
				label: 'Page Footer',
				entryPoint,
				marginaliaCategory,
				placementLabel,
			};
		case 'pageLabel':
			return {
				contentConcept,
				placementConcept,
				label: 'Page Label',
				entryPoint,
				marginaliaCategory,
				placementLabel,
			};
		case 'lineLabel':
			return {
				contentConcept,
				placementConcept,
				label: 'Line Label',
				entryPoint,
				marginaliaCategory,
				placementLabel,
			};
		case 'quireSignature':
			return {
				contentConcept,
				placementConcept,
				label: 'Quire Signature',
				entryPoint,
				marginaliaCategory,
				placementLabel,
			};
		case 'catchword':
			return {
				contentConcept,
				placementConcept,
				label: 'Catchword',
				entryPoint,
				marginaliaCategory,
				placementLabel,
			};
		case 'marginalLabel':
			return {
				contentConcept,
				placementConcept,
				label:
					placementConcept === 'lineAbove' || placementConcept === 'lineBelow'
						? 'Interlinear Annotation'
						: 'Margin Annotation',
				entryPoint,
				marginaliaCategory,
				placementLabel,
			};
		case 'genericFormwork':
		default:
			return {
				contentConcept: 'genericFormwork',
				placementConcept,
				label: 'Layout Annotation',
				entryPoint,
				marginaliaCategory,
				placementLabel,
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

function getPlacementLabel(placementConcept: FormWorkPlacementConcept): string {
	switch (placementConcept) {
		case 'pageTop':
			return 'Page Top';
		case 'pageBottom':
			return 'Page Bottom';
		case 'columnTop':
			return 'Column Top';
		case 'columnBottom':
			return 'Column Bottom';
		case 'margin':
			return 'Margin';
		case 'lineAbove':
			return 'Above Line';
		case 'lineBelow':
			return 'Below Line';
		case 'lineLeft':
			return 'Line Left';
		case 'lineRight':
			return 'Line Right';
		case 'inline':
			return 'Inline';
		case 'inSpace':
			return 'Reserved Space';
		case 'oppositePage':
			return 'Opposite Page';
		case 'overleaf':
			return 'Overleaf';
		case 'pageEnd':
			return 'At End';
		case 'unknown':
		default:
			return 'Unspecified Placement';
	}
}

export function classifyFormWork(
	attrs: FormWorkAttrsLike | null | undefined
): FormWorkClassification {
	const type = getAttr(attrs, 'type');
	const segType = getAttr(attrs, 'segType');
	const segSubtype = getAttr(attrs, 'segSubtype');
	const placeTokens = parsePlaceTokens(getAttr(attrs, 'place'), getAttr(attrs, 'segPlace'));
	const placementConcept = classifyPlacement(segType, segSubtype, placeTokens);
	const contentConcept = classifyContent(type, placementConcept);

	return buildClassification(contentConcept, placementConcept);
}
