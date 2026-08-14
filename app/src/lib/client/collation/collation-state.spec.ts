import { beforeEach, describe, expect, it } from 'vitest';
import { deserializeAlignmentColumns, type AlignmentCell } from './alignment-snapshot';
import { collateToAlignmentSnapshot } from './collation-adapter';
import { collationState, type WitnessConfig } from './collation-state.svelte';
import type { RegularizationRule, WitnessSourceToken } from './collation-types';

function makeTokens(content: string): WitnessSourceToken[] {
	return content
		.split(/\s+/)
		.filter(Boolean)
		.map(token => ({
			kind: 'text',
			original: token,
			segments: [
				{
					text: token,
					hasUnclear: false,
					isPunctuation: false,
					isSupplied: false,
				},
			],
			gap: null,
		}));
}

function makeWitness(
	witnessId: string,
	content: string,
	options?: Partial<
		Pick<
			WitnessConfig,
			| 'isBaseText'
			| 'isExcluded'
			| 'kind'
			| 'handId'
			| 'treatment'
			| 'fullContent'
			| 'fullTokens'
			| 'fragmentaryContent'
			| 'fragmentaryTokens'
		>
	>
): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		kind: options?.kind,
		handId: options?.handId,
		sourceVersion: 'v1',
		content,
		tokens: makeTokens(content),
		fullContent: options?.fullContent,
		fullTokens: options?.fullTokens,
		fragmentaryContent: options?.fragmentaryContent,
		fragmentaryTokens: options?.fragmentaryTokens,
		treatment: options?.treatment ?? 'inherit',
		isBaseText: options?.isBaseText ?? false,
		isExcluded: options?.isExcluded ?? false,
		overridesDefault: false,
	};
}

function makeRule(overrides?: Partial<RegularizationRule>): RegularizationRule {
	return {
		id: 'rule-1',
		pattern: 'θς',
		replacement: 'θεος',
		scope: 'verse',
		description: 'theta-sigma to theos',
		enabled: true,
		type: 'ns',
		...overrides,
	};
}

function makeSourceToken(text: string, options?: { isPunctuation?: boolean }): WitnessSourceToken {
	return {
		kind: 'text',
		original: text,
		segments: [
			{
				text,
				hasUnclear: false,
				isPunctuation: options?.isPunctuation ?? false,
				isSupplied: false,
			},
		],
		gap: null,
	};
}

function makeTextCell(text: string) {
	return {
		text,
		regularizedText: text,
		alignmentValue: text,
		sourceTokenIds: [],
		kind: 'text' as const,
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
	};
}

function makeOmissionCell() {
	return {
		text: null,
		regularizedText: null,
		alignmentValue: null,
		sourceTokenIds: [],
		kind: 'omission' as const,
		gap: null,
		isOmission: true,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
	};
}

describe('collationState stemma derivation', () => {
	beforeEach(() => {
		collationState.reset();
	});

	it('splits a non-merged alignment unit that contains grouped words', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και εγενετο', { isBaseText: true }),
			makeWitness('B', 'και εγενετο'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και εγενετο')],
						['B', makeTextCell('και εγενετο')],
					],
				},
			],
		});

		expect(collationState.canSplitColumn('col-1')).toBe(true);

		collationState.splitColumn('col-1');

		expect(collationState.alignmentColumns).toHaveLength(2);
		expect(collationState.alignmentColumns[0]?.cells.get('A')?.text).toBe('και');
		expect(collationState.alignmentColumns[0]?.cells.get('B')?.text).toBe('και');
		expect(collationState.alignmentColumns[1]?.cells.get('A')?.text).toBe('εγενετο');
		expect(collationState.alignmentColumns[1]?.cells.get('B')?.text).toBe('εγενετο');
	});

	it('merges selected cells for a single witness without merging the full column', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και λογος', { isBaseText: true }),
			makeWitness('B', 'και λογος'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και')],
						['B', makeTextCell('και')],
					],
				},
				{
					id: 'col-2',
					index: 1,
					merged: false,
					cells: [
						['A', makeTextCell('λογος')],
						['B', makeTextCell('λογος')],
					],
				},
			],
		});

		collationState.toggleCellSelection('col-1', 'A');
		collationState.toggleCellSelection('col-2', 'A');

		expect(collationState.canMergeSelectedCells()).toBe(true);

		collationState.mergeSelectedCells();

		expect(collationState.alignmentColumns[0]?.cells.get('A')?.text).toBe('και λογος');
		expect(collationState.alignmentColumns[1]?.cells.get('A')?.text).toBeNull();
		expect(collationState.alignmentColumns[0]?.cells.get('B')?.text).toBe('και');
		expect(collationState.alignmentColumns[1]?.cells.get('B')?.text).toBe('λογος');
	});

	it('shifts a token into a missing intermediate displayed position and prunes the emptied source column', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και λογος', { isBaseText: true }),
			makeWitness('B', 'και λογος'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και')],
						['B', makeTextCell('και')],
					],
				},
				{
					id: 'col-2',
					index: 1,
					merged: false,
					cells: [
						['A', makeTextCell('λογος')],
						['B', makeOmissionCell()],
					],
				},
			],
		});

		const initialColumnIds = collationState.alignmentColumns.map(column => column.id);

		expect(collationState.canShiftToken('col-2', 'A', 'right')).toBe(true);

		collationState.shiftToken('col-2', 'A', 'right');

		expect(collationState.alignmentColumns).toHaveLength(2);
		expect(collationState.alignmentColumns[0]?.cells.get('A')?.text).toBe('και');
		expect(collationState.alignmentColumns[1]?.cells.get('A')?.text).toBe('λογος');
		expect(collationState.alignmentColumns[1]?.cells.get('A')?.isOmission).toBe(false);
		expect(collationState.alignmentColumns[1]?.cells.get('B')?.isOmission).toBe(true);
		expect(collationState.alignmentColumns[1]?.id).not.toBe(initialColumnIds[1]);
	});

	it('shifts a token into an existing adjacent displayed omission slot', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και λογος', { isBaseText: true }),
			makeWitness('B', 'και λογος'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και')],
						['B', makeTextCell('και')],
					],
				},
				{
					id: 'col-gap',
					index: 1,
					merged: false,
					cells: [
						['A', makeOmissionCell()],
						['B', makeOmissionCell()],
					],
				},
				{
					id: 'col-2',
					index: 2,
					merged: false,
					cells: [
						['A', makeTextCell('λογος')],
						['B', makeOmissionCell()],
					],
				},
			],
		});

		expect(collationState.canShiftToken('col-2', 'A', 'left')).toBe(true);

		collationState.shiftToken('col-2', 'A', 'left');

		expect(collationState.alignmentColumns).toHaveLength(2);
		expect(collationState.alignmentColumns[1]?.id).toBe('col-gap');
		expect(collationState.alignmentColumns[1]?.cells.get('A')?.text).toBe('λογος');
		expect(collationState.alignmentColumns[1]?.cells.get('B')?.isOmission).toBe(true);
	});

	it('does not prune a source column after a move when another witness still has text there', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και λογος', { isBaseText: true }),
			makeWitness('B', 'και λογος'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και')],
						['B', makeTextCell('και')],
					],
				},
				{
					id: 'col-2',
					index: 1,
					merged: false,
					cells: [
						['A', makeTextCell('λογος')],
						['B', makeTextCell('λογος')],
					],
				},
			],
		});

		collationState.shiftToken('col-2', 'A', 'right');

		expect(collationState.alignmentColumns).toHaveLength(3);
		expect(collationState.alignmentColumns[1]?.cells.get('A')?.isOmission).toBe(true);
		expect(collationState.alignmentColumns[1]?.cells.get('B')?.text).toBe('λογος');
		expect(collationState.alignmentColumns[2]?.cells.get('A')?.text).toBe('λογος');
	});

	it('keeps insert plus move plus prune as one undoable action', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και λογος', { isBaseText: true }),
			makeWitness('B', 'και λογος'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και')],
						['B', makeTextCell('και')],
					],
				},
				{
					id: 'col-2',
					index: 1,
					merged: false,
					cells: [
						['A', makeTextCell('λογος')],
						['B', makeOmissionCell()],
					],
				},
			],
		});

		const initialColumnIds = collationState.alignmentColumns.map(column => column.id);

		collationState.shiftToken('col-2', 'A', 'right');
		const shiftedColumnIds = collationState.alignmentColumns.map(column => column.id);
		expect(collationState.alignmentColumns.map(column => column.cells.get('A')?.text)).toEqual([
			'και',
			'λογος',
		]);
		expect(shiftedColumnIds[1]).not.toBe(initialColumnIds[1]);

		collationState.undo();
		expect(collationState.alignmentColumns.map(column => column.id)).toEqual(initialColumnIds);
		expect(collationState.alignmentColumns.map(column => column.cells.get('A')?.text)).toEqual([
			'και',
			'λογος',
		]);
		expect(collationState.alignmentColumns).toHaveLength(2);
		expect(collationState.alignmentColumns[1]?.cells.get('B')?.isOmission).toBe(true);

		collationState.redo();
		expect(collationState.alignmentColumns.map(column => column.cells.get('A')?.text)).toEqual([
			'και',
			'λογος',
		]);
		expect(collationState.alignmentColumns).toHaveLength(2);
		expect(collationState.alignmentColumns[0]?.id).toBe('col-1');
		expect(collationState.alignmentColumns[1]?.id).not.toBe(initialColumnIds[1]);
	});

	it('does not shift when the target displayed slot is occupied for that witness', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και λογος'),
			makeWitness('B', 'και λογος', { isBaseText: true }),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και')],
						['B', makeTextCell('και')],
					],
				},
				{
					id: 'col-gap',
					index: 1,
					merged: false,
					cells: [
						['A', makeTextCell('παυλος')],
						['B', makeOmissionCell()],
					],
				},
				{
					id: 'col-2',
					index: 2,
					merged: false,
					cells: [
						['A', makeTextCell('λογος')],
						['B', makeTextCell('λογος')],
					],
				},
			],
		});

		expect(collationState.canShiftToken('col-2', 'A', 'left')).toBe(false);

		collationState.shiftToken('col-2', 'A', 'left');

		expect(collationState.alignmentColumns).toHaveLength(3);
		expect(collationState.alignmentColumns[1]?.cells.get('A')?.text).toBe('παυλος');
		expect(collationState.alignmentColumns[2]?.cells.get('A')?.text).toBe('λογος');
	});

	it('falls back to witness source tokens when a saved alignment has collapsed the full verse into one cell', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και λογος', { isBaseText: true }),
			makeWitness('B', 'και ρημα'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'collapsed',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και λογος')],
						['B', makeTextCell('και ρημα')],
					],
				},
			],
		});

		const inputs = collationState.buildCollationWitnessInputs();
		expect(inputs[0]?.tokens).toHaveLength(2);
		expect(inputs[0]?.tokens?.map(token => token.t)).toEqual(['και', 'λογος']);
		expect(inputs[1]?.tokens?.map(token => token.t)).toEqual(['και', 'ρημα']);
	});

	it('can force reruns to use source witness tokens instead of the current alignment cells', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και λογος ον the mat', { isBaseText: true }),
			makeWitness('B', 'και ρημα ον the mat'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('και')],
						['B', makeTextCell('και')],
					],
				},
				{
					id: 'col-2',
					index: 1,
					merged: false,
					cells: [
						['A', makeTextCell('λογος')],
						['B', makeTextCell('ρημα')],
					],
				},
				{
					id: 'col-3',
					index: 2,
					merged: false,
					cells: [
						['A', makeTextCell('ον the mat')],
						['B', makeTextCell('ον the mat')],
					],
				},
			],
		});

		const inputs = collationState.buildCollationWitnessInputs({ forceSourceWitnesses: true });
		expect(inputs[0]?.tokens?.map(token => token.t)).toEqual([
			'και',
			'λογος',
			'ον',
			'the',
			'mat',
		]);
		expect(inputs[1]?.tokens?.map(token => token.t)).toEqual([
			'και',
			'ρημα',
			'ον',
			'the',
			'mat',
		]);
	});

	it('can update project transcription treatment individually and in bulk for correctors', () => {
		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true, treatment: 'full' }),
			{
				...makeWitness('A-c1', 'λογος', {
					kind: 'corrector',
					handId: 'corrector1',
					treatment: 'inherit',
					fullContent: 'λογος',
					fullTokens: makeTokens('λογος'),
					fragmentaryContent: 'θς',
					fragmentaryTokens: makeTokens('θς'),
				}),
				transcriptionId: 'A-tx',
			},
			{
				...makeWitness('B-c1', 'ρημα', {
					kind: 'corrector',
					handId: 'corrector1',
					treatment: 'inherit',
					fullContent: 'ρημα',
					fullTokens: makeTokens('ρημα'),
					fragmentaryContent: 'ρ',
					fragmentaryTokens: makeTokens('ρ'),
				}),
				transcriptionId: 'B-tx',
			},
		]);

		collationState.setProjectTranscriptionTreatment('A-tx', 'full');
		expect(collationState.getProjectTranscriptionTreatment('A-tx')).toBe('full');
		expect(collationState.witnesses[1]?.content).toBe('λογος');

		collationState.setAllProjectTranscriptionTreatments(['A-tx', 'B-tx'], 'fragmentary');
		expect(collationState.getProjectTranscriptionTreatment('A-tx')).toBe('fragmentary');
		expect(collationState.getProjectTranscriptionTreatment('B-tx')).toBe('fragmentary');
		expect(collationState.witnesses[1]?.content).toBe('θς');
		expect(collationState.witnesses[2]?.content).toBe('ρ');
	});

	it('filters excluded hand witnesses from project settings', () => {
		collationState.setProjectTranscriptionHandIncluded('A-tx', 'corrector1', false);

		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true, treatment: 'full' }),
			{
				...makeWitness('A-c1', 'θς', { kind: 'corrector', handId: 'corrector1' }),
				transcriptionId: 'A-tx',
			},
		]);

		expect(collationState.isProjectTranscriptionHandIncluded('A-tx', 'corrector1')).toBe(false);
		expect(collationState.witnesses.map(witness => witness.witnessId)).toEqual(['A']);
	});

	it('proposes a nonsense type for a subreading a ns-typed rule produced', () => {
		collationState.setWitnesses([
			makeWitness('A', 'θεος', { isBaseText: true }),
			makeWitness('B', 'θς'),
		]);
		collationState.addRule(makeRule());
		collationState.refreshCollationInput();

		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});

		collationState.setAlignmentSnapshot(snapshot.snapshot);

		const readings = collationState.getReadingsForUnit(0);
		expect(readings).toHaveLength(2);

		const base = readings.find(reading => reading.text === 'θεος');
		const sub = readings.find(reading => reading.text === 'θς');

		expect(base?.label).toBe('a');
		expect(sub?.label).toBe('a1');
		expect(sub?.readingType).toBe('nonsense');
		expect(sub?.parentReadingId).toBe(base?.id);
		expect(sub?.isSubreading).toBe(true);
	});

	it('keeps a cross-text subreading attachment through another reading edit and makes it undoable', () => {
		collationState.setPhase('readings');
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B', 'C'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('alpha')],
						['B', makeTextCell('beta')],
						['C', makeTextCell('gamma')],
					],
				},
			],
		});
		const initial = collationState.getReadingsForUnit(0);
		const alpha = initial.find(reading => reading.text === 'alpha')!;
		const beta = initial.find(reading => reading.text === 'beta')!;
		const gamma = initial.find(reading => reading.text === 'gamma')!;

		expect(collationState.setReadingParent(0, beta.id, alpha.id)).toEqual({ ok: true });
		collationState.updateReadingText(0, gamma.id, 'delta');

		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === beta.id)
				?.parentReadingId
		).toBe(alpha.id);

		collationState.undo();
		expect(collationState.phase).toBe('readings');
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === beta.id)
				?.parentReadingId
		).toBeNull();

		collationState.redo();
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === beta.id)
				?.parentReadingId
		).toBe(alpha.id);
	});

	it('reports self-attachment and cycles to the caller', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('alpha')],
						['B', makeTextCell('beta')],
					],
				},
			],
		});
		const [alpha, beta] = collationState.getReadingsForUnit(0);

		expect(collationState.setReadingParent(0, alpha.id, alpha.id)).toEqual({
			ok: false,
			error: 'self-attachment',
		});
		expect(collationState.setReadingParent(0, alpha.id, beta.id)).toEqual({ ok: true });
		expect(collationState.setReadingParent(0, beta.id, alpha.id)).toEqual({
			ok: false,
			error: 'cycle',
		});
	});

	it('surfaces a decision when its reading is removed', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('alpha')],
						['B', makeTextCell('beta')],
					],
				},
			],
		});
		const alpha = collationState.getReadingsForUnit(0)[0];
		const addedId = collationState.addReading(0);
		collationState.setReadingParent(0, addedId, alpha.id);

		collationState.deleteReading(0, addedId);

		expect(collationState.getOrphanedDecisionsForUnit(0)).toEqual([
			{
				kind: 'subreadingOf',
				readingId: addedId,
				mainReadingId: alpha.id,
				missingReadingIds: [addedId],
			},
		]);
	});

	it('keeps other-unit decisions attached when earlier columns merge', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: ['col-1', 'col-2', 'col-3'].map((id, index) => ({
				id,
				index,
				merged: false,
				cells: [
					['A', makeTextCell(`alpha-${index}`)],
					['B', makeTextCell(`beta-${index}`)],
				],
			})),
		});
		const third = collationState.getReadingsForUnit(2);
		collationState.setReadingParent(2, third[1].id, third[0].id);

		collationState.mergeColumns(['col-1', 'col-2']);

		expect(
			collationState.getReadingsForUnit(1).find(reading => reading.id === third[1].id)
				?.parentReadingId
		).toBe(third[0].id);
		expect(collationState.unitDecisions.has('unit:col-3')).toBe(true);
	});

	it('revives orphaned decisions when merged units are split again', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: ['col-1', 'col-2'].map((id, index) => ({
				id,
				index,
				merged: false,
				cells: [
					['A', makeTextCell(`alpha-${index}`)],
					['B', makeTextCell(`beta-${index}`)],
				],
			})),
		});
		const first = collationState.getReadingsForUnit(0);
		const second = collationState.getReadingsForUnit(1);
		collationState.setReadingParent(0, first[1].id, first[0].id);
		collationState.setReadingParent(1, second[1].id, second[0].id);

		collationState.mergeColumns(['col-1', 'col-2']);
		expect(collationState.getOrphanedUnitDecisions().map(orphan => orphan.unitId)).toEqual([
			'unit:col-1',
			'unit:col-2',
		]);

		collationState.splitColumn(collationState.alignmentColumns[0].id);
		expect(collationState.getOrphanedUnitDecisions()).toEqual([]);
		expect(collationState.getReadingsForUnit(0)[1]?.parentReadingId).toBe(first[0].id);
		expect(collationState.getReadingsForUnit(1)[1]?.parentReadingId).toBe(second[0].id);
	});

	it('revives orphaned decisions when a merge is undone', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: ['col-1', 'col-2'].map((id, index) => ({
				id,
				index,
				merged: false,
				cells: [
					['A', makeTextCell(`alpha-${index}`)],
					['B', makeTextCell(`beta-${index}`)],
				],
			})),
		});
		const first = collationState.getReadingsForUnit(0);
		collationState.setReadingParent(0, first[1].id, first[0].id);
		collationState.mergeColumns(['col-1', 'col-2']);
		expect(collationState.getOrphanedUnitDecisions()).toHaveLength(1);

		collationState.undo();
		expect(collationState.getOrphanedUnitDecisions()).toEqual([]);
		expect(collationState.getReadingsForUnit(0)[1]?.parentReadingId).toBe(first[0].id);
	});

	it('promotes the preferred reading as parent when all equivalent readings are regularized', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B', 'C', 'D'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						[
							'A',
							{
								text: 'alpha',
								regularizedText: 'omega',
								alignmentValue: 'omega',
								sourceTokenIds: [],
								kind: 'text',
								gap: null,
								isOmission: false,
								isLacuna: false,
								isRegularized: true,
								ruleIds: ['rule-1'],
								regularizationTypes: ['ns'],
							},
						],
						[
							'B',
							{
								text: 'beta',
								regularizedText: 'omega',
								alignmentValue: 'omega',
								sourceTokenIds: [],
								kind: 'text',
								gap: null,
								isOmission: false,
								isLacuna: false,
								isRegularized: true,
								ruleIds: ['rule-2'],
								regularizationTypes: ['ns'],
							},
						],
						[
							'C',
							{
								text: 'beta',
								regularizedText: 'omega',
								alignmentValue: 'omega',
								sourceTokenIds: [],
								kind: 'text',
								gap: null,
								isOmission: false,
								isLacuna: false,
								isRegularized: true,
								ruleIds: ['rule-2'],
								regularizationTypes: ['ns'],
							},
						],
						[
							'D',
							{
								text: 'gamma',
								regularizedText: 'omega',
								alignmentValue: 'omega',
								sourceTokenIds: [],
								kind: 'text',
								gap: null,
								isOmission: false,
								isLacuna: false,
								isRegularized: true,
								ruleIds: ['rule-3'],
								regularizationTypes: ['ns'],
							},
						],
					],
				},
			],
		});

		const readings = collationState.getReadingsForUnit(0);
		const parent = readings.find(reading => reading.text === 'beta');
		const alpha = readings.find(reading => reading.text === 'alpha');
		const gamma = readings.find(reading => reading.text === 'gamma');

		expect(parent?.label).toBe('a');
		expect(parent?.parentReadingId).toBeNull();
		expect(parent?.isSubreading).toBe(false);
		expect(alpha?.parentReadingId).toBe(parent?.id);
		expect(alpha?.readingType).toBe('nonsense');
		expect(gamma?.parentReadingId).toBe(parent?.id);
		expect(gamma?.readingType).toBe('nonsense');
	});

	it('can promote a different member of a regularized family as the parent', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B', 'C'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						[
							'A',
							{
								...makeTextCell('θεος'),
								originalSegments: [
									{
										text: 'θεος',
										hasUnclear: false,
										isPunctuation: false,
										isSupplied: false,
									},
								],
							},
						],
						[
							'B',
							{
								...makeTextCell('θς'),
								regularizedText: 'θεος',
								alignmentValue: 'θεος',
								isRegularized: true,
								ruleIds: ['rule-1'],
								regularizationTypes: ['ns'],
								originalSegments: [
									{
										text: 'θς',
										hasUnclear: false,
										isPunctuation: false,
										isSupplied: false,
									},
								],
							},
						],
						[
							'C',
							{
								...makeTextCell('θεοσ'),
								regularizedText: 'θεος',
								alignmentValue: 'θεος',
								originalSegments: [
									{
										text: 'θεοσ',
										hasUnclear: false,
										isPunctuation: false,
										isSupplied: false,
									},
								],
							},
						],
					],
				},
			],
		});

		const before = collationState.getReadingsForUnit(0);
		const promoted = before.find(reading => reading.text === 'θς');
		expect(promoted?.parentReadingId).not.toBeNull();

		collationState.promoteReadingAsFamilyParent(0, promoted!.id);

		const after = collationState.getReadingsForUnit(0);
		const nextParent = after.find(reading => reading.text === 'θς');
		const previousParent = after.find(reading => reading.text === 'θεος');
		const sibling = after.find(reading => reading.text === 'θεοσ');

		expect(nextParent?.parentReadingId).toBeNull();
		expect(nextParent?.isSubreading).toBe(false);
		// The type describes the reading's own evidence, so promotion does not move it around
		// the family: only the witness whose ns rule fired keeps a nonsense type.
		expect(nextParent?.readingType).toBe('nonsense');
		expect(previousParent?.parentReadingId).toBe(nextParent?.id);
		expect(previousParent?.readingType).toBeNull();
		expect(sibling?.parentReadingId).toBe(nextParent?.id);
		expect(sibling?.readingType).toBeNull();
	});

	it('uses shared displayed column slots for base word and space ids', () => {
		collationState.setWitnesses([
			makeWitness('A', 'και ο λογος', { isBaseText: true }),
			makeWitness('B', 'και του λογου'),
		]);

		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});
		const slots = collationState.getDisplayedColumnSlots(
			deserializeAlignmentColumns(snapshot.snapshot.columns)
		);

		expect(slots.map(slot => [slot.start, slot.end])).toEqual([
			[2, 2],
			[4, 4],
			[6, 6],
		]);
	});

	it('reuses alignment display values for readings with word-break markers', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						[
							'A',
							{
								...makeTextCell('κλη\\nτος'),
								regularizedText: 'κλητος',
								alignmentValue: 'κλητος',
								originalSegments: [
									{
										text: 'κλη',
										hasUnclear: false,
										isPunctuation: false,
										isSupplied: false,
									},
									{
										text: 'τος',
										hasUnclear: false,
										isPunctuation: false,
										isSupplied: false,
									},
								],
							},
						],
						[
							'B',
							{
								...makeTextCell('κλητος'),
								originalSegments: [
									{
										text: 'κλητος',
										hasUnclear: false,
										isPunctuation: false,
										isSupplied: false,
									},
								],
							},
						],
					],
				},
			],
		});

		const readings = collationState.getReadingsForUnit(0);
		const target = readings.find(reading => reading.text === 'κλη\\nτος');
		const displayValues = collationState.getReadingDisplayValuesForUnit(0);
		const display = target ? displayValues.get(target.id) : null;

		expect(display?.originalDisplayText).toBe('κλητος');
		expect(display?.regularizedDisplayText).toBe('κλητος');
	});

	it('aggregates family witnesses onto the parent in regularized display mode', () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						[
							'A',
							{
								...makeTextCell('θεος'),
								originalSegments: [
									{
										text: 'θεος',
										hasUnclear: false,
										isPunctuation: false,
										isSupplied: false,
									},
								],
							},
						],
						[
							'B',
							{
								...makeTextCell('θς'),
								regularizedText: 'θεος',
								alignmentValue: 'θεος',
								isRegularized: true,
								ruleIds: ['rule-1'],
								regularizationTypes: ['ns'],
								originalSegments: [
									{
										text: 'θς',
										hasUnclear: false,
										isPunctuation: false,
										isSupplied: false,
									},
								],
							},
						],
					],
				},
			],
		});

		const parent = collationState.getReadingFamiliesForUnit(0)[0]?.parent;

		expect(parent).toBeTruthy();
		expect(
			collationState.getDisplayedWitnessIdsForReading(0, parent!.id, 'regularized')
		).toEqual(['A', 'B']);
		expect(collationState.getDisplayedWitnessIdsForReading(0, parent!.id, 'original')).toEqual([
			'A',
		]);
	});

	it('can lowercase alignment text while preserving original token text', () => {
		collationState.setWitnesses([
			makeWitness('A', 'ΘΕΟΣ', { isBaseText: true }),
			makeWitness('B', 'θεος'),
		]);

		collationState.setLowercase(true);
		collationState.refreshCollationInput();

		const inputs = collationState.buildCollationWitnessInputs({ forceSourceWitnesses: true });
		expect(inputs[0]?.tokens?.[0]).toMatchObject({
			t: 'ΘΕΟΣ',
			n: 'θεος',
		});
		expect(inputs[1]?.tokens?.[0]).toMatchObject({
			t: 'θεος',
			n: 'θεος',
		});
	});

	it('renders preview tokens from the same derivation submitted to the worker', () => {
		collationState.setWitnesses([
			makeWitness('A', 'θς', { isBaseText: true }),
			makeWitness('B', 'θεος'),
		]);
		collationState.addRule(makeRule());

		const previewTokens = collationState.regularizedTexts.get('A') ?? [];
		const workerTokens =
			collationState.buildCollationWitnessInputs({ forceSourceWitnesses: true })[0]?.tokens ??
			[];

		expect(previewTokens.map(token => token.regularized)).toEqual(
			workerTokens.map(token => token.displayRegularized)
		);
		expect(previewTokens.map(token => token.alignmentValue)).toEqual(
			workerTokens.map(token => token.n)
		);
	});

	it('marks alignment stale when rules or settings change after a run and clears on rerun', () => {
		collationState.setWitnesses([
			makeWitness('A', 'θς', { isBaseText: true }),
			makeWitness('B', 'θεος'),
		]);
		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});

		collationState.setAlignmentSnapshot(snapshot.snapshot);
		expect(collationState.isAlignmentStale).toBe(false);

		collationState.addRule(makeRule());
		expect(collationState.isAlignmentStale).toBe(true);

		const rerun = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs({ forceSourceWitnesses: true }),
			options: { segmentation: collationState.segmentation },
		});
		collationState.setAlignmentSnapshot(rerun.snapshot);
		expect(collationState.isAlignmentStale).toBe(false);

		collationState.setIgnorePunctuation(true);
		expect(collationState.isAlignmentStale).toBe(true);
	});

	it('keeps punctuation as its own source token when not ignored', () => {
		collationState.setWitnesses([
			{
				...makeWitness('A', 'λογος, θεος', { isBaseText: true }),
				content: 'λογος, θεος',
				tokens: [
					makeSourceToken('λογος'),
					makeSourceToken(',', { isPunctuation: true }),
					makeSourceToken('θεος'),
				],
			},
			makeWitness('B', 'λογος θεος'),
		]);

		const inputs = collationState.buildCollationWitnessInputs({ forceSourceWitnesses: true });

		expect(inputs[0]?.tokens?.map(token => token.t)).toEqual(['λογος', ',', 'θεος']);
		expect(inputs[0]?.content).toBe('λογος, θεος');
		expect(inputs[0]?.tokens?.[1]).toMatchObject({ isPunctuation: true, n: ',' });
	});

	it('treats ignored punctuation as belonging to the preceding token', () => {
		collationState.setWitnesses([
			{
				...makeWitness('A', 'λογος, θεος', { isBaseText: true }),
				content: 'λογος, θεος',
				tokens: [
					makeSourceToken('λογος'),
					makeSourceToken(',', { isPunctuation: true }),
					makeSourceToken('θεος'),
				],
			},
			makeWitness('B', 'λογος θεος'),
		]);

		collationState.setIgnorePunctuation(true);

		const inputs = collationState.buildCollationWitnessInputs({ forceSourceWitnesses: true });

		expect(inputs[0]?.tokens?.map(token => token.t)).toEqual(['λογος,', 'θεος']);
		expect(inputs[0]?.tokens?.map(token => token.n)).toEqual(['λογος', 'θεος']);
		expect(inputs[0]?.tokens?.[0]?.sourceTokenIds).toEqual(['A::source::0', 'A::source::1']);
		expect(inputs[0]?.tokens?.[0]?.originalSegments).toEqual([
			{ text: 'λογος', hasUnclear: false, isPunctuation: false, isSupplied: false },
			{ text: ',', hasUnclear: false, isPunctuation: true, isSupplied: false },
		]);
		expect(inputs[0]?.content).toBe('λογος, θεος');
	});

	it('ignores internal token whitespace in alignment values by default', () => {
		collationState.setWitnesses([
			{
				...makeWitness('A', 'κλη τος', { isBaseText: true }),
				content: 'κλη\\nτος',
				tokens: [
					{
						kind: 'text',
						original: 'κλη\\nτος',
						segments: [
							{
								text: 'κλη\\nτος',
								hasUnclear: false,
								isPunctuation: false,
								isSupplied: false,
							},
						],
						gap: null,
					},
				],
			},
			makeWitness('B', 'κλητος'),
		]);

		collationState.refreshCollationInput();

		const inputs = collationState.buildCollationWitnessInputs({ forceSourceWitnesses: true });
		expect(inputs[0]?.tokens?.[0]).toMatchObject({
			t: 'κλη\\nτος',
			n: 'κλητος',
		});
		expect(inputs[1]?.tokens?.[0]).toMatchObject({
			t: 'κλητος',
			n: 'κλητος',
		});
	});

	it('regularizes unclear text for alignment while preserving original unclear segments', () => {
		collationState.setWitnesses([
			{
				...makeWitness('A', 'αποστολος', { isBaseText: true }),
				content: 'αποστολος',
				tokens: [
					{
						kind: 'text',
						original: 'αποστολος',
						segments: [
							{
								text: 'απο',
								hasUnclear: false,
								isPunctuation: false,
								isSupplied: false,
							},
							{
								text: 'στ',
								hasUnclear: true,
								isPunctuation: false,
								isSupplied: false,
							},
							{
								text: 'ολος',
								hasUnclear: false,
								isPunctuation: false,
								isSupplied: false,
							},
						],
						gap: null,
					},
				],
			},
			makeWitness('B', 'αποστολος'),
		]);

		collationState.refreshCollationInput();

		const inputs = collationState.buildCollationWitnessInputs({ forceSourceWitnesses: true });
		expect(inputs[0]?.tokens?.[0]).toMatchObject({
			t: 'αποστολος',
			n: 'αποστολος',
			hasUnclear: true,
			originalSegments: [
				{ text: 'απο', hasUnclear: false, isPunctuation: false, isSupplied: false },
				{ text: 'στ', hasUnclear: true, isPunctuation: false, isSupplied: false },
				{ text: 'ολος', hasUnclear: false, isPunctuation: false, isSupplied: false },
			],
		});
	});

	it('splits a grouped reading into a standalone original-reading node', () => {
		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true }),
			makeWitness('B', 'λογος'),
			makeWitness('C', 'λογος'),
		]);
		collationState.refreshCollationInput();

		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});

		collationState.setAlignmentSnapshot(snapshot.snapshot);

		const initial = collationState.getReadingsForUnit(0);
		expect(initial).toHaveLength(1);
		expect(initial[0]?.witnessIds).toEqual(['A', 'B', 'C']);

		collationState.splitWitnessFromReading(0, initial[0]!.id, 'C');

		const updated = collationState.getReadingsForUnit(0);
		expect(updated).toHaveLength(2);
		expect(updated.map(reading => reading.witnessIds)).toEqual([['A', 'B'], ['C']]);
	});
});

describe('collationState lemma establishment', () => {
	beforeEach(() => {
		collationState.reset();
	});

	function makeLacunaCell() {
		return { ...makeTextCell(''), kind: 'gap' as const, isLacuna: true };
	}

	function setUpUnit(
		cells: Record<string, ReturnType<typeof makeTextCell> | ReturnType<typeof makeLacunaCell>>,
		options?: { excludeBase?: boolean }
	) {
		collationState.setWitnesses([
			makeWitness('A', 'alpha', { isBaseText: true, isExcluded: options?.excludeBase }),
			...Object.keys(cells)
				.filter(id => id !== 'A')
				.map(id => makeWitness(id, 'other')),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: Object.keys(cells),
			columns: [{ id: 'col-1', index: 0, merged: false, cells: Object.entries(cells) }],
		});
	}

	it('derives the lemma from the base text and labels that reading a', () => {
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeTextCell('beta'),
			C: makeTextCell('beta'),
		});

		const readings = collationState.getReadingsForUnit(0);
		const alpha = readings.find(reading => reading.text === 'alpha')!;

		expect(collationState.getLemmaReadingId(0)).toBe(alpha.id);
		expect(alpha.label).toBe('a');
		expect(collationState.unitNeedsLemmaDecision(0)).toBe(false);
	});

	it('elevates a reading to a while the base-text reading keeps a letter ahead of the rest', () => {
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeTextCell('beta'),
			C: makeTextCell('gamma'),
			D: makeTextCell('gamma'),
		});
		const initial = collationState.getReadingsForUnit(0);
		const beta = initial.find(reading => reading.text === 'beta')!;

		expect(collationState.setLemmaReading(0, beta.id)).toEqual({ ok: true });

		expect(
			collationState.getReadingsForUnit(0).map(reading => [reading.text, reading.label])
		).toEqual([
			['beta', 'a'],
			['alpha', 'b'],
			['gamma', 'c'],
		]);
	});

	it('keeps the lemma decision through an unrelated edit and undoes it in one step', () => {
		setUpUnit({ A: makeTextCell('alpha'), B: makeTextCell('beta'), C: makeTextCell('gamma') });
		const initial = collationState.getReadingsForUnit(0);
		const beta = initial.find(reading => reading.text === 'beta')!;
		const gamma = initial.find(reading => reading.text === 'gamma')!;

		collationState.setLemmaReading(0, beta.id);
		collationState.updateReadingText(0, gamma.id, 'delta');
		expect(collationState.getLemmaReadingId(0)).toBe(beta.id);

		collationState.undo();

		const afterUndo = collationState.getReadingsForUnit(0);
		expect(collationState.getLemmaReadingId(0)).toBe(
			afterUndo.find(reading => reading.text === 'alpha')!.id
		);
		expect(afterUndo.find(reading => reading.id === gamma.id)?.text).toBe('delta');
	});

	it('needs a lemma decision where the base text does not attest, and clears it once designated', () => {
		setUpUnit({ A: makeLacunaCell(), B: makeTextCell('beta'), C: makeTextCell('gamma') });

		expect(collationState.unitNeedsLemmaDecision(0)).toBe(true);
		expect(collationState.getLemmaReadingId(0)).toBeNull();
		const readings = collationState.getReadingsForUnit(0);
		expect(readings.length).toBeGreaterThan(1);
		expect(readings.every(reading => reading.label.length > 0)).toBe(true);
		expect(collationState.getUnitsNeedingLemmaDecision()).toEqual([
			{ unitIndex: 0, unitId: 'unit:col-1' },
		]);

		const beta = readings.find(reading => reading.text === 'beta')!;
		collationState.setLemmaReading(0, beta.id);

		expect(collationState.unitNeedsLemmaDecision(0)).toBe(false);
		expect(collationState.getUnitsNeedingLemmaDecision()).toEqual([]);
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === beta.id)?.label
		).toBe('a');
	});

	it('treats an excluded base text like non-attestation', () => {
		setUpUnit(
			{ A: makeTextCell('alpha'), B: makeTextCell('beta'), C: makeTextCell('gamma') },
			{ excludeBase: true }
		);

		expect(collationState.unitNeedsLemmaDecision(0)).toBe(true);
		expect(collationState.getLemmaReadingId(0)).toBeNull();
		expect(collationState.getReadingsForUnit(0).length).toBeGreaterThan(1);
	});

	it('reports divergence for exactly the units whose lemma is not the base text reading', () => {
		collationState.setWitnesses([
			makeWitness('A', 'alpha zeta', { isBaseText: true }),
			makeWitness('B', 'beta eta'),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('alpha')],
						['B', makeTextCell('beta')],
					],
				},
				{
					id: 'col-2',
					index: 1,
					merged: false,
					cells: [
						['A', makeTextCell('zeta')],
						['B', makeTextCell('eta')],
					],
				},
			],
		});
		expect(collationState.getLemmaDivergence()).toEqual([]);

		const second = collationState.getReadingsForUnit(1);
		const eta = second.find(reading => reading.text === 'eta')!;
		const zeta = second.find(reading => reading.text === 'zeta')!;
		collationState.setLemmaReading(1, eta.id);

		expect(collationState.getLemmaDivergence()).toEqual([
			{
				unitIndex: 1,
				unitId: 'unit:col-2',
				lemmaReadingId: eta.id,
				baseTextReadingId: zeta.id,
			},
		]);

		collationState.setLemmaReading(1, zeta.id);
		expect(collationState.getLemmaDivergence()).toEqual([]);
	});

	it('leaves existing arcs untouched when the lemma is elevated', () => {
		setUpUnit({ A: makeTextCell('alpha'), B: makeTextCell('beta'), C: makeTextCell('gamma') });
		const readings = collationState.getReadingsForUnit(0);
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		const beta = readings.find(reading => reading.text === 'beta')!;
		collationState.addStemmaEdge(0, {
			id: 'edge-1',
			sourceReadingId: alpha.id,
			targetReadingId: beta.id,
			directed: true,
		});
		const before = structuredClone(collationState.stemmaEdges.get('unit:col-1'));

		collationState.setLemmaReading(0, beta.id);

		expect(collationState.stemmaEdges.get('unit:col-1')).toEqual(before);
	});

	it('reports a refused reorder instead of returning silently', () => {
		setUpUnit({ A: makeTextCell('alpha'), B: makeTextCell('beta'), C: makeTextCell('gamma') });
		const readings = collationState.getReadingsForUnit(0);
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		const beta = readings.find(reading => reading.text === 'beta')!;
		const subreading = collationState.addReading(0, { parentReadingId: alpha.id });

		expect(collationState.moveReadingBefore(0, subreading, beta.id)).toEqual({
			ok: false,
			error: 'different-group',
		});
		expect(collationState.moveReadingBefore(0, 'missing', beta.id)).toEqual({
			ok: false,
			error: 'reading-not-found',
		});
		expect(collationState.moveReadingByOffset(0, alpha.id, -1)).toEqual({
			ok: false,
			error: 'at-boundary',
		});
		expect(collationState.moveReadingByOffset(0, alpha.id, 1)).toEqual({ ok: true });
	});

	it('reorders the rows the readings phase displays once a lemma is elevated', () => {
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeTextCell('beta'),
			C: makeTextCell('gamma'),
			D: makeTextCell('gamma'),
		});
		const initial = collationState.getReadingsForUnit(0);
		const beta = initial.find(reading => reading.text === 'beta')!;
		const gamma = initial.find(reading => reading.text === 'gamma')!;
		collationState.setLemmaReading(0, gamma.id);

		const displayed = () =>
			collationState.getReadingFamiliesForUnit(0).map(family => family.parent.text);
		expect(displayed()).toEqual(['gamma', 'alpha', 'beta']);

		// `gamma` heads the displayed sequence, so there is no row above it to swap with.
		expect(collationState.moveReadingByOffset(0, gamma.id, -1)).toEqual({
			ok: false,
			error: 'at-boundary',
		});

		expect(collationState.moveReadingByOffset(0, beta.id, -1)).toEqual({ ok: true });
		expect(displayed()).toEqual(['gamma', 'beta', 'alpha']);
	});
});

describe('collationState non-attestation', () => {
	beforeEach(() => {
		collationState.reset();
	});

	/**
	 * A gap cell as the collation pipeline emits one: the tokenizer gives gap and untranscribed
	 * milestones the `⊘` placeholder as their text, so the cell is never empty and attestation
	 * cannot be decided from text presence.
	 */
	function makeGapCell(kind: 'gap' | 'untranscribed' = 'gap'): AlignmentCell {
		return {
			...makeTextCell('⊘'),
			regularizedText: null,
			alignmentValue: `__${kind}__:none:none:none`,
			kind,
			gap: { source: kind, reason: '', unit: '', extent: '' },
			isLacuna: true,
		};
	}

	function makeGapToken(): WitnessSourceToken {
		return {
			kind: 'gap',
			original: '⊘',
			segments: [],
			gap: { source: 'gap', reason: 'lacuna', unit: 'char', extent: '5' },
		};
	}

	function makeSuppliedToken(text: string): WitnessSourceToken {
		return {
			kind: 'text',
			original: text,
			segments: [{ text, hasUnclear: false, isPunctuation: false, isSupplied: true }],
			gap: null,
		};
	}

	function collateWitnesses() {
		collationState.refreshCollationInput();
		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});
		collationState.setAlignmentSnapshot(snapshot.snapshot);
	}

	function setUpUnit(cells: Record<string, AlignmentCell>) {
		collationState.setWitnesses([
			makeWitness('A', 'alpha', { isBaseText: true }),
			...Object.keys(cells)
				.filter(id => id !== 'A')
				.map(id => makeWitness(id, 'other')),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: Object.keys(cells),
			columns: [{ id: 'col-1', index: 0, merged: false, cells: Object.entries(cells) }],
		});
	}

	it('leaves reading order untouched when a lacunose witness joins the unit', () => {
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeTextCell('beta'),
			C: makeTextCell('beta'),
		});
		const before = collationState
			.getReadingsForUnit(0)
			.map(reading => [reading.label, reading.text, reading.witnessIds]);

		collationState.reset();
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeTextCell('beta'),
			C: makeTextCell('beta'),
			D: makeGapCell(),
			E: makeGapCell(),
		});

		const after = collationState
			.getReadingsForUnit(0)
			.map(reading => [reading.label, reading.text, reading.witnessIds]);
		expect(after).toEqual(before);
		expect(collationState.getReadingsForUnit(0).some(reading => reading.isLacuna)).toBe(false);
	});

	it('surfaces damaged and untranscribed witnesses separately', () => {
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeTextCell('beta'),
			C: makeGapCell(),
			D: makeGapCell('untranscribed'),
		});

		expect(collationState.getNonAttestationForUnit(0)).toEqual({
			witnessIds: ['C'],
			untranscribedWitnessIds: ['D'],
		});
	});

	it('refuses to attach a non-attesting witness as a subreading in either direction', () => {
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeTextCell('beta'),
			C: makeGapCell(),
		});
		const readings = collationState.getReadingsForUnit(0);
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		// Non-attestation holds no reading id, so the only address a caller could reach for
		// is the absent witness itself.
		expect(collationState.setReadingParent(0, 'C', alpha.id)).toEqual({
			ok: false,
			error: 'reading-not-found',
		});
		expect(collationState.setReadingParent(0, alpha.id, 'C')).toEqual({
			ok: false,
			error: 'reading-not-found',
		});
	});

	it('keeps an omission a lettered reading alongside non-attestation', () => {
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeOmissionCell(),
			C: makeGapCell(),
		});

		expect(
			collationState.getReadingsForUnit(0).map(reading => [reading.label, reading.witnessIds])
		).toEqual([
			['a', ['A']],
			['b', ['B']],
		]);
		expect(collationState.getNonAttestationForUnit(0).witnessIds).toEqual(['C']);
	});

	it('excludes a witness transcribed as a real gap from lettering, ordering, and readings', () => {
		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true }),
			makeWitness('B', 'λογος'),
			{ ...makeWitness('C', 'λογος'), tokens: [makeGapToken()] },
		]);
		collateWitnesses();

		const readings = collationState.getReadingsForUnit(0);
		expect(readings.map(reading => [reading.label, reading.text, reading.witnessIds])).toEqual([
			['a', 'λογος', ['A', 'B']],
		]);
		expect(collationState.getNonAttestationForUnit(0)).toEqual({
			witnessIds: ['C'],
			untranscribedWitnessIds: [],
		});
	});

	it('treats a supplied-only witness collated as a gap as absent, not as its restored letters', () => {
		collationState.setSuppliedTextMode('gap');
		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true }),
			makeWitness('B', 'λογος'),
			{ ...makeWitness('C', 'λογος'), tokens: [makeSuppliedToken('λογος')] },
		]);
		collateWitnesses();

		const readings = collationState.getReadingsForUnit(0);
		expect(readings.flatMap(reading => reading.witnessIds)).not.toContain('C');
		expect(collationState.getNonAttestationForUnit(0).witnessIds).toEqual(['C']);
	});

	it('keeps a damaged witness absent after its token is shifted out of the unit', () => {
		collationState.setWitnesses([
			makeWitness('A', 'λογος θεος', { isBaseText: true }),
			makeWitness('B', 'λογος θεος'),
			{ ...makeWitness('C', 'λογος θεος'), tokens: [makeGapToken(), makeGapToken()] },
		]);
		collateWitnesses();

		const columnId = collationState.alignmentColumns[0]?.id;
		expect(columnId).toBeTruthy();
		collationState.shiftToken(columnId!, 'C', 'right');

		// The shifted-from slot is empty but still damaged, so C attests nothing there — it must
		// never be reported as positively attesting an omission.
		expect(collationState.getNonAttestationForUnit(0).witnessIds).toContain('C');
		expect(
			collationState.getReadingsForUnit(0).flatMap(reading => reading.witnessIds)
		).not.toContain('C');
	});
});

describe('collationState reading types and certainty', () => {
	beforeEach(() => {
		collationState.reset();
	});

	function setUpUnit(cells: Record<string, ReturnType<typeof makeTextCell>>) {
		collationState.setWitnesses([
			makeWitness('A', 'alpha', { isBaseText: true }),
			...Object.keys(cells)
				.filter(id => id !== 'A')
				.map(id => makeWitness(id, 'other')),
		]);
		collationState.setAlignmentSnapshot({
			witnessOrder: Object.keys(cells),
			columns: [{ id: 'col-1', index: 0, merged: false, cells: Object.entries(cells) }],
		});
	}

	function makeUnclearToken(text: string): WitnessSourceToken {
		return {
			kind: 'text',
			original: text,
			segments: [{ text, hasUnclear: true, isPunctuation: false, isSupplied: false }],
			gap: null,
		};
	}

	function makeSuppliedToken(text: string): WitnessSourceToken {
		return {
			kind: 'text',
			original: text,
			segments: [{ text, hasUnclear: false, isPunctuation: false, isSupplied: true }],
			gap: null,
		};
	}

	function collateWitnesses() {
		collationState.refreshCollationInput();
		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});
		collationState.setAlignmentSnapshot(snapshot.snapshot);
	}

	it('reports back exactly the type it was given, for every value in the vocabulary', () => {
		setUpUnit({ A: makeTextCell('alpha'), B: makeTextCell('beta') });
		const beta = collationState.getReadingsForUnit(0).find(reading => reading.text === 'beta')!;
		const values = [
			...collationState
				.getReadingTypeVocabulary()
				.filter(type => type.selectable)
				.map(type => type.id),
			'itacism',
			null,
		];

		for (const value of values) {
			expect(collationState.setReadingType(0, beta.id, value)).toEqual({ ok: true });
			expect(
				collationState.getReadingsForUnit(0).find(reading => reading.id === beta.id)
					?.readingType
			).toBe(value);
		}
	});

	it('never touches reading text when the type changes', () => {
		setUpUnit({ A: makeTextCell('alpha'), B: makeTextCell('beta') });
		const beta = collationState.getReadingsForUnit(0).find(reading => reading.text === 'beta')!;

		for (const type of collationState.getReadingTypeVocabulary()) {
			collationState.setReadingType(0, beta.id, type.id);
			const after = collationState
				.getReadingsForUnit(0)
				.find(reading => reading.id === beta.id);
			expect(after?.text).toBe('beta');
			expect(after?.normalizedText).toBe('beta');
			expect(after?.isOmission).toBe(false);
			expect(after?.isLacuna).toBe(false);
		}
	});

	it('records certainty separately from the type and undoes each in one step', () => {
		setUpUnit({ A: makeTextCell('alpha'), B: makeTextCell('beta') });
		const beta = collationState.getReadingsForUnit(0).find(reading => reading.text === 'beta')!;

		collationState.setReadingType(0, beta.id, 'apparent');
		collationState.setReadingCertainty(0, beta.id, 'low');

		const decided = collationState
			.getReadingsForUnit(0)
			.find(reading => reading.id === beta.id);
		expect([decided?.readingType, decided?.certainty]).toEqual(['apparent', 'low']);

		collationState.undo();

		const afterUndo = collationState
			.getReadingsForUnit(0)
			.find(reading => reading.id === beta.id);
		expect([afterUndo?.readingType, afterUndo?.certainty]).toEqual(['apparent', null]);
	});

	it('keeps a recorded type through an unrelated edit to the same unit', () => {
		collationState.setWitnesses([
			makeWitness('A', 'alpha', { isBaseText: true }),
			makeWitness('B', 'beta'),
			makeWitness('C', 'gamma'),
		]);
		collateWitnesses();
		const initial = collationState.getReadingsForUnit(0);
		const beta = initial.find(reading => reading.text === 'beta')!;
		const gamma = initial.find(reading => reading.text === 'gamma')!;

		collationState.setReadingType(0, beta.id, 'apparent');
		collationState.setReadingCertainty(0, beta.id, 'low');
		collationState.updateReadingText(0, gamma.id, 'delta');
		collationState.setReadingParent(0, gamma.id, beta.id);

		const decided = collationState
			.getReadingsForUnit(0)
			.find(reading => reading.id === beta.id);
		expect([decided?.readingType, decided?.certainty]).toEqual(['apparent', 'low']);

		// Type and certainty are decisions, never part of the proposal underneath them: undoing
		// back past the attachment, the certainty, and the type must leave nothing behind.
		collationState.undo();
		collationState.undo();
		collationState.undo();

		const undone = collationState.getReadingsForUnit(0).find(reading => reading.id === beta.id);
		expect([undone?.readingType, undone?.certainty]).toEqual([null, null]);
	});

	it('refuses a type for a reading the unit does not hold', () => {
		setUpUnit({ A: makeTextCell('alpha'), B: makeTextCell('beta') });

		expect(collationState.setReadingType(0, 'missing', 'apparent')).toEqual({
			ok: false,
			error: 'reading-not-found',
		});
	});

	it('proposes a deficient type for a reading whose text is unclear', () => {
		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true }),
			{ ...makeWitness('B', 'λογος'), tokens: [makeUnclearToken('λογος')] },
		]);
		collateWitnesses();

		const readings = collationState.getReadingsForUnit(0);
		expect(readings.map(reading => [reading.witnessIds, reading.readingType])).toEqual([
			[['A'], null],
			[['B'], 'deficient'],
		]);
	});

	it('proposes a deficient type for a reading restored from supplied text', () => {
		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true }),
			{ ...makeWitness('B', 'λογος'), tokens: [makeSuppliedToken('λογος')] },
		]);
		collateWitnesses();

		const supplied = collationState
			.getReadingsForUnit(0)
			.find(reading => reading.witnessIds.includes('B'));
		expect(supplied?.readingType).toBe('deficient');
	});

	it('never proposes a deficient type for witnesses that read the text intact', () => {
		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true }),
			makeWitness('B', 'λογος'),
			{ ...makeWitness('C', 'λογος'), tokens: [makeSuppliedToken('λογος')] },
		]);
		collateWitnesses();

		const readings = collationState.getReadingsForUnit(0);
		const intact = readings.find(reading => reading.witnessIds.includes('A'));
		expect(intact?.witnessIds).toEqual(['A', 'B']);
		expect(intact?.readingType).toBe(null);
		expect(readings.find(reading => reading.witnessIds.includes('C'))?.readingType).toBe(
			'deficient'
		);
	});

	it('lets a recorded type outrank the proposal without discarding the evidence', () => {
		collationState.setWitnesses([
			makeWitness('A', 'λογος', { isBaseText: true }),
			{ ...makeWitness('B', 'λογος'), tokens: [makeUnclearToken('λογος')] },
		]);
		collateWitnesses();
		const proposed = collationState
			.getReadingsForUnit(0)
			.find(reading => reading.witnessIds.includes('B'))!;
		expect(proposed.readingType).toBe('deficient');

		collationState.setReadingType(0, proposed.id, 'nonsense');
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === proposed.id)
				?.readingType
		).toBe('nonsense');

		collationState.undo();
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === proposed.id)
				?.readingType
		).toBe('deficient');
	});

	it('records subreadings carrying no type as a review nudge rather than an error', () => {
		setUpUnit({
			A: makeTextCell('alpha'),
			B: makeTextCell('beta'),
			C: makeTextCell('gamma'),
		});
		const initial = collationState.getReadingsForUnit(0);
		const beta = initial.find(reading => reading.text === 'beta')!;
		const gamma = initial.find(reading => reading.text === 'gamma')!;

		collationState.setReadingParent(0, gamma.id, beta.id);

		expect(collationState.getSubreadingsMissingReadingType()).toEqual([
			{ unitIndex: 0, unitId: 'unit:col-1', readingIds: [gamma.id] },
		]);

		collationState.setReadingType(0, gamma.id, 'orthographic');
		expect(collationState.getSubreadingsMissingReadingType()).toEqual([]);
	});
});
