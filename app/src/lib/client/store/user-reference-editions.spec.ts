import { describe, expect, it, vi } from 'vitest';

import { MemoryStoreBackend } from './memory-store-backend.spec-support';
import {
	listUserReferenceEditions,
	loadUserReferenceEditionXml,
	registerUserReferenceEdition,
} from './user-reference-editions';

const XML = '<TEI><text><body><ab n="1"><w>alpha</w></ab></body></text></TEI>';

describe('user reference edition store', () => {
	it('persists one app-level edition across store clients and projects', async () => {
		const backend = new MemoryStoreBackend();
		const parse = vi.fn(async () => ({
			source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
			metadata: { title: 'My edition', attribution: 'Editor, CC BY 4.0' },
		}));

		const registered = await registerUserReferenceEdition(
			{ xml: XML, fileName: 'edition.xml' },
			{ backend, parse }
		);

		expect(registered.source).toBe('user');
		expect([...backend.files.keys()]).toEqual([
			expect.stringMatching(/^apatosaurus\/v1\/app\/reference-editions\/.+\.json$/),
		]);
		await expect(listUserReferenceEditions({ backend })).resolves.toEqual([registered]);
		await expect(listUserReferenceEditions({ backend })).resolves.toEqual([registered]);
		await expect(loadUserReferenceEditionXml(registered, { backend })).resolves.toBe(XML);
	});

	it('does not persist parse failures or editions without attribution', async () => {
		const backend = new MemoryStoreBackend();
		const parseFailure = vi.fn(async () => {
			throw new Error('XML parser: unclosed tag');
		});

		await expect(
			registerUserReferenceEdition(
				{ xml: 'not xml', fileName: 'bad.txt' },
				{ backend, parse: parseFailure }
			)
		).rejects.toThrow('XML parser: unclosed tag');
		expect(backend.files.size).toBe(0);

		await expect(
			registerUserReferenceEdition(
				{ xml: XML, fileName: 'edition.xml' },
				{
					backend,
					parse: async () => ({ source: { units: [] }, metadata: { title: 'Edition' } }),
				}
			)
		).rejects.toThrow('Attribution is required');
		expect(backend.files.size).toBe(0);
	});

	it('accepts repeated references and detects the same edition by content', async () => {
		const backend = new MemoryStoreBackend();
		const parse = vi.fn(async () => ({
			source: {
				units: [
					{ position: 0, label: { verse: '1' }, content: [] },
					{ position: 1, label: { verse: '1' }, content: [] },
				],
			},
			metadata: { title: 'Repeated edition', attribution: 'Local edition' },
		}));

		await registerUserReferenceEdition({ xml: XML, fileName: 'one.xml' }, { backend, parse });
		await expect(
			registerUserReferenceEdition({ xml: XML, fileName: 'renamed.xml' }, { backend, parse })
		).rejects.toThrow('already on this device');
		expect((await listUserReferenceEditions({ backend })).length).toBe(1);
	});
});
