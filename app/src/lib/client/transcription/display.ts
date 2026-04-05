import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';

function normalizeTeiWitnessIdentifier(value: string): string {
	return value.trim().replace(/^#/, '');
}

function readTeiNodeText(
	node: { text?: string; children?: Array<{ type: string; text?: string; children?: unknown[] }> } | undefined,
): string {
	if (!node) return '';
	if (node.text) return node.text;
	if (!Array.isArray(node.children)) return '';
	return node.children
		.map((child) =>
			child.type === 'text'
				? (child.text ?? '')
				: readTeiNodeText(
					child as {
						text?: string;
						children?: Array<{ type: string; text?: string; children?: unknown[] }>;
					},
				),
		)
		.join('');
}

function findImmediateTeiChildren(
	node: StoredTranscriptionDocument['teiHeader'],
	tag: string,
): NonNullable<StoredTranscriptionDocument['teiHeader']>[] {
	if (!node?.children) return [];
	return node.children.filter(
		(child): child is NonNullable<StoredTranscriptionDocument['teiHeader']> =>
			child.type === 'element' && child.tag.toLowerCase() === tag.toLowerCase(),
	);
}

function findTeiDescendantByPath(
	root: StoredTranscriptionDocument['teiHeader'],
	path: string[],
): NonNullable<StoredTranscriptionDocument['teiHeader']> | undefined {
	let current = root;
	for (const segment of path) {
		current = findImmediateTeiChildren(current, segment)[0];
		if (!current) return undefined;
	}
	return current;
}

function findListeAltIdentifierSiglum(document: StoredTranscriptionDocument): string | undefined {
	const msIdentifier = findTeiDescendantByPath(document.teiHeader, [
		'fileDesc',
		'sourceDesc',
		'msDesc',
		'msIdentifier',
	]);
	if (!msIdentifier) return undefined;
	const listeAltIdentifier = findImmediateTeiChildren(msIdentifier, 'altIdentifier').find(
		(child) => child.attrs?.type?.toLowerCase() === 'liste',
	);
	if (!listeAltIdentifier) return undefined;
	const idno = findImmediateTeiChildren(listeAltIdentifier, 'idno')[0];
	const text = normalizeTeiWitnessIdentifier(readTeiNodeText(idno));
	return text || undefined;
}

export function findPreferredTeiWitnessSiglum(
	document: StoredTranscriptionDocument,
): string | undefined {
	return (
		document.header?.titles?.find((title) => title.type === 'document')?.key?.trim() ||
		findListeAltIdentifierSiglum(document) ||
		undefined
	);
}

export function getPreferredTranscriptionLabel(input: {
	document?: StoredTranscriptionDocument | null;
	siglum?: string | null;
	fallbackId?: string | null;
}): string {
	return (
		(input.document ? findPreferredTeiWitnessSiglum(input.document) : undefined) ||
		input.siglum?.trim() ||
		input.document?.metadata?.idno?.trim() ||
		input.document?.header?.msIdentifier?.idno?.trim() ||
		input.fallbackId?.slice(0, 8) ||
		'Untitled'
	);
}
