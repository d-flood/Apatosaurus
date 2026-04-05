export function parseJsonObject(
	value: string,
	label: string
): Record<string, any> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : `Invalid ${label} JSON`);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`${label} must be a JSON object.`);
	}
	return parsed as Record<string, any>;
}

export function prettyJson(value: Record<string, any> | null | undefined): string {
	return JSON.stringify(value || {}, null, 2);
}

export function omitKeys(
	source: Record<string, any> | null | undefined,
	keys: string[]
): Record<string, any> {
	const output: Record<string, any> = {};
	for (const [key, value] of Object.entries(source || {})) {
		if (!keys.includes(key)) {
			output[key] = value;
		}
	}
	return output;
}

export function syncTeiNode(
	teiNode: Record<string, any> | null | undefined,
	teiAttrs: Record<string, any>,
	text?: string
): Record<string, any> | null {
	if (!teiNode || typeof teiNode !== 'object') return null;

	const nextNode: Record<string, any> = {
		...teiNode,
		attrs: Object.keys(teiAttrs).length > 0 ? teiAttrs : undefined,
	};

	if (typeof text === 'string') {
		nextNode.children = text.length > 0 ? [{ type: 'text', text }] : [];
	}

	return nextNode;
}

export function extractTextChildren(teiNode: Record<string, any> | null | undefined): string | null {
	if (!teiNode || typeof teiNode !== 'object') return null;
	return extractTextChildrenFromNodes(Array.isArray(teiNode.children) ? teiNode.children : []);
}

export function extractTextChildrenFromNodes(
	children: Array<Record<string, any>> | null | undefined
): string | null {
	const normalizedChildren = Array.isArray(children) ? children : [];
	if (normalizedChildren.some(child => child?.type !== 'text')) {
		return null;
	}
	return normalizedChildren.map(child => child?.text || '').join('');
}

export function summarizeTeiChildren(
	children: Array<Record<string, any>> | null | undefined
): string {
	return collapseText(children).replace(/\s+/g, ' ').trim();
}

export interface TeiTextLeaf {
	key: string;
	path: number[];
	text: string;
}

export function collectTextLeaves(
	children: Array<Record<string, any>> | null | undefined
): TeiTextLeaf[] {
	const leaves: TeiTextLeaf[] = [];

	function visit(nodes: Array<Record<string, any>>, path: number[]) {
		nodes.forEach((node, index) => {
			const nextPath = [...path, index];
			if (node?.type === 'text') {
				leaves.push({
					key: nextPath.join('.'),
					path: nextPath,
					text: String(node.text || ''),
				});
				return;
			}

			const nestedChildren = Array.isArray(node?.children) ? node.children : [];
			if (nestedChildren.length > 0) {
				visit(nestedChildren, nextPath);
			}
		});
	}

	visit(Array.isArray(children) ? children : [], []);
	return leaves;
}

export function applyTextLeafUpdates(
	children: Array<Record<string, any>> | null | undefined,
	updates: Record<string, string>
): Array<Record<string, any>> {
	function visit(nodes: Array<Record<string, any>>, path: number[]): Array<Record<string, any>> {
		return nodes.map((node, index) => {
			const nextPath = [...path, index];
			const key = nextPath.join('.');
			if (node?.type === 'text') {
				return {
					...node,
					text: Object.prototype.hasOwnProperty.call(updates, key) ? updates[key] : node.text,
				};
			}

			const nestedChildren = Array.isArray(node?.children) ? node.children : [];
			if (nestedChildren.length === 0) {
				return node;
			}

			return {
				...node,
				children: visit(nestedChildren, nextPath),
			};
		});
	}

	return visit(Array.isArray(children) ? children : [], []);
}

// ---------------------------------------------------------------------------
// Manuscript-concept label utilities
// ---------------------------------------------------------------------------

const TAG_TO_CONCEPT: Record<string, string> = {
	note: 'Note',
	foreign: 'Foreign Language',
	seg: 'Text Segment',
	hi: 'Highlighted Text',
	quote: 'Quotation',
	ref: 'Reference',
	abbr: 'Abbreviation',
	num: 'Number',
	title: 'Title',
	name: 'Name',
	sic: 'Apparent Error',
	orig: 'Original Form',
};

const NOTE_TYPE_LABELS: Record<string, string> = {
	editorial: 'Editorial Note',
	local: 'Local Note',
	working: 'Working Note',
	commentary: 'Commentary Note',
};

const EDITORIAL_ACTION_LABELS: Record<string, string> = {
	add: 'Addition',
	del: 'Deletion',
	subst: 'Substitution',
	transpose: 'Transposition',
	listTranspose: 'List Transposition',
};

const ATTR_KEY_LABELS: Record<string, string> = {
	reason: 'Reason',
	unit: 'Unit',
	extent: 'Extent',
	dim: 'Dimension',
	'xml:lang': 'Language',
	cert: 'Certainty',
	place: 'Position',
	rend: 'Appearance',
	resp: 'Responsibility',
	hand: 'Hand',
	medium: 'Medium',
	'function': 'Function',
	target: 'Target',
	n: 'Value',
	ed: 'Edition',
	type: 'Content Type',
	subtype: 'Subtype',
};

export function tagToConceptLabel(tag: string): string {
	return TAG_TO_CONCEPT[tag] || tag;
}

export function noteTypeLabel(attrs: Record<string, any> | null | undefined): string {
	const noteType = String(attrs?.teiAttrs?.type || attrs?.type || '').toLowerCase();
	return NOTE_TYPE_LABELS[noteType] || 'Note';
}

export function editorialActionLabel(kind: string | undefined): string {
	return EDITORIAL_ACTION_LABELS[kind || ''] || 'Editorial Action';
}

export function humanizeAttrKey(key: string): string {
	return ATTR_KEY_LABELS[key] || key;
}

function collapseText(children: Array<Record<string, any>> | null | undefined): string {
	const normalizedChildren = Array.isArray(children) ? children : [];
	return normalizedChildren
		.map(child => {
			if (!child || typeof child !== 'object') return '';
			if (child.type === 'text') {
				return String(child.text || '');
			}
			return collapseText(Array.isArray(child.children) ? child.children : []);
		})
		.join('');
}
