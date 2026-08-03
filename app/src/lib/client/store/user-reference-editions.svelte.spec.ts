import { describe, expect, it } from 'vitest';

import { MemoryStoreBackend } from './memory-store-backend.spec-support';
import { listUserReferenceEditions, registerUserReferenceEdition } from './user-reference-editions';

describe('user reference edition registration', () => {
	it('surfaces XML and missing-milestone failures without storing a catalog entry', async () => {
		const backend = new MemoryStoreBackend();

		await expect(
			registerUserReferenceEdition(
				{ xml: '<TEI><text>', fileName: 'broken.xml', attribution: 'Test' },
				{ backend }
			)
		).rejects.toThrow(/xml|element|tag|parse/i);
		await expect(
			registerUserReferenceEdition(
				{
					xml: '<TEI><teiHeader/><text><body><w>alpha</w></body></text></TEI>',
					fileName: 'no-divisions.xml',
					attribution: 'Test',
				},
				{ backend }
			)
		).rejects.toThrow(/milestone|addressable division/i);
		await expect(listUserReferenceEditions({ backend })).resolves.toEqual([]);
	});

	it('accepts repeated references and captures title and availability', async () => {
		const backend = new MemoryStoreBackend();
		const xml = `
			<TEI xmlns="http://www.tei-c.org/ns/1.0">
				<teiHeader><fileDesc><titleStmt><title type="document">Local Edition</title></titleStmt>
				<publicationStmt><availability><p>Licensed to the scholar</p></availability></publicationStmt>
				<sourceDesc><p>Digital edition</p></sourceDesc></fileDesc></teiHeader>
				<text><body><ab n="same"><w>alpha</w></ab><ab n="same"><w>beta</w></ab></body></text>
			</TEI>`;

		const entry = await registerUserReferenceEdition(
			{ xml, fileName: 'local.xml' },
			{ backend }
		);

		expect(entry).toMatchObject({
			title: 'Local Edition',
			attribution: 'Licensed to the scholar',
			source: 'user',
		});
	});
}, 30_000);
