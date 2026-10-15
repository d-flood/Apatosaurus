import { describe, expect, it } from 'vitest';
import { alignmentCellFromTokens } from './alignment-cell';
import { placeWitnessRow } from './alignment-placement';
import { deserializeAlignmentColumns, serializeAlignmentColumns } from './alignment-snapshot';
import { mergeColumnsIn } from './alignment-edits';
import { collateToAlignmentSnapshot } from './collation-adapter';
import type { CollationTokenInput, CollationWitnessInput } from './collation-worker-types';

function witness(id: string, text: string): CollationWitnessInput {
	return {
		id,
		content: text,
		tokens: text
			.split(/\s+/)
			.filter(Boolean)
			.map((t, index) => ({
				t,
				n: t,
				sourceTokenIds: [`${id}-${index}`],
			})),
	};
}

function alignment(
	witnesses = [witness('A', 'alpha beta gamma'), witness('B', 'alpha delta gamma')],
	segmentation = false
) {
	const { snapshot } = collateToAlignmentSnapshot({ witnesses, options: { segmentation } });
	return deserializeAlignmentColumns(snapshot.columns);
}

function options(witnessOrder = ['A', 'B', 'C']) {
	let nextId = 0;
	return { witnessOrder, makeId: () => `inserted-${nextId++}` };
}

describe('placeWitnessRow', () => {
	it('preserves other rows, column identities, editorial metadata and input objects', () => {
		const columns = alignment();
		columns[0].mergedWith = ['earlier-column'];
		columns[0].splitInto = [structuredClone(columns[1])];
		const before = structuredClone(serializeAlignmentColumns(columns));
		const incoming = witness('C', 'alpha new beta gamma');
		const incomingBefore = structuredClone(incoming);
		const result = placeWitnessRow(columns, incoming, options());

		expect(serializeAlignmentColumns(columns)).toEqual(before);
		expect(incoming).toEqual(incomingBefore);
		expect(
			result.columns
				.filter(column => !result.insertedColumnIds.includes(column.id))
				.map(column => column.id)
		).toEqual(columns.map(column => column.id));
		for (const column of columns) {
			const placed = result.columns.find(candidate => candidate.id === column.id)!;
			expect(placed.mergedWith).toEqual(column.mergedWith);
			expect(placed.splitInto).toEqual(column.splitInto);
			for (const [id, cell] of column.cells) expect(placed.cells.get(id)).toBe(cell);
		}
		expect(result.columns.flatMap(column => column.cells.get('C')!.sourceTokenIds)).toEqual(
			incoming.tokens!.flatMap(token => token.sourceTokenIds!)
		);
		expect(result.columns.map(column => column.index)).toEqual([0, 1, 2, 3]);
	});

	it('substitutes between anchors and matches any attesting row by alignment value', () => {
		const columns = alignment();
		const incoming = witness('C', 'alpha epsilon gamma');
		const substituted = placeWitnessRow(columns, incoming, options());
		expect(substituted.insertedColumnIds).toEqual([]);
		expect(substituted.columns.map(column => column.cells.get('C')!.text)).toEqual([
			'alpha',
			'epsilon',
			'gamma',
		]);
		incoming.tokens![1] = {
			t: 'DELTA',
			n: 'delta',
			displayRegularized: 'delta',
			sourceTokenIds: ['C-1'],
		};
		const matched = placeWitnessRow(columns, incoming, options());
		expect(matched.insertedColumnIds).toEqual([]);
		expect(matched.columns[1].cells.get('C')).toMatchObject({
			text: 'DELTA',
			alignmentValue: 'delta',
			isRegularized: true,
		});
	});

	it('opens one insertion with absence kinds from the original neighbors', () => {
		const columns = alignment([
			witness('A', 'alpha beta'),
			witness('B', 'alpha beta'),
			witness('G', 'alpha beta'),
			witness('U', 'alpha beta'),
			witness('M', 'alpha beta'),
		]);
		for (const column of columns) {
			column.cells.set(
				'G',
				alignmentCellFromTokens([
					{ t: '⊘', n: '__gap__', kind: 'gap', displayRegularized: null },
				])
			);
			column.cells.set(
				'U',
				alignmentCellFromTokens([
					{
						t: '…',
						n: '__untranscribed__',
						kind: 'untranscribed',
						displayRegularized: null,
					},
				])
			);
			column.cells.set(
				'M',
				alignmentCellFromTokens([
					{
						t: '…',
						n: '__absent__',
						kind: column.index === 0 ? 'gap' : 'untranscribed',
						displayRegularized: null,
					},
				])
			);
		}
		const result = placeWitnessRow(
			columns,
			witness('C', 'alpha extra beta'),
			options(['A', 'B', 'G', 'U', 'M', 'C'])
		);
		expect(result.insertedColumnIds).toEqual(['inserted-0']);
		expect(result.columns.map(column => column.cells.get('C')!.text)).toEqual([
			'alpha',
			'extra',
			'beta',
		]);
		expect([...result.columns[1].cells].map(([id, cell]) => [id, cell.kind])).toEqual([
			['A', 'omission'],
			['B', 'omission'],
			['G', 'gap'],
			['U', 'untranscribed'],
			['M', 'gap'],
			['C', 'text'],
		]);
		expect(result.columns[1].cells.get('U')).toMatchObject({
			isOmission: false,
			isLacuna: true,
			text: null,
		});
	});

	it('leaves omissions for missing words and replaces a preexisting witness row', () => {
		const columns = alignment();
		const result = placeWitnessRow(columns, witness('A', 'alpha gamma'), options(['A', 'B']));
		expect(result.insertedColumnIds).toEqual([]);
		expect(result.columns[1].cells.get('A')).toEqual(alignmentCellFromTokens([]));
		expect(result.columns.map(column => column.cells.get('B'))).toEqual(
			columns.map(column => column.cells.get('B'))
		);
	});

	it('places a contiguous run in a hand-merged column', () => {
		const original = alignment();
		const columns = mergeColumnsIn(
			original,
			original.slice(0, 2).map(column => column.id),
			{
				rules: [],
				witnessOrder: ['A', 'B'],
				witnessIds: ['A', 'B'],
				baseWitnessId: 'A',
			}
		);
		const incoming = witness('C', 'alpha beta gamma');
		const result = placeWitnessRow(columns, incoming, options());
		expect(result.insertedColumnIds).toEqual([]);
		expect(result.columns[0].cells.get('C')).toEqual(
			alignmentCellFromTokens(incoming.tokens!.slice(0, 2))
		);
		expect(result.columns.map(column => column.id)).toEqual(columns.map(column => column.id));
	});

	it.each([false, true])(
		'puts an identical witness in its existing columns (segmentation %s)',
		segmentation => {
			const existing = witness('A', 'alpha beta gamma delta');
			const columns = alignment([existing, witness('B', 'alpha gamma delta')], segmentation);
			const incoming = witness('C', existing.content);
			const result = placeWitnessRow(columns, incoming, options());
			expect(result.insertedColumnIds).toEqual([]);
			expect(
				result.columns.map(column => {
					const { sourceTokenIds, ...cell } = column.cells.get('C')!;
					return {
						...cell,
						sourceTokenIds: sourceTokenIds.map(id => id.replace('C-', 'A-')),
					};
				})
			).toEqual(columns.map(column => column.cells.get('A')));
		}
	);

	it('builds its own gap, untranscribed and punctuation cells exactly like CollateX', () => {
		const tokens: CollationTokenInput[] = [
			{ t: 'alpha', n: 'alpha', ruleIds: ['r'], regularizationTypes: ['ns'] },
			{
				t: ',',
				n: ',',
				isPunctuation: true,
				originalSegments: [
					{ text: ',', hasUnclear: false, isPunctuation: true, isSupplied: false },
				],
			},
			{
				t: '⊘',
				n: '__gap:reason=lacuna__',
				kind: 'gap',
				displayRegularized: null,
				gap: { source: 'gap', reason: 'lacuna', unit: 'chars', extent: '3' },
			},
			{
				t: '…',
				n: '__untranscribed__',
				kind: 'untranscribed',
				displayRegularized: null,
				gap: { source: 'untranscribed', reason: '', unit: '', extent: '' },
			},
		];
		const existing = { id: 'A', content: '', tokens };
		const { snapshot } = collateToAlignmentSnapshot({
			witnesses: [existing, { ...existing, id: 'B' }],
			options: { segmentation: false },
		});
		const columns = deserializeAlignmentColumns(snapshot.columns);
		const incoming = { ...existing, id: 'C' };
		const result = placeWitnessRow(columns, incoming, options());
		expect(result.insertedColumnIds).toEqual([]);
		expect(result.columns.map(column => column.cells.get('C'))).toEqual(
			snapshot.columns.map(column => column.cells.find(([id]) => id === 'A')![1])
		);
	});

	it('handles empty sequences, boundary insertions and deterministic repeated tokens', () => {
		const columns = alignment([witness('A', 'alpha alpha'), witness('B', 'alpha alpha')]);
		const incoming = witness('C', 'start alpha alpha end');
		const placed = placeWitnessRow(columns, incoming, options());
		expect(placed).toEqual(placeWitnessRow(columns, incoming, options()));
		expect(placed.insertedColumnIds).toHaveLength(2);
		expect(placed.columns.map(column => column.cells.get('C')!.text)).toEqual([
			'start',
			'alpha',
			'alpha',
			'end',
		]);
		expect(
			placeWitnessRow(columns, witness('C', ''), options()).columns.every(
				column => column.cells.get('C')!.isOmission
			)
		).toBe(true);
		expect(
			placeWitnessRow([], witness('C', 'alpha beta'), options()).columns.map(
				column => column.cells.get('C')!.text
			)
		).toEqual(['alpha', 'beta']);
		expect(placeWitnessRow([], witness('C', ''), options())).toEqual({
			columns: [],
			insertedColumnIds: [],
		});
		expect(
			placeWitnessRow(columns, { id: 'C', content: 'alpha alpha' }, options())
				.insertedColumnIds
		).toEqual([]);
	});
});
