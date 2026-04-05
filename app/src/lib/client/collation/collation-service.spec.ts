import { describe, expect, it } from 'vitest';

import { makeCloneableCollationRunPayload } from './collation-service';

describe('makeCloneableCollationRunPayload', () => {
	it('copies nested arrays and objects into structured-clone-safe payload data', () => {
		const sourceTokenIds = ['w1::1'];
		const ruleIds = ['rule-1'];
		const regularizationTypes = ['ns'] as const;
		const gap = {
			source: 'gap' as const,
			reason: 'lacuna',
			unit: 'chars',
			extent: '3',
			debugOnly: () => 'not cloneable',
		};

		const payload = makeCloneableCollationRunPayload({
			witnesses: [
				{
					id: 'A',
					content: 'alpha',
					tokens: [
						{
							t: 'alpha',
							n: 'alpha',
							sourceTokenIds,
							kind: 'gap',
							displayRegularized: 'alpha',
							originalSegments: [
								{ text: 'al', hasUnclear: false, isPunctuation: false, isSupplied: false },
								{ text: 'pha', hasUnclear: true, isPunctuation: false, isSupplied: false },
							],
							gap: gap as never,
							hasUnclear: true,
							isPunctuation: false,
							isSupplied: false,
							ruleIds,
							regularizationTypes: [...regularizationTypes],
						},
					],
				},
				{
					id: 'B',
					content: 'beta',
				},
			],
			options: { segmentation: true },
		});

		expect(payload).toEqual({
			witnesses: [
				{
					id: 'A',
					content: 'alpha',
					tokens: [
						{
							t: 'alpha',
							n: 'alpha',
							sourceTokenIds: ['w1::1'],
							kind: 'gap',
							displayRegularized: 'alpha',
							originalSegments: [
								{ text: 'al', hasUnclear: false, isPunctuation: false, isSupplied: false },
								{ text: 'pha', hasUnclear: true, isPunctuation: false, isSupplied: false },
							],
							gap: {
								source: 'gap',
								reason: 'lacuna',
								unit: 'chars',
								extent: '3',
							},
							hasUnclear: true,
							isPunctuation: false,
							isSupplied: false,
							ruleIds: ['rule-1'],
							regularizationTypes: ['ns'],
						},
					],
				},
				{
					id: 'B',
					content: 'beta',
					tokens: undefined,
				},
			],
			options: { segmentation: true },
		});
		expect(payload.witnesses[0].tokens?.[0].sourceTokenIds).not.toBe(sourceTokenIds);
		expect(payload.witnesses[0].tokens?.[0].ruleIds).not.toBe(ruleIds);
		expect(payload.witnesses[0].tokens?.[0].gap).not.toBe(gap);
	});
});
