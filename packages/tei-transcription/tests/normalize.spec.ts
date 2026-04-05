import { describe, expect, it } from 'vitest';

import { normalizeDocument, type TranscriptionDocument } from '../src/index';

describe('normalizeDocument structural guards', () => {
	it('keeps at least one line in every column after empty lines are filtered', () => {
		const normalized = normalizeDocument({
			type: 'transcriptionDocument',
			pages: [
				{
					type: 'page',
					id: '1r',
					columns: [
						{
							type: 'column',
							number: 1,
							lines: [
								{ type: 'line', number: 1, items: [] },
								{ type: 'line', number: 2, items: [] },
							],
						},
					],
				},
			],
		} satisfies TranscriptionDocument);

		expect(normalized.pages[0].columns[0].lines).toHaveLength(1);
		expect(normalized.pages[0].columns[0].lines[0]).toMatchObject({
			type: 'line',
			number: 1,
			items: [],
		});
	});

	it('keeps at least one column in every page', () => {
		const normalized = normalizeDocument({
			type: 'transcriptionDocument',
			pages: [
				{
					type: 'page',
					id: '1v',
					columns: [],
				},
			],
		} satisfies TranscriptionDocument);

		expect(normalized.pages[0].columns).toHaveLength(1);
		expect(normalized.pages[0].columns[0]).toMatchObject({
			type: 'column',
			number: 1,
			lines: [{ type: 'line', number: 1, items: [] }],
		});
	});
});
