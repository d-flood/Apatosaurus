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
			xml: `<?xml version="1.0"?><TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body><pb n="1r"/><div type="book" n="B01"><div type="chapter" n="B01K1"><ab n="B01K1V1"><w>alpha</w></ab><ab n="B01K1V2"><w>beta</w></ab></div></div></body></text></TEI>`,
		});
		const units = listUnits(source);

		expect(units.length).toBe(2);
		expect(units[0]?.label).toEqual({ book: 'B01', chapter: 'B01K1', verse: 'B01K1V1' });
		expect(units[0]?.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: 'milestone', sourceLabel: 'B01' }),
				expect.objectContaining({ type: 'milestone', sourceLabel: 'B01K1' }),
				expect.objectContaining({ type: 'milestone', sourceLabel: 'B01K1V1' }),
			])
		);
	});
}, 30_000);
