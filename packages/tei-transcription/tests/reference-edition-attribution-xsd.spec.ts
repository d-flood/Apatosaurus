import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';

import { fromProseMirror, serializeTei, type ProseMirrorJSON } from '../src/index';
import { validateIgntpXsd } from '../../../test-support/validate-igntp-xsd';

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		(globalThis as any).DOMParser = DOMParser;
	}
});

describe('reference edition attribution XSD validation', () => {
	it.each([
		{ label: 'zero', sourceAttributions: [] },
		{ label: 'one', sourceAttributions: ['Edition One attribution'] },
		{
			label: 'several',
			sourceAttributions: ['Edition One attribution', 'Edition Two attribution'],
		},
	])(
		'validates generated headers with $label reference edition attributions',
		({ sourceAttributions }) => {
			const xml = serializeTei(fromProseMirror(minimalDocument()), { sourceAttributions });

			expect((xml.match(/<bibl type="referenceEdition">/g) || []).length).toBe(
				sourceAttributions.length
			);
			expect(() => validateIgntpXsd(xml)).not.toThrow();
		}
	);
});

function minimalDocument(): ProseMirrorJSON {
	return {
		type: 'manuscript',
		content: [
			{
				type: 'page',
				attrs: { pageName: '1r' },
				content: [
					{
						type: 'column',
						attrs: { columnNumber: 1 },
						content: [
							{
								type: 'line',
								attrs: { lineNumber: 1 },
								content: [{ type: 'text', text: 'alpha' }],
							},
						],
					},
				],
			},
		],
	};
}
