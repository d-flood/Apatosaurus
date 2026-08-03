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
			xml: `<?xml version="1.0"?><TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body><pb n="1r"/><div type="book" n="b"><div type="chapter" n="c"><ab n="v1"><w>alpha</w></ab><ab n="v2"><w>beta</w></ab></div></div></body></text></TEI>`,
		});
		const units = listUnits(source);

		expect(units.length).toBe(2);
		expect(units[0]?.label).toEqual({ book: 'b', chapter: 'c', verse: 'v1' });
	});
}, 30_000);
