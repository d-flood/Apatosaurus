import { describe, expect, it } from 'vitest';

import { parseReferenceEditionInWorker } from '$lib/client/reference-editions/reference-edition-worker';
import { listReferenceEditions } from './catalog';
import { listUnits } from './source';

describe('bundled reference edition worker', () => {
	it('parses the bundled asset through the shared TEI importer path', async () => {
		const entry = listReferenceEditions().find(item => item.id === 'robinson-pierpont');
		if (!entry) throw new Error('Robinson-Pierpont catalog entry is missing.');
		expect(entry.assetPath).toBe('/robinson-pierpont/byz.xml');

		const source = await parseReferenceEditionInWorker({
			xml: `<?xml version="1.0"?><TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body><pb n="1r"/><div type="book" n="book.opaque"><div type="chapter" n="book.opaque.chapter.9"><ab n="chapter.9.verse.10"><w>alpha</w></ab><ab n="chapter.9.verse.11"><w>beta</w></ab></div></div></body></text></TEI>`,
		});
		const units = listUnits(source);

		expect(units.length).toBe(2);
		expect(units[0]?.label).toEqual({
			book: 'book.opaque',
			chapter: 'book.opaque.chapter.9',
			verse: 'chapter.9.verse.10',
		});
		expect(units[0]?.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: 'milestone', sourceLabel: 'book.opaque' }),
				expect.objectContaining({
					type: 'milestone',
					attrs: { book: 'book.opaque', chapter: 'book.opaque.chapter.9' },
					sourceLabel: 'book.opaque.chapter.9',
				}),
				expect.objectContaining({
					type: 'milestone',
					attrs: {
						book: 'book.opaque',
						chapter: 'book.opaque.chapter.9',
						verse: 'chapter.9.verse.10',
					},
					sourceLabel: 'chapter.9.verse.10',
				}),
			])
		);
	});
}, 30_000);
