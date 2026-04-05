import { beforeEach, describe, expect, it } from 'vitest';
import { deserializeAlignmentColumns } from './alignment-snapshot';
import { collateToAlignmentSnapshot } from './collation-adapter';
import { collationState, type WitnessConfig } from './collation-state.svelte';
import type {
	RegularizationRule,
	WitnessSourceToken,
} from './collation-types';

function makeTokens(content: string): WitnessSourceToken[] {
	return content.split(/\s+/).filter(Boolean).map((token) => ({
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
	>,
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

function makeSourceToken(
	text: string,
	options?: { isPunctuation?: boolean },
): WitnessSourceToken {
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
						[
							'A',
							makeTextCell('και εγενετο'),
						],
						[
							'B',
							makeTextCell('και εγενετο'),
						],
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
						[
							'A',
							makeTextCell('και'),
						],
						[
							'B',
							makeTextCell('και'),
						],
					],
				},
				{
					id: 'col-2',
					index: 1,
					merged: false,
					cells: [
						[
							'A',
							makeTextCell('λογος'),
						],
						[
							'B',
							makeTextCell('λογος'),
						],
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

		const initialColumnIds = collationState.alignmentColumns.map((column) => column.id);

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

		const initialColumnIds = collationState.alignmentColumns.map((column) => column.id);

		collationState.shiftToken('col-2', 'A', 'right');
		const shiftedColumnIds = collationState.alignmentColumns.map((column) => column.id);
		expect(collationState.alignmentColumns.map((column) => column.cells.get('A')?.text)).toEqual([
			'και',
			'λογος',
		]);
		expect(shiftedColumnIds[1]).not.toBe(initialColumnIds[1]);

		collationState.undo();
		expect(collationState.alignmentColumns.map((column) => column.id)).toEqual(initialColumnIds);
		expect(collationState.alignmentColumns.map((column) => column.cells.get('A')?.text)).toEqual([
			'και',
			'λογος',
		]);
		expect(collationState.alignmentColumns).toHaveLength(2);
		expect(collationState.alignmentColumns[1]?.cells.get('B')?.isOmission).toBe(true);

		collationState.redo();
		expect(collationState.alignmentColumns.map((column) => column.cells.get('A')?.text)).toEqual([
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
						[
							'A',
							makeTextCell('και λογος'),
						],
						[
							'B',
							makeTextCell('και ρημα'),
						],
					],
				},
			],
		});

		const inputs = collationState.buildCollationWitnessInputs();
		expect(inputs[0]?.tokens).toHaveLength(2);
		expect(inputs[0]?.tokens?.map((token) => token.t)).toEqual(['και', 'λογος']);
		expect(inputs[1]?.tokens?.map((token) => token.t)).toEqual(['και', 'ρημα']);
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
		expect(inputs[0]?.tokens?.map((token) => token.t)).toEqual(['και', 'λογος', 'ον', 'the', 'mat']);
		expect(inputs[1]?.tokens?.map((token) => token.t)).toEqual(['και', 'ρημα', 'ον', 'the', 'mat']);
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
			{ ...makeWitness('A-c1', 'θς', { kind: 'corrector', handId: 'corrector1' }), transcriptionId: 'A-tx' },
		]);

		expect(collationState.isProjectTranscriptionHandIncluded('A-tx', 'corrector1')).toBe(false);
		expect(collationState.witnesses.map((witness) => witness.witnessId)).toEqual(['A']);
	});

	it('creates an ns subreading for a regularized match to the base reading', () => {
		collationState.setWitnesses([
			makeWitness('A', 'θεος', { isBaseText: true }),
			makeWitness('B', 'θς'),
		]);
		collationState.addRule(makeRule());
		collationState.applyRegularization();

		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});

		collationState.setAlignmentSnapshot(snapshot.snapshot);

		const readings = collationState.getReadingsForUnit(0);
		expect(readings).toHaveLength(2);

		const base = readings.find((reading) => reading.text === 'θεος');
		const sub = readings.find((reading) => reading.text === 'θς');

		expect(base?.label).toBe('a');
		expect(sub?.label).toBe('a1');
		expect(sub?.readingType).toBe('ns');
		expect(sub?.parentReadingId).toBe(base?.id);
		expect(sub?.isSubreading).toBe(true);
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
		const parent = readings.find((reading) => reading.text === 'beta');
		const alpha = readings.find((reading) => reading.text === 'alpha');
		const gamma = readings.find((reading) => reading.text === 'gamma');

		expect(parent?.label).toBe('a');
		expect(parent?.parentReadingId).toBeNull();
		expect(parent?.isSubreading).toBe(false);
		expect(alpha?.parentReadingId).toBe(parent?.id);
		expect(alpha?.readingType).toBe('ns');
		expect(gamma?.parentReadingId).toBe(parent?.id);
		expect(gamma?.readingType).toBe('ns');
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
									{ text: 'θεος', hasUnclear: false, isPunctuation: false, isSupplied: false },
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
									{ text: 'θς', hasUnclear: false, isPunctuation: false, isSupplied: false },
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
									{ text: 'θεοσ', hasUnclear: false, isPunctuation: false, isSupplied: false },
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
		expect(nextParent?.readingType).toBeNull();
		expect(previousParent?.parentReadingId).toBe(nextParent?.id);
		expect(previousParent?.readingType).toBe('ns');
		expect(sibling?.parentReadingId).toBe(nextParent?.id);
		expect(sibling?.readingType).toBe('ns');
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
									{ text: 'κλη', hasUnclear: false, isPunctuation: false, isSupplied: false },
									{ text: 'τος', hasUnclear: false, isPunctuation: false, isSupplied: false },
								],
							},
						],
						[
							'B',
							{
								...makeTextCell('κλητος'),
								originalSegments: [
									{ text: 'κλητος', hasUnclear: false, isPunctuation: false, isSupplied: false },
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
									{ text: 'θεος', hasUnclear: false, isPunctuation: false, isSupplied: false },
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
									{ text: 'θς', hasUnclear: false, isPunctuation: false, isSupplied: false },
								],
							},
						],
					],
				},
			],
		});

		const parent = collationState
			.getReadingFamiliesForUnit(0)[0]?.parent;

		expect(parent).toBeTruthy();
		expect(
			collationState.getDisplayedWitnessIdsForReading(0, parent!.id, 'regularized')
		).toEqual(['A', 'B']);
		expect(
			collationState.getDisplayedWitnessIdsForReading(0, parent!.id, 'original')
		).toEqual(['A']);
	});

	it('can lowercase alignment text while preserving original token text', () => {
		collationState.setWitnesses([
			makeWitness('A', 'ΘΕΟΣ', { isBaseText: true }),
			makeWitness('B', 'θεος'),
		]);

		collationState.setLowercase(true);
		collationState.applyRegularization();

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

		expect(inputs[0]?.tokens?.map((token) => token.t)).toEqual(['λογος', ',', 'θεος']);
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

		expect(inputs[0]?.tokens?.map((token) => token.t)).toEqual(['λογος,', 'θεος']);
		expect(inputs[0]?.tokens?.map((token) => token.n)).toEqual(['λογος', 'θεος']);
		expect(inputs[0]?.tokens?.[0]?.sourceTokenIds).toEqual([
			'A::source::0',
			'A::source::1',
		]);
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

		collationState.applyRegularization();

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

		collationState.applyRegularization();

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
		collationState.applyRegularization();

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
		expect(updated.map((reading) => reading.witnessIds)).toEqual([['A', 'B'], ['C']]);
	});
});
