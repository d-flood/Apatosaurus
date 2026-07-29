import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { fromProseMirror, parseTei, serializeTei, toProseMirror } from '../src/index';

interface CorpusEntry {
	id: string;
	path: string;
	exportBytes: number;
	exportSha256: string;
}

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		(globalThis as any).DOMParser = DOMParser;
	}
	if (typeof globalThis.Node === 'undefined') {
		class TestNode {}
		Object.assign(TestNode, {
			ELEMENT_NODE: 1,
			TEXT_NODE: 3,
			CDATA_SECTION_NODE: 4,
			PROCESSING_INSTRUCTION_NODE: 7,
			COMMENT_NODE: 8,
			DOCUMENT_NODE: 9,
			DOCUMENT_TYPE_NODE: 10,
			DOCUMENT_FRAGMENT_NODE: 11,
		});
		(globalThis as any).Node = TestNode;
	}
});

beforeEach(() => {
	let nextId = 0;
	vi.stubGlobal('crypto', {
		randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
	});
});

describe('formwork content corpus', () => {
	const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
	const corpus = JSON.parse(
		readFileSync(
			join(repoRoot, 'packages', 'tei-transcription', 'formwork-content-corpus.json'),
			'utf8'
		)
	) as { entries: CorpusEntry[] };

	it.each(corpus.entries)('keeps $id export byte-identical', entry => {
		const source = readFileSync(join(repoRoot, entry.path), 'utf8');
		const exported = serializeTei(fromProseMirror(toProseMirror(parseTei(source))), {
			date: '2026-07-29',
		});

		expect(Buffer.byteLength(exported)).toBe(entry.exportBytes);
		expect(createHash('sha256').update(exported).digest('hex')).toBe(entry.exportSha256);
	});
});
