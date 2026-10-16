import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	deserializeAlignmentColumns,
	serializeAlignmentColumns,
	type AlignmentCell,
} from './alignment-snapshot';
import { collateToAlignmentSnapshot } from './collation-adapter';
import { collationState, type WitnessConfig } from './collation-state.svelte';
import {
	COLLATION_PHASES,
	type RegularizationRule,
	type WitnessSourceToken,
} from './collation-types';
import { alignmentCellFromTokens } from './alignment-cell';
import { buildCollationDocument, hydrateCollationDocument } from './collation-document';
import { buildApparatusTeiExportInput, exportApparatusTei } from './collation-tei';
import { buildCbgmInput } from '../cbgm/cbgm-input';
import * as collationRunner from './collation-runner';

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

describe('collationState progress', () => {
	beforeEach(() => {
		collationState.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each(COLLATION_PHASES)(
		'keeps %s and Review progress through witness refresh and addition',
		async phase => {
			collationState.setSegmentMember('Romans 1:1');
			collationState.setWitnesses([
				makeWitness('A', 'λογος', { isBaseText: true }),
				makeWitness('B', 'θεος'),
			]);
			collationState.setAlignmentSnapshot(
				collateToAlignmentSnapshot({
					witnesses: collationState.buildCollationWitnessInputs(),
				}).snapshot
			);
			collationState.setPhase('review');
			collationState.showPhase(phase);

			const gathered = vi.spyOn(collationRunner, 'gatherWitnessesForSegment');
			const refreshed = makeWitness('B', 'κυριος');
			gathered.mockResolvedValue({
				orphanedMembers: [],
				error: null,
				witnesses: [
					{
						...refreshed,
						id: 'B',
						transcriptionUid: 'B-tx',
						kind: 'firsthand',
						handId: 'firsthand',
						source: { kind: 'version', transcriptionId: 'B-tx', versionId: 'B-v2' },
					},
				],
			});

			expect(await collationState.refreshWitnessesFromSource(['B-tx'])).toBe(true);
			expect(
				collationState.witnesses.find(witness => witness.witnessId === 'B')?.content
			).toBe('κυριος');
			expect(collationState.phase).toBe(phase);
			expect(collationState.furthestPhase).toBe('review');

			const added = makeWitness('C', 'πνευμα');
			gathered.mockResolvedValue({
				orphanedMembers: [],
				error: null,
				witnesses: [
					{
						...added,
						id: 'C',
						transcriptionUid: 'C-tx',
						kind: 'firsthand',
						handId: 'firsthand',
						source: { kind: 'version', transcriptionId: 'C-tx', versionId: 'C-v1' },
					},
				],
			});

			expect(await collationState.refreshWitnessesFromSource(['C-tx'])).toBe(true);
			expect(collationState.witnesses.map(witness => witness.witnessId)).toEqual([
				'A',
				'B',
				'C',
			]);
			expect(collationState.phase).toBe(phase);
			expect(collationState.furthestPhase).toBe('review');
			expect(COLLATION_PHASES.every(target => collationState.canNavigateTo(target))).toBe(
				true
			);
		}
	);

	it('keeps every phase navigable after Review even when the alignment becomes empty', () => {
		collationState.setPhase('review');
		collationState.setAlignmentSnapshot({ witnessOrder: [], columns: [] });

		expect(collationState.furthestPhase).toBe('review');
		expect(COLLATION_PHASES.every(phase => collationState.canNavigateTo(phase))).toBe(true);
	});

	it('keeps Stemma gated when the furthest phase is Alignment', () => {
		collationState.setPhase('alignment');

		expect(collationState.canNavigateTo('setup')).toBe(true);
		expect(collationState.canNavigateTo('alignment')).toBe(true);
		expect(collationState.canNavigateTo('stemma')).toBe(false);
	});
});

describe('collationState stemma derivation', () => {
	beforeEach(() => {
		collationState.reset();
	});

	it('derives a valid unit selection after an alignment edit without a mounted view', () => {
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
		collationState.selectedUnitIndex = 2;
		collationState.mergeColumns(['col-2', 'col-3']);
		expect(collationState.selectedUnitIndex).toBe(0);
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
		expect(sub?.label).toBe('af');
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
			collationState.getReadingsForUnit(0).find(reading => reading.id === gamma.id)?.text
		).toBe('gamma');
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === beta.id)
				?.parentReadingId
		).toBe(alpha.id);

		collationState.undo();
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

	it('derives rule effects immediately and clears them when setup selections reset', async () => {
		collationState.setWitnesses([makeWitness('A', 'θς', { isBaseText: true })]);
		expect(collationState.regularizationRuleEffects).toEqual([]);
		collationState.addRule(makeRule());
		expect(collationState.regularizationRuleEffects).toEqual([
			expect.objectContaining({ ruleId: 'rule-1', witnessId: 'A' }),
		]);
		expect(collationState.regularizedTexts.get('A')?.[0]?.regularized).toBe('θεος');
		await collationState.clearProjectSelection();
		expect(collationState.regularizationRuleEffects).toEqual([]);
		expect(collationState.regularizedTexts.size).toBe(0);
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

		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});

		collationState.setAlignmentSnapshot(snapshot.snapshot);

		const initial = collationState.getReadingsForUnit(0);
		expect(initial).toHaveLength(1);
		expect(initial[0]?.witnessIds).toEqual(['A', 'B', 'C']);

		collationState.splitWitnessesIntoNewReading(0, ['C']);

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

	it('keeps the lemma decision through an unrelated edit and undoes each gesture in one step', () => {
		setUpUnit({ A: makeTextCell('alpha'), B: makeTextCell('beta'), C: makeTextCell('gamma') });
		const initial = collationState.getReadingsForUnit(0);
		const beta = initial.find(reading => reading.text === 'beta')!;
		const gamma = initial.find(reading => reading.text === 'gamma')!;

		collationState.setLemmaReading(0, beta.id);
		collationState.updateReadingText(0, gamma.id, 'delta');
		expect(collationState.getLemmaReadingId(0)).toBe(beta.id);

		collationState.undo();
		const afterTextUndo = collationState.getReadingsForUnit(0);
		expect(afterTextUndo.find(reading => reading.id === gamma.id)?.text).toBe('gamma');
		expect(collationState.getLemmaReadingId(0)).toBe(beta.id);

		collationState.undo();
		expect(collationState.getLemmaReadingId(0)).toBe(
			collationState.getReadingsForUnit(0).find(reading => reading.text === 'alpha')!.id
		);

		collationState.redo();
		collationState.redo();
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === gamma.id)?.text
		).toBe('delta');
		expect(collationState.getLemmaReadingId(0)).toBe(beta.id);
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
		collationState.setReadingSource(0, beta.id, { kind: 'derived', from: alpha.id });
		const before = structuredClone(collationState.readingArcs.get('unit:col-1'));
		expect(before).toHaveLength(1);

		collationState.setLemmaReading(0, beta.id);

		expect(collationState.readingArcs.get('unit:col-1')).toEqual(before);
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

		collationState.undo();
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

describe('collationState local stemma source decisions', () => {
	beforeEach(() => {
		collationState.reset();
	});

	function collateReadings(texts: Record<string, string>) {
		collationState.setWitnesses(
			Object.entries(texts).map(([witnessId, text], index) =>
				makeWitness(witnessId, text, { isBaseText: index === 0 })
			)
		);
		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});
		collationState.setAlignmentSnapshot(snapshot.snapshot);
		return collationState.getReadingsForUnit(0);
	}

	function labelled(label: string) {
		const reading = collationState.getReadingsForUnit(0).find(entry => entry.label === label);
		if (!reading) throw new Error(`no reading labelled ${label}`);
		return reading;
	}

	function arcsForUnit() {
		return [...collationState.readingArcs.values()].flat();
	}

	function sourceOf(readingId: string) {
		return collationState.getLocalStemma(0).nodes.find(node => node.readingId === readingId)
			?.sourceDecision;
	}

	it('records derived, unclear, and undecided as three distinguishable answers', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');

		expect(collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id })).toEqual({
			ok: true,
		});
		expect(collationState.setReadingSource(0, c.id, { kind: 'unclear' })).toEqual({ ok: true });

		expect(sourceOf(b.id)).toEqual({ kind: 'derived', from: a.id });
		expect(sourceOf(c.id)).toEqual({ kind: 'unclear' });
		expect(sourceOf(a.id)).toEqual({ kind: 'undecided' });

		expect(collationState.setReadingSource(0, c.id, { kind: 'undecided' })).toEqual({
			ok: true,
		});
		expect(sourceOf(c.id)).toEqual({ kind: 'undecided' });
	});

	it('replaces the previous source rather than recording a second one', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');

		collationState.setReadingSource(0, c.id, { kind: 'derived', from: a.id });
		collationState.setReadingSource(0, c.id, { kind: 'derived', from: b.id });

		expect(arcsForUnit()).toHaveLength(1);
		expect(sourceOf(c.id)).toEqual({ kind: 'derived', from: b.id });
		expect(collationState.getLocalStemma(0).violations).toEqual([]);
	});

	it('refuses a source that would close a cycle, and changes nothing', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');
		collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id });
		collationState.setReadingSource(0, c.id, { kind: 'derived', from: b.id });
		const before = structuredClone(arcsForUnit());
		expect(before).toHaveLength(2);

		expect(collationState.setReadingSource(0, a.id, { kind: 'derived', from: c.id })).toEqual({
			ok: false,
			error: 'cycle',
		});
		expect(collationState.setReadingSource(0, a.id, { kind: 'derived', from: a.id })).toEqual({
			ok: false,
			error: 'self-source',
		});
		expect(arcsForUnit()).toEqual(before);
	});

	it('refuses a subreading at either end, because subreadings hold no genealogy', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');
		collationState.setReadingParent(0, c.id, b.id);

		expect(collationState.setReadingSource(0, c.id, { kind: 'derived', from: a.id })).toEqual({
			ok: false,
			error: 'not-a-main-reading',
		});
		expect(collationState.setReadingSource(0, b.id, { kind: 'derived', from: c.id })).toEqual({
			ok: false,
			error: 'not-a-main-reading',
		});
	});

	it('undoes one source decision per gesture', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');
		collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id });
		collationState.setReadingSource(0, c.id, { kind: 'unclear' });

		collationState.undo();
		expect(sourceOf(c.id)).toEqual({ kind: 'undecided' });
		expect(sourceOf(b.id)).toEqual({ kind: 'derived', from: a.id });

		collationState.undo();
		expect(sourceOf(b.id)).toEqual({ kind: 'undecided' });

		collationState.redo();
		expect(sourceOf(b.id)).toEqual({ kind: 'derived', from: a.id });
	});

	it('keeps source decisions through an unrelated edit to the same unit', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'θεος', D: 'πνευμα' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');
		collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id });
		collationState.setReadingSource(0, c.id, { kind: 'unclear' });

		collationState.setReadingType(0, c.id, 'nonsense');
		collationState.setLemmaReading(0, b.id);
		collationState.splitWitnessesIntoNewReading(0, ['C']);

		expect(sourceOf(b.id)).toEqual({ kind: 'derived', from: a.id });
		expect(sourceOf(c.id)).toEqual({ kind: 'unclear' });
	});

	it('reports a derived decision whose prior reading the unit no longer has', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const b = labelled('b');
		const c = labelled('c');
		collationState.setReadingSource(0, b.id, { kind: 'derived', from: c.id });

		collationState.moveWitnessesToReading(0, ['C'], b.id);
		collationState.deleteReading(0, c.id);

		expect(collationState.getOrphanedDecisionsForUnit(0)).toEqual([
			{
				kind: 'sourceArc',
				readingId: b.id,
				priorReadingId: c.id,
				missingReadingIds: [c.id],
			},
		]);
	});

	it('reports the arcs of a unit that is no longer a variation unit', () => {
		collateReadings({ A: 'λογος θεος', B: 'λογος πνευμα' });
		const readings = collationState.getReadingsForUnit(1);
		const a = readings.find(reading => reading.label === 'a')!;
		const b = readings.find(reading => reading.label === 'b')!;
		collationState.setReadingSource(1, b.id, { kind: 'derived', from: a.id });
		const unitId = [...collationState.readingArcs.keys()][0];

		collationState.mergeColumns(collationState.alignmentColumns.map(column => column.id));

		expect(collationState.getOrphanedUnitDecisions()).toEqual([
			{
				unitId,
				decisions: {},
				arcs: [{ id: expect.any(String), priorReadingId: a.id, posteriorReadingId: b.id }],
			},
		]);
	});

	it('records nothing when a reading is set to the answer it already carries', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');
		collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id });

		expect(collationState.setReadingSource(0, c.id, { kind: 'undecided' })).toEqual({
			ok: true,
		});
		expect(collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id })).toEqual({
			ok: true,
		});
		expect([...collationState.unitDecisions.values()].some(entry => entry.sourceDecision)).toBe(
			false
		);
		expect(arcsForUnit()).toHaveLength(1);

		collationState.undo();
		expect(sourceOf(b.id)).toEqual({ kind: 'undecided' });
	});

	it('leaves an untouched unit out of the record entirely when nothing is decided', () => {
		collateReadings({ A: 'λογος', B: 'θεος' });
		const b = labelled('b');

		expect(collationState.setReadingSource(0, b.id, { kind: 'undecided' })).toEqual({
			ok: true,
		});

		expect(collationState.readingArcs.size).toBe(0);
		expect(collationState.unitDecisions.size).toBe(0);
	});

	it('roots a newly-built stemma on the lemma, never on the reading with most witnesses', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'θεος', D: 'θεος' });
		const stemma = collationState.getLocalStemma(0);

		expect(stemma.nodes.filter(node => node.isLemma).map(node => node.witnessIds)).toEqual([
			['A'],
		]);
		expect(stemma.nodes.map(node => node.sourceDecision)).toEqual([
			{ kind: 'undecided' },
			{ kind: 'undecided' },
		]);
		expect(arcsForUnit()).toEqual([]);
	});

	it('defaults connectivity to 10 and records numeric and absolute values as sparse undoable decisions', () => {
		collateReadings({ A: 'λογος', B: 'θεος' });
		const b = labelled('b');

		expect(collationState.getConnectivity(0)).toBe(10);
		expect(collationState.unitDecisions).toEqual(new Map());
		expect(collationState.setConnectivity(0, 0)).toEqual({
			ok: false,
			error: 'invalid-connectivity',
		});
		expect(collationState.setConnectivity(0, 1.5)).toEqual({
			ok: false,
			error: 'invalid-connectivity',
		});
		expect(collationState.setConnectivity(0, 3)).toEqual({ ok: true });
		expect(collationState.getConnectivity(0)).toBe(3);
		expect([...collationState.unitDecisions.values()]).toEqual([{ connectivity: 3 }]);
		expect(collationState.setConnectivity(0, 'absolute')).toEqual({ ok: true });
		expect(collationState.getConnectivity(0)).toBe('absolute');
		expect([...collationState.unitDecisions.values()]).toEqual([{ connectivity: 'absolute' }]);
		collationState.setReadingType(0, b.id, 'nonsense');
		expect(collationState.getConnectivity(0)).toBe('absolute');

		collationState.undo();
		expect(collationState.getConnectivity(0)).toBe('absolute');

		collationState.undo();
		expect(collationState.getConnectivity(0)).toBe(3);

		collationState.undo();
		expect(collationState.getConnectivity(0)).toBe(10);
		expect(collationState.unitDecisions).toEqual(new Map());
	});

	it('reports an accepted arc into an elevated lemma for the Review worklist', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');

		expect(collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id })).toEqual({
			ok: true,
		});
		const arcsBeforeElevation = structuredClone(arcsForUnit());
		expect(collationState.setLemmaReading(0, b.id)).toEqual({ ok: true });

		expect(arcsForUnit()).toEqual(arcsBeforeElevation);
		expect(collationState.getLocalStemma(0).violations).toEqual([
			{
				kind: 'lemma-is-posterior',
				readingId: b.id,
				priorReadingIds: [a.id],
			},
		]);
		expect(collationState.getStemmaViolations()).toEqual([
			{
				unitIndex: 0,
				unitId: expect.stringMatching(/^unit:/),
				violations: [
					{
						kind: 'lemma-is-posterior',
						readingId: b.id,
						priorReadingIds: [a.id],
					},
				],
			},
		]);
		expect(collationState.setReadingSource(0, c.id, { kind: 'derived', from: b.id })).toEqual({
			ok: true,
		});
	});

	it('reroots on the lemma by removing only its incoming arcs in one undoable action', () => {
		collateReadings({ A: 'λογος', B: 'θεος', C: 'πνευμα', D: 'χαρις' });
		const a = labelled('a');
		const b = labelled('b');
		const c = labelled('c');
		const d = labelled('d');
		collationState.setReadingSource(0, b.id, { kind: 'derived', from: a.id });
		collationState.setReadingSource(0, c.id, { kind: 'derived', from: b.id });
		collationState.setReadingSource(0, d.id, { kind: 'derived', from: a.id });
		collationState.setLemmaReading(0, b.id);
		const beforeReroot = structuredClone(arcsForUnit());

		expect(collationState.rerootStemmaOnLemma(0)).toEqual({ ok: true, removed: 1 });
		expect(arcsForUnit()).toEqual(beforeReroot.filter(arc => arc.posteriorReadingId !== b.id));

		collationState.undo();
		expect(arcsForUnit()).toEqual(beforeReroot);
	});
});

describe('collationState bulk witness partitioning', () => {
	beforeEach(() => {
		collationState.reset();
	});

	function collateUnit(witnesses: WitnessConfig[]) {
		collationState.setWitnesses(witnesses);
		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});
		collationState.setAlignmentSnapshot(snapshot.snapshot);
		return collationState.getReadingsForUnit(0);
	}

	function collateTexts(texts: Record<string, string>) {
		return collateUnit(
			Object.entries(texts).map(([witnessId, text], index) =>
				makeWitness(witnessId, text, { isBaseText: index === 0 })
			)
		);
	}

	function witnessesByLabel() {
		return Object.fromEntries(
			collationState
				.getReadingsForUnit(0)
				.map(reading => [reading.label, reading.witnessIds] as const)
		);
	}

	function labelled(label: string) {
		const reading = collationState.getReadingsForUnit(0).find(entry => entry.label === label);
		if (!reading) throw new Error(`no reading labelled ${label}`);
		return reading;
	}

	it('moves a selection spanning two readings to a third in one action and one undo step', () => {
		collateTexts({
			A: 'λογος',
			B: 'θεος',
			C: 'θεος',
			D: 'πνευμα',
			E: 'πνευμα',
			F: 'πνευμα',
		});
		const before = witnessesByLabel();
		const target = labelled('a');

		expect(collationState.moveWitnessesToReading(0, ['B', 'D', 'E'], target.id)).toEqual({
			ok: true,
			moved: 3,
			movedWitnessIds: ['B', 'D', 'E'],
		});

		expect(witnessesByLabel()).toMatchObject({ a: ['A', 'B', 'D', 'E'] });
		expect(
			collationState
				.getReadingsForUnit(0)
				.flatMap(reading => reading.witnessIds)
				.filter(witnessId => ['B', 'D', 'E'].includes(witnessId))
		).toEqual(['B', 'D', 'E']);

		collationState.undo();
		expect(witnessesByLabel()).toEqual(before);
	});

	it('refuses to move a witness that does not testify at the unit', () => {
		collateUnit([
			makeWitness('A', 'λογος', { isBaseText: true }),
			makeWitness('B', 'θεος'),
			{
				...makeWitness('C', 'λογος'),
				tokens: [
					{
						kind: 'gap',
						original: '⊘',
						segments: [],
						gap: { source: 'gap', reason: '', unit: '', extent: '' },
					},
				],
			},
		]);
		expect(collationState.getNonAttestationForUnit(0).witnessIds).toEqual(['C']);
		const before = witnessesByLabel();

		expect(collationState.moveWitnessesToReading(0, ['C'], labelled('a').id)).toEqual({
			ok: false,
			error: 'no-attesting-witnesses',
		});
		expect(witnessesByLabel()).toEqual(before);
	});

	it('splits a selection spanning two readings into one new reading', () => {
		collateTexts({ A: 'λογος', B: 'λογος', C: 'θεος', D: 'θεος' });
		const before = witnessesByLabel();

		const result = collationState.splitWitnessesIntoNewReading(0, ['B', 'C']);
		expect(result).toEqual({ ok: true, readingId: expect.any(String) });

		const split = collationState
			.getReadingsForUnit(0)
			.find(reading => result.ok && reading.id === result.readingId);
		expect(split?.witnessIds).toEqual(['B', 'C']);
		expect(witnessesByLabel()).toMatchObject({ a1: ['A'], a2: ['B', 'C'] });

		collationState.undo();
		expect(witnessesByLabel()).toEqual(before);
	});

	it('refuses a split that takes every witness of the only reading involved', () => {
		collateTexts({ A: 'λογος', B: 'λογος', C: 'θεος' });
		const before = witnessesByLabel();

		expect(collationState.splitWitnessesIntoNewReading(0, ['A', 'B'])).toEqual({
			ok: false,
			error: 'whole-reading',
		});
		expect(witnessesByLabel()).toEqual(before);
	});

	it('splits a selection into a subreading of a named main reading', () => {
		collateTexts({ A: 'λογος', B: 'λογος', C: 'θεος' });
		const main = labelled('b');

		const result = collationState.splitWitnessesIntoNewReading(0, ['B'], {
			subreadingOf: main.id,
		});
		expect(result).toEqual({ ok: true, readingId: expect.any(String) });

		const split = collationState
			.getReadingsForUnit(0)
			.find(reading => result.ok && reading.id === result.readingId);
		expect(split?.parentReadingId).toBe(main.id);
		expect(split?.label).toBe('b?');
		expect(split?.witnessIds).toEqual(['B']);
	});

	it('merges readings so the survivor holds the union of their witnesses, in one undo step', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'θεος', D: 'πνευμα' });
		const before = witnessesByLabel();
		const target = labelled('b');
		const other = labelled('c');

		expect(collationState.mergeReadings(0, [other.id], target.id)).toEqual({ ok: true });

		expect(collationState.getReadingsForUnit(0).map(reading => reading.witnessIds)).toEqual([
			['A'],
			['B', 'C', 'D'],
		]);

		collationState.undo();
		expect(witnessesByLabel()).toEqual(before);
	});

	it('takes a hand-attached subreading of a merged-away reading into the survivor', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'κυριος', D: 'πνευμα' });
		const target = labelled('b');
		const merged = labelled('c');
		const subreading = labelled('d');
		expect(collationState.setReadingParent(0, subreading.id, merged.id)).toEqual({ ok: true });

		expect(collationState.mergeReadings(0, [merged.id], target.id)).toEqual({ ok: true });

		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === subreading.id)
				?.parentReadingId
		).toBe(target.id);
		expect(
			collationState.getReadingFamiliesForUnit(0).find(family => family.id === target.id)
				?.children.length
		).toBe(1);
		expect(collationState.getOrphanedDecisionsForUnit(0)).toEqual([]);

		collationState.undo();
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === subreading.id)
				?.parentReadingId
		).toBe(merged.id);
	});

	it('drops a reading a move empties rather than leaving a lettered husk', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'θεος' });
		const target = labelled('a');

		expect(collationState.moveWitnessesToReading(0, ['B', 'C'], target.id)).toMatchObject({
			ok: true,
			moved: 2,
		});

		expect(witnessesByLabel()).toEqual({ a: ['A', 'B', 'C'] });

		collationState.undo();
		expect(witnessesByLabel()).toEqual({ a: ['A'], b: ['B', 'C'] });
	});

	it('drops every reading a split empties, not only the single-source case', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'θεος', D: 'πνευμα', E: 'πνευμα' });
		const before = witnessesByLabel();

		const result = collationState.splitWitnessesIntoNewReading(0, ['B', 'C', 'D', 'E']);
		expect(result).toEqual({ ok: true, readingId: expect.any(String) });

		expect(witnessesByLabel()).toEqual({ a: ['A'], b: ['B', 'C', 'D', 'E'] });

		collationState.undo();
		expect(witnessesByLabel()).toEqual(before);
	});

	it('keeps a reading a scholar added with no witnesses when a verb empties another', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'θεος' });
		const conjecture = collationState.addReading(0);

		expect(
			collationState.moveWitnessesToReading(0, ['B', 'C'], labelled('a').id)
		).toMatchObject({
			ok: true,
		});

		expect(
			collationState.getReadingsForUnit(0).some(reading => reading.id === conjecture)
		).toBe(true);
	});

	it('keeps an emptied main reading that still carries an attesting subreading', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const main = labelled('b');
		const subreading = labelled('c');
		collationState.setReadingParent(0, subreading.id, main.id);

		expect(collationState.moveWitnessesToReading(0, ['B'], labelled('a').id)).toMatchObject({
			ok: true,
		});

		const readings = collationState.getReadingsForUnit(0);
		expect(readings.find(reading => reading.id === main.id)?.witnessIds).toEqual([]);
		expect(readings.find(reading => reading.id === subreading.id)?.parentReadingId).toBe(
			main.id
		);
	});

	it('refuses to delete a reading whose subreading still holds witnesses', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const main = labelled('b');
		const subreading = labelled('c');
		collationState.setReadingParent(0, subreading.id, main.id);
		collationState.moveWitnessesToReading(0, ['B'], labelled('a').id);

		expect(collationState.getAttestingWitnessIdsForReading(0, main.id)).toEqual(['C']);
		collationState.deleteReading(0, main.id);
		expect(collationState.getReadingsForUnit(0).some(reading => reading.id === main.id)).toBe(
			true
		);
	});

	it('refuses to merge a reading into its own subreading', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const main = labelled('b');
		const other = labelled('c');
		collationState.setReadingParent(0, other.id, main.id);
		const before = witnessesByLabel();

		expect(collationState.mergeReadings(0, [main.id], other.id)).toEqual({
			ok: false,
			error: 'target-under-source',
		});
		expect(witnessesByLabel()).toEqual(before);
	});

	it('gives every proposal edit its own undo entry, so no gesture is invisible to the history', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'πνευμα' });
		const b = labelled('b');
		const c = labelled('c');

		collationState.updateReadingText(0, c.id, 'δελτα');
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === c.id)?.text
		).toBe('δελτα');
		collationState.undo();
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === c.id)?.text
		).toBe('πνευμα');
		collationState.redo();
		expect(
			collationState.getReadingsForUnit(0).find(reading => reading.id === c.id)?.text
		).toBe('δελτα');

		const added = collationState.addReading(0);
		collationState.undo();
		expect(collationState.getReadingsForUnit(0).some(reading => reading.id === added)).toBe(
			false
		);

		collationState.deleteReading(0, collationState.addReading(0));
		collationState.undo();
		expect(collationState.getReadingsForUnit(0).length).toBe(4);

		expect(collationState.moveReadingByOffset(0, c.id, -1)).toEqual({ ok: true });
		expect(collationState.getReadingsForUnit(0).findIndex(reading => reading.id === c.id)).toBe(
			1
		);
		collationState.undo();
		expect(collationState.getReadingsForUnit(0).findIndex(reading => reading.id === b.id)).toBe(
			1
		);
	});

	it('undoes a proposal edit in one unit without reverting work in another', () => {
		collateUnit([
			makeWitness('A', 'λογος αλφα', { isBaseText: true }),
			makeWitness('B', 'θεος βητα'),
			makeWitness('C', 'θεος γαμμα'),
		]);
		const [first, second] = collationState.getVariationUnitSpans().map(span => span.startIndex);
		expect(second).toBeGreaterThan(first);

		const target = collationState
			.getReadingsForUnit(first)
			.find(reading => reading.label === 'a')!;
		expect(collationState.moveWitnessesToReading(first, ['B'], target.id)).toMatchObject({
			ok: true,
			moved: 1,
		});
		const movedWitnessIds = collationState
			.getReadingsForUnit(first)
			.map(reading => reading.witnessIds);

		const edited = collationState
			.getReadingsForUnit(second)
			.find(reading => reading.label === 'b')!;
		collationState.updateReadingText(second, edited.id, 'δελτα');

		collationState.undo();
		expect(
			collationState.getReadingsForUnit(second).find(reading => reading.id === edited.id)
				?.text
		).not.toBe('δελτα');
		expect(collationState.getReadingsForUnit(first).map(reading => reading.witnessIds)).toEqual(
			movedWitnessIds
		);

		collationState.redo();
		expect(
			collationState.getReadingsForUnit(second).find(reading => reading.id === edited.id)
				?.text
		).toBe('δελτα');
	});

	it('counts a subreading of a subreading as part of its main reading family', () => {
		collateTexts({ A: 'λογος', B: 'θεος', C: 'πνευμα', D: 'κυριος' });
		const main = labelled('b');
		const middle = labelled('c');
		const deepest = labelled('d');
		collationState.setReadingParent(0, middle.id, main.id);
		collationState.setReadingParent(0, deepest.id, middle.id);

		const family = collationState
			.getReadingFamiliesForUnit(0)
			.find(entry => entry.id === main.id);
		expect(family?.members.map(member => member.id)).toEqual([main.id, middle.id, deepest.id]);
	});
});

describe('collationState witness placement', () => {
	beforeEach(() => collationState.reset());
	afterEach(() => vi.restoreAllMocks());

	function setup(texts: Record<string, string>) {
		collationState.setSegmentMember('Romans 1:1');
		collationState.setSegmentName('Romans 1:1');
		const witnesses = Object.entries(texts).map(([id, text], index) =>
			makeWitness(id, text, { isBaseText: index === 0 })
		);
		collationState.setWitnesses(witnesses);
		const words = Object.values(texts).map(text => text.split(' '));
		const inputs = collationState.buildCollationWitnessInputs();
		collationState.setAlignmentSnapshot({
			witnessOrder: Object.keys(texts),
			columns: words[0].map((_, index) => ({
				id: `column-${index}`,
				index,
				merged: false,
				cells: Object.keys(texts).map((id, row) => [
					id,
					alignmentCellFromTokens(inputs[row].tokens!.slice(index, index + 1)),
				]),
			})),
		});
	}

	async function refresh(texts: Record<string, string>) {
		vi.spyOn(collationRunner, 'gatherWitnessesForSegment').mockResolvedValue({
			error: null,
			orphanedMembers: [],
			witnesses: Object.entries(texts).map(([id, content]) => ({
				...makeWitness(id, content),
				id,
				transcriptionUid: `${id}-tx`,
				kind: 'firsthand',
				handId: 'firsthand',
				source: { kind: 'version', transcriptionId: `${id}-tx`, versionId: `${id}-v2` },
			})),
		});
		expect(
			await collationState.refreshWitnessesFromSource(
				Object.keys(texts).map(id => `${id}-tx`)
			)
		).toBe(true);
	}

	function document() {
		return buildCollationDocument({
			collationId: 'placement',
			projectId: null,
			projectName: null,
			phase: collationState.phase,
			furthestPhase: collationState.furthestPhase,
			segment: collationState.segment!,
			witnesses: collationState.witnesses,
			rules: collationState.rules,
			ignoreWordBreaks: collationState.ignoreWordBreaks,
			lowercase: collationState.lowercase,
			ignoreTokenWhitespace: collationState.ignoreTokenWhitespace,
			ignorePunctuation: collationState.ignorePunctuation,
			suppliedTextMode: collationState.suppliedTextMode,
			segmentation: collationState.segmentation,
			alignmentColumns: collationState.alignmentColumns,
			declaredUnits: collationState.declaredUnits,
			witnessOrder: collationState.witnessOrder,
			classifiedReadings: collationState.classifiedReadings,
			unitDecisions: collationState.unitDecisions,
			readingArcs: collationState.readingArcs,
			alignmentDisplayMode: collationState.alignmentDisplayMode,
			alignmentLayout: collationState.alignmentLayout,
		});
	}

	it('keeps manual testimony through placement, recognized re-alignment, and document round trips, without changing CBGM', async () => {
		setup({ A: 'one alpha two', B: 'one beta two' });
		const settings = {
			minExtantUnits: null,
			minExtantProportion: null,
			excludedWitnesses: [],
			classicRules: false,
			mergeSplitReadings: false,
			droppedReadingTypes: [],
			includedCorrectors: [],
		};
		const baseline = buildCbgmInput([document()], settings);
		const main = collationState.peekReadingsForUnit(1)[0];
		await collationState.attachManualWitness(1, main.id, 'Father');
		const authoredId = collationState.addAuthoredReading(1, 'gamma')!;
		await collationState.attachManualWitness(1, authoredId, 'Version');
		const manual = collationState.getManualWitnesses();
		expect(
			manual.map(witness => [witness.siglum, witness.treatment, witness.includeInCbgm])
		).toEqual([
			['Father', 'fragmentary', false],
			['Version', 'fragmentary', false],
		]);
		const saved = document();
		expect(saved.apparatus!.units[0].readings.some(reading => reading.id === authoredId)).toBe(
			false
		);
		expect(
			saved.apparatus!.units[0].readings.every(
				reading =>
					reading.manualWitnessIds === undefined &&
					reading.witnessIds.every(id => !manual.some(witness => witness.id === id))
			)
		).toBe(true);
		expect(buildCbgmInput([saved], settings)).toEqual(baseline);
		expect(
			buildApparatusTeiExportInput(saved, [], [], manual)
				.units.get('unit:column-1')!
				.view.readings.find(reading => reading.id === authoredId)?.manualWitnessIds
		).toEqual([manual[1].id]);
		await refresh({ A: 'one alpha two', B: 'one beta two', C: 'one delta two' });
		expect(
			collationState.peekReadingsForUnit(1).find(reading => reading.id === authoredId)?.label
		).toBe('c');
		expect(
			collationState.peekReadingsForUnit(1).find(reading => reading.witnessIds.includes('C'))
				?.label
		).toBe('d');
		expect(
			collationState.peekUnitView(1).readings.find(reading => reading.id === main.id)
				?.manualWitnessIds
		).toEqual([manual[0].id]);
		collationState.setAlignmentSnapshot(
			collateToAlignmentSnapshot({
				witnesses: collationState.buildCollationWitnessInputs({
					forceSourceWitnesses: true,
				}),
				options: { segmentation: false },
			}).snapshot
		);
		expect(
			collationState.peekUnitView(1).readings.find(reading => reading.id === authoredId)
				?.manualWitnessIds
		).toEqual([manual[1].id]);
		expect(
			collationState.getLocalStemma(1).nodes.some(node => node.readingId === authoredId)
		).toBe(true);
	});

	it('records a manual omission on agreed text and stays quiet at unattached units', async () => {
		setup({ A: 'one alpha', B: 'one beta' });
		collationState.declareUnit(['column-0']);
		const id = collationState.addAuthoredReading(0, '', true)!;
		await collationState.attachManualWitness(0, id, 'Syriac');
		const witnessId = collationState.getManualWitnesses()[0].id;
		expect(
			collationState.peekUnitView(0).readings.find(reading => reading.id === id)
		).toMatchObject({ label: 'b', isOmission: true, manualWitnessIds: [witnessId] });
		expect(
			collationState
				.peekUnitView(1)
				.readings.every(reading => reading.manualWitnessIds?.length === 0)
		).toBe(true);
		const exported = exportApparatusTei(
			buildApparatusTeiExportInput(document(), [], [], collationState.getManualWitnesses())
		);
		expect(exported).toContain('n="Syriac"');
		expect(exported).toContain('type="om"');
	});

	it('places a matching witness into an authored reading under the same id', async () => {
		setup({ A: 'one alpha two', B: 'one beta two' });
		collationState.addRule(makeRule({ pattern: 'θς', replacement: 'θεος' }));
		const id = collationState.addAuthoredReading(1, 'θς')!;
		await collationState.attachManualWitness(1, id, 'Father');
		const manualId = collationState.getManualWitnesses()[0].id;
		await refresh({ A: 'one alpha two', B: 'one beta two', C: 'one θεος two' });
		expect(
			collationState.classifiedReadings
				.get('unit:column-1')!
				.find(reading => reading.id === id)?.witnessIds
		).toEqual(['C']);
		expect(
			collationState.peekUnitView(1).readings.find(reading => reading.id === id)
				?.manualWitnessIds
		).toEqual([manualId]);
		expect(collationState.unitDecisions.get('unit:column-1')?.authoredReadings).toEqual([]);
		expect(collationState.peekUnitView(1).unconfirmedWitnessIds).toContain('C');
	});

	it('holds a witness out when several authored readings match', async () => {
		setup({ A: 'one alpha two', B: 'one beta two' });
		const ids = [
			collationState.addAuthoredReading(1, 'gamma')!,
			collationState.addAuthoredReading(1, 'gamma')!,
		];
		await refresh({ A: 'one alpha two', B: 'one beta two', C: 'one gamma two' });
		expect(collationState.peekUnitView(1).unresolvedAttestations).toEqual([
			{ witnessId: 'C', candidateReadingIds: ids },
		]);
		expect(
			collationState
				.peekUnitView(1)
				.readings.every(reading => !reading.witnessIds.includes('C'))
		).toBe(true);
		expect(collationState.resolveAttestation(1, 'C', ids[0])).toEqual({ ok: true });
		expect(
			collationState.classifiedReadings
				.get('unit:column-1')!
				.find(reading => reading.id === ids[0])?.witnessIds
		).toEqual(['C']);
		expect(
			collationState.unitDecisions
				.get('unit:column-1')
				?.authoredReadings?.map(reading => reading.id)
		).toEqual([ids[1]]);
		collationState.undo();
		expect(collationState.peekUnitView(1).unresolvedAttestations).toEqual([
			{ witnessId: 'C', candidateReadingIds: ids },
		]);
	});

	it('orders and attaches authored readings through existing decisions and removes only their last testimony', async () => {
		setup({ A: 'one alpha two', B: 'one beta two' });
		const id = collationState.addAuthoredReading(1, 'gamma')!;
		await collationState.attachManualWitness(1, id, 'Father');
		await collationState.attachManualWitness(1, id, 'Version');
		collationState.moveReadingByOffset(1, id, -1);
		expect(
			collationState
				.peekReadingsForUnit(1)
				.map(reading => reading.id)
				.indexOf(id)
		).toBe(1);
		expect(collationState.unitDecisions.get('unit:column-1')?.authoredReadings?.[0].order).toBe(
			1
		);
		const main = collationState.peekReadingsForUnit(1)[0];
		collationState.setReadingParent(1, id, main.id, 'orthographic');
		expect(
			collationState.peekReadingsForUnit(1).find(reading => reading.id === id)
		).toMatchObject({ parentReadingId: main.id, readingType: 'orthographic' });
		expect(
			collationState.unitDecisions.get('unit:column-1')?.authoredReadings?.[0]
		).toMatchObject({ parentReadingId: null, readingType: null });
		collationState.detachManualWitness(1, collationState.getManualWitnesses()[0].id);
		expect(collationState.peekReadingsForUnit(1).some(reading => reading.id === id)).toBe(true);
		collationState.detachManualWitness(1, collationState.getManualWitnesses()[1].id);
		expect(collationState.peekReadingsForUnit(1).some(reading => reading.id === id)).toBe(
			false
		);
		collationState.undo();
		expect(
			collationState.peekReadingsForUnit(1).find(reading => reading.id === id)
				?.manualWitnessIds
		).toEqual([collationState.getManualWitnesses()[1].id]);
	});

	function reviewView(unitIndex: number) {
		const view = collationState.peekUnitView(unitIndex);
		return {
			...view,
			readings: view.readings.map(reading => ({
				...reading,
				witnessGroups: reading.witnessGroups.map(group => group.witnessIds),
			})),
		};
	}

	it('declares without merging, refuses overlaps, and removes declarations with undo', () => {
		setup({ A: 'same words end', B: 'same words other' });
		const before = serializeAlignmentColumns(collationState.alignmentColumns);
		expect(collationState.declareUnit(['column-0', 'column-2'])).toBe(false);
		expect(collationState.declareUnit(['column-1', 'column-2'])).toBe(false);
		expect(collationState.declareUnit(['missing'])).toBe(false);
		expect(collationState.declareUnit(['column-2'])).toBe(true);
		expect(collationState.declaredUnits).toEqual([]);
		expect(collationState.declareUnit(['column-0', 'column-1'])).toBe(true);
		expect(collationState.declareUnit(['column-1'])).toBe(false);
		expect(serializeAlignmentColumns(collationState.alignmentColumns)).toEqual(before);
		expect(collationState.getVariationUnitSpans()[0].unitId).toBe('unit:column-0..column-1');
		expect(collationState.peekReadingsForUnit(0)[0].text).toBe('same words');
		const cbgm = buildCbgmInput([document()], {
			minExtantUnits: null,
			minExtantProportion: null,
			excludedWitnesses: [],
			classicRules: false,
			mergeSplitReadings: false,
			droppedReadingTypes: [],
			includedCorrectors: [],
		});
		expect(cbgm.tei).toContain('same words');
		expect(cbgm.tei?.match(/<app /g)).toHaveLength(2);
		expect(hydrateCollationDocument(document()).declaredUnits).toEqual(
			collationState.declaredUnits
		);
		expect(
			buildApparatusTeiExportInput(document())
				.segments.filter(segment => segment.kind === 'unit')
				.map(segment => segment.span.unitId)
		).toEqual(['unit:column-0..column-1', 'unit:column-2']);
		collationState.undo();
		expect(collationState.declaredUnits).toEqual([]);
		collationState.redo();
		collationState.removeDeclaredUnit('unit:column-0..column-1');
		expect(collationState.declaredUnits).toEqual([]);
		collationState.undo();
		expect(collationState.declaredUnits).toHaveLength(1);
	});

	it('keeps declared endpoints and decisions when placement inserts inside the run', async () => {
		setup({ A: 'same words end', B: 'same words other' });
		collationState.declareUnit(['column-0', 'column-1']);
		const reading = collationState.getReadingsForUnit(0)[0];
		collationState.setReadingType(0, reading.id, 'nonsense');
		collationState.setConnectivity(0, 3);
		await refresh({ N: 'same extra words end' });
		const span = collationState.getVariationUnitSpans()[0];
		expect(span.unitId).toBe('unit:column-0..column-1');
		expect(span.columnIds).toHaveLength(3);
		expect(collationState.getConnectivity(0)).toBe(3);
		expect(
			collationState.peekReadingsForUnit(0).find(item => item.id === reading.id)?.readingType
		).toBe('nonsense');
		expect(
			collationState.peekReadingsForUnit(0).find(item => item.text === 'same extra words')
				?.witnessIds
		).toEqual(['N']);
	});

	it.each(['both', 'first', 'last'] as const)(
		'retains a declaration only when both ends are recognized: %s',
		recognized => {
			setup({ A: 'same words end', B: 'same words other' });
			collationState.declareUnit(['column-0', 'column-1']);
			collationState.getReadingsForUnit(0);
			collationState.setConnectivity(0, 3);
			const columns = serializeAlignmentColumns(collationState.alignmentColumns).map(
				(column, index) => ({ ...column, id: `new-${index}` })
			);
			if (recognized !== 'both') {
				const index = recognized === 'first' ? 1 : 0;
				columns[index].cells = columns[index].cells.map(([id, cell]) => [
					id,
					{ ...cell, sourceTokenIds: [`changed-${id}`] },
				]);
			}
			collationState.setAlignmentSnapshot({ witnessOrder: ['A', 'B'], columns });
			expect(collationState.declaredUnits).toHaveLength(recognized === 'both' ? 1 : 0);
			if (recognized === 'both') {
				expect(collationState.getVariationUnitSpans()[0].unitId).toBe(
					'unit:column-0..column-1'
				);
				expect(collationState.getConnectivity(0)).toBe(3);
			} else {
				expect(collationState.getOrphanedUnitDecisions()).toContainEqual({
					unitId: 'unit:column-0..column-1',
					decisions: { connectivity: 3 },
				});
			}
		}
	);

	it('confirms every attestation at one unit in one undo entry', async () => {
		setup({ A: 'alpha first', B: 'beta second' });
		await refresh({ N: 'alpha first', M: 'beta second' });
		const before = reviewView(0);
		const other = reviewView(1);
		expect(before.unconfirmedWitnessIds).toEqual(['N', 'M']);
		collationState.confirmUnitAttestations(0);
		expect(collationState.peekUnitView(0).unconfirmedWitnessIds).toEqual([]);
		expect(reviewView(1)).toEqual(other);
		collationState.undo();
		expect(reviewView(0)).toEqual(before);
		collationState.redo();
		expect(collationState.peekUnitView(0).unconfirmedWitnessIds).toEqual([]);
	});

	it('resolves held-out testimony into any existing reading and undoes both changes', async () => {
		setup({ A: 'alpha', B: 'beta', C: 'beta', D: 'gamma' });
		const beta = collationState.getReadingsForUnit(0).find(reading => reading.text === 'beta')!;
		collationState.splitWitnessesIntoNewReading(0, ['C']);
		await refresh({ N: 'beta' });
		const before = reviewView(0);
		expect(before.unresolvedAttestations).toHaveLength(1);
		expect(before.readings.flatMap(reading => reading.witnessIds)).not.toContain('N');
		expect(collationState.resolveAttestation(0, 'N', 'missing')).toEqual({
			ok: false,
			error: 'reading-not-found',
		});
		expect(reviewView(0)).toEqual(before);
		const gamma = before.readings.find(reading => reading.text === 'gamma')!;
		expect(collationState.resolveAttestation(0, 'N', gamma.id)).toEqual({ ok: true });
		expect(collationState.peekUnitView(0).unresolvedAttestations).toEqual([]);
		expect(
			collationState.classifiedReadings
				.get('unit:column-0')!
				.find(reading => reading.id === gamma.id)?.witnessIds
		).toEqual(['D', 'N']);
		collationState.undo();
		expect(reviewView(0)).toEqual(before);
		expect(collationState.resolveAttestation(0, 'N', beta.id)).toEqual({ ok: true });
		expect(
			collationState.peekUnitView(0).readings.find(reading => reading.id === beta.id)
				?.witnessIds
		).toEqual(['B', 'N']);
		collationState.undo();
		expect(reviewView(0)).toEqual(before);
		collationState.redo();
		expect(collationState.peekUnitView(0).unresolvedAttestations).toEqual([]);
	});

	it('keeps moves, splits, merges, attachments, types, lemma, arcs and connectivity', async () => {
		setup({ A: 'alpha', B: 'beta', C: 'beta', D: 'gamma', E: 'delta', F: 'epsilon' });
		const readings = collationState.getReadingsForUnit(0);
		const id = (text: string) => readings.find(reading => reading.text === text)!.id;
		expect(collationState.moveWitnessesToReading(0, ['C'], id('gamma')).ok).toBe(true);
		expect(collationState.splitWitnessesIntoNewReading(0, ['D']).ok).toBe(true);
		expect(collationState.mergeReadings(0, [id('epsilon')], id('delta')).ok).toBe(true);
		expect(collationState.setReadingParent(0, id('beta'), id('delta')).ok).toBe(true);
		expect(collationState.setReadingType(0, id('beta'), 'orthographic').ok).toBe(true);
		expect(collationState.setLemmaReading(0, id('delta')).ok).toBe(true);
		expect(collationState.setConnectivity(0, 3).ok).toBe(true);
		expect(
			collationState.setReadingSource(0, id('alpha'), { kind: 'derived', from: id('delta') })
				.ok
		).toBe(true);
		const before = document();
		const beforeView = collationState
			.peekReadingsForUnit(0)
			.map(reading => ({ ...reading, witnessGroups: [] }));
		const beforeColumns = collationState.alignmentColumns.map(column => ({
			id: column.id,
			cells: new Map(column.cells),
		}));
		await refresh({ N: 'alpha' });
		const after = document();
		expect(after.alignment!.columns.map(column => column.id)).toEqual(
			before.alignment!.columns.map(column => column.id)
		);
		for (const column of beforeColumns) {
			for (const [id, cell] of column.cells)
				expect(
					collationState.alignmentColumns
						.find(current => current.id === column.id)!
						.cells.get(id)
				).toEqual(cell);
		}
		expect(after.stemma).toEqual(before.stemma);
		expect(
			hydrateCollationDocument(after).classifiedReadings[0][1].map(reading => ({
				id: reading.id,
				witnessIds: reading.witnessIds,
			}))
		).toEqual(
			collationState
				.peekReadingsForUnit(0)
				.map(reading => ({ id: reading.id, witnessIds: reading.witnessIds }))
		);
		const beforeReadings = collationState.peekReadingsForUnit(0).map(reading => ({
			...reading,
			witnessIds: reading.witnessIds.filter(id => id !== 'N'),
			witnessGroups: [],
		}));
		expect(beforeReadings).toEqual(beforeView);
		expect(collationState.peekUnitView(0).unconfirmedWitnessIds).toEqual(['N']);
		expect(collationState.peekUnitView(0).unresolvedAttestations).toEqual([]);
		expect(collationState.getLemmaReadingId(0)).toBe(id('delta'));
	});

	it('gives a new source a unique id when gathered siglum ids collide', async () => {
		setup({ A: 'alpha', B: 'beta' });
		collationState.getReadingsForUnit(0);
		const incoming = makeWitness('N', 'beta');
		vi.spyOn(collationRunner, 'gatherWitnessesForSegment').mockResolvedValue({
			error: null,
			orphanedMembers: [],
			witnesses: [
				{
					...incoming,
					id: 'B',
					transcriptionUid: 'N-tx',
					kind: 'firsthand',
					handId: 'firsthand',
					source: { kind: 'version', transcriptionId: 'N-tx', versionId: 'N-v1' },
				},
			],
		});
		expect(await collationState.refreshWitnessesFromSource(['N-tx'])).toBe(true);
		const added = collationState.witnesses.find(witness => witness.transcriptionId === 'N-tx')!;
		expect(added.witnessId).not.toBe('B');
		expect(new Set(collationState.witnesses.map(witness => witness.witnessId)).size).toBe(3);
		expect(
			collationState.peekReadingsForUnit(0).find(reading => reading.witnessIds.includes('B'))
				?.witnessIds
		).toEqual(['B', added.witnessId]);
		expect(collationState.peekUnitView(0).unconfirmedWitnessIds).toEqual([added.witnessId]);
	});

	it('keeps hand-merged columns and regularization rules through placement', async () => {
		collationState.addRule(makeRule({ pattern: 'beta', replacement: 'alpha' }));
		setup({ A: 'alpha one two', B: 'beta one two' });
		collationState.mergeColumns(['column-1', 'column-2']);
		const before = collationState.alignmentColumns.map(column => ({
			...column,
			cells: new Map(column.cells),
		}));
		const rules = collationState.rules;
		await refresh({ N: 'alpha one two' });
		expect(collationState.alignmentColumns.map(column => column.id)).toEqual(
			before.map(column => column.id)
		);
		for (const column of before) {
			const placed = collationState.alignmentColumns.find(
				current => current.id === column.id
			)!;
			expect(placed.merged).toBe(column.merged);
			for (const [id, cell] of column.cells) expect(placed.cells.get(id)).toEqual(cell);
		}
		expect(collationState.rules).toEqual(rules);
		expect(collationState.alignmentColumns[1].cells.get('N')?.text).toBe('one two');
	});

	it('holds split matches out and assigns matching subreadings and novel main readings', async () => {
		setup({ A: 'alpha end', B: 'beta end', C: 'beta end', D: 'gamma end' });
		const main = collationState
			.getReadingsForUnit(0)
			.find(reading => reading.text === 'alpha')!;
		const beta = collationState.getReadingsForUnit(0).find(reading => reading.text === 'beta')!;
		expect(collationState.splitWitnessesIntoNewReading(0, ['C']).ok).toBe(true);
		const gamma = collationState
			.getReadingsForUnit(0)
			.find(reading => reading.text === 'gamma')!;
		expect(collationState.setReadingParent(0, gamma.id, main.id).ok).toBe(true);
		await refresh({ N: 'beta different', S: 'gamma end', T: 'theta end' });
		const view = collationState.peekUnitView(0);
		expect(view.readings.some(reading => reading.witnessIds.includes('N'))).toBe(false);
		expect(view.unresolvedAttestations).toEqual([
			{
				witnessId: 'N',
				candidateReadingIds: expect.arrayContaining([beta.id, expect.any(String)]),
			},
		]);
		expect(view.readings.find(reading => reading.id === gamma.id)).toMatchObject({
			witnessIds: ['D', 'S'],
			parentReadingId: main.id,
		});
		const novel = view.readings.find(reading => reading.witnessIds.includes('T'))!;
		expect(novel).toMatchObject({ text: 'theta', label: 'c', parentReadingId: null });
		expect(
			collationState.getLocalStemma(0).nodes.find(node => node.readingId === novel.id)
				?.sourceDecision
		).toEqual({ kind: 'undecided' });
		expect(view.unconfirmedWitnessIds).toEqual(['S', 'T']);
	});

	it.each(['new', 'refreshed'] as const)(
		'inherits a twin source’s cells, split, subreading and ambiguous testimony when %s',
		async mode => {
			collationState.addRule(makeRule({ pattern: 'theta', replacement: 'beta' }));
			setup({
				A: 'alpha other omega finish',
				B: 'beta start psi end',
				C: 'beta start psi end',
				...(mode === 'refreshed' ? { N: 'old other omega finish' } : {}),
			});
			const columns = collationState.alignmentColumns;
			collationState.setAlignmentSnapshot({
				witnessOrder: collationState.witnessOrder,
				columns: serializeAlignmentColumns(columns).map((column, index) => ({
					...column,
					cells: column.cells.map(([id, cell]) => [
						id,
						index < 2 && ['B', 'C'].includes(id)
							? columns[1 - index].cells.get(id)!
							: cell,
					]),
				})),
			});
			collationState.getReadingsForUnit(0);
			expect(collationState.splitWitnessesIntoNewReading(0, ['B']).ok).toBe(true);
			const split = collationState
				.peekReadingsForUnit(0)
				.find(r => r.witnessIds.includes('B'))!;
			const second = collationState.getReadingsForUnit(1);
			const subreading = second.find(r => r.witnessIds.includes('B'))!;
			expect(collationState.setReadingParent(1, subreading.id, second[0].id).ok).toBe(true);
			const third = collationState.getReadingsForUnit(2);
			expect(
				collationState.recordAmbiguousAttestation(
					2,
					['B'],
					third.map(r => r.id)
				).ok
			).toBe(true);
			const beforeColumns = collationState.alignmentColumns.map(column => ({
				...column,
				cells: new Map([...column.cells].filter(([id]) => id !== 'N')),
			}));
			const storedKeys = [...collationState.classifiedReadings.keys()];
			await refresh({ N: 'theta start psi end' });
			expect(
				collationState.alignmentColumns.map(column => ({
					...column,
					cells: new Map([...column.cells].filter(([id]) => id !== 'N')),
				}))
			).toEqual(beforeColumns);
			const tokens = collationState
				.buildCollationWitnessInputs({ forceSourceWitnesses: true })
				.find(input => input.id === 'N')!.tokens!;
			for (const [index, column] of collationState.alignmentColumns.entries()) {
				expect(column.cells.get('N')).toEqual(
					alignmentCellFromTokens([tokens[index < 2 ? 1 - index : index]])
				);
				expect(collationState.peekUnitView(index).unconfirmedWitnessIds).toEqual(['N']);
				expect(collationState.peekUnitView(index).unresolvedAttestations).toEqual([]);
			}
			expect(
				collationState.peekReadingsForUnit(0).find(r => r.id === split.id)?.witnessIds
			).toEqual(['B', 'N']);
			expect(
				collationState.peekReadingsForUnit(1).find(r => r.id === subreading.id)
			).toMatchObject({ witnessIds: ['B', 'C', 'N'], parentReadingId: second[0].id });
			expect(collationState.peekUnitView(2).ambiguousAttestations[0].witnessIds).toEqual([
				'B',
				'N',
			]);
			expect([...collationState.classifiedReadings.keys()]).toEqual(storedKeys);
			expect(
				collationState.peekReadingsForUnit(3).find(r => r.witnessIds.includes('B'))
					?.witnessIds
			).toEqual(['B', 'C', 'N']);
		}
	);

	it('copies omission, gap and untranscribed cells without inserting columns', async () => {
		setup({ A: 'alpha one', B: 'beta two' });
		const columns = collationState.alignmentColumns;
		const kinds = ['omission', 'gap', 'untranscribed'] as const;
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				...serializeAlignmentColumns(columns),
				...kinds.map((kind, index) => ({
					id: `absence-${kind}`,
					index: columns.length + index,
					merged: false,
					cells: [
						['A', alignmentCellFromTokens([{ t: 'extra', n: 'extra' }])],
						[
							'B',
							{
								...alignmentCellFromTokens([]),
								kind,
								isOmission: kind === 'omission',
								isLacuna: kind !== 'omission',
							},
						],
					] as Array<[string, AlignmentCell]>,
				})),
			],
		});
		await refresh({ N: 'beta two' });
		expect(collationState.alignmentColumns).toHaveLength(5);
		for (const [index, kind] of kinds.entries()) {
			expect(collationState.alignmentColumns[index + 2].cells.get('N')).toEqual(
				collationState.alignmentColumns[index + 2].cells.get('B')
			);
			expect(
				collationState.unitDecisions.get(`unit:absence-${kind}`)?.unconfirmedWitnessIds ??
					[]
			).toEqual(kind === 'omission' ? ['N'] : []);
		}
	});

	it('keeps lazy readings lazy, opens new units unmarked and places a batch in order', async () => {
		setup({ A: 'alpha end', B: 'beta end' });
		await refresh({ N: 'theta new end', M: 'theta new end' });
		expect(collationState.classifiedReadings.size).toBe(0);
		expect(collationState.witnessOrder).toEqual(['A', 'B', 'N', 'M']);
		expect(collationState.alignmentColumns).toHaveLength(3);
		const first = collationState.alignmentColumns.findIndex(column => column.id === 'column-0');
		expect(collationState.peekUnitView(first).unconfirmedWitnessIds).toEqual(['N', 'M']);
		const inserted = collationState.alignmentColumns.findIndex(
			column => !['column-0', 'column-1'].includes(column.id)
		);
		expect(collationState.peekUnitView(inserted).unconfirmedWitnessIds).toEqual(['M']);
		expect(collationState.alignmentColumns[inserted].cells.get('M')?.text).toBe(
			collationState.alignmentColumns[inserted].cells.get('N')?.text
		);
		expect(collationState.alignmentColumns[inserted].cells.get('A')?.kind).toBe('omission');
	});

	it('leaves newly varying existing columns and inserted columns unmarked', async () => {
		setup({ A: 'alpha end', B: 'alpha end' });
		await refresh({ N: 'beta extra end' });
		expect(
			collationState.getSegmentSequence().filter(segment => segment.kind === 'unit')
		).toHaveLength(2);
		for (const segment of collationState.getSegmentSequence()) {
			if (segment.kind !== 'unit') continue;
			const view = collationState.peekUnitView(segment.span.startIndex);
			expect(view.unconfirmedWitnessIds).toEqual([]);
			expect(view.unresolvedAttestations).toEqual([]);
			expect(view.readings.some(reading => reading.witnessIds.includes('N'))).toBe(true);
		}
	});

	it.each(['gap', 'untranscribed'] as const)(
		'does not assign or mark %s testimony',
		async kind => {
			setup({ A: 'alpha', B: 'beta' });
			collationState.getReadingsForUnit(0);
			const incoming = makeWitness('N', '⊘');
			incoming.tokens = [
				{
					kind,
					original: '⊘',
					segments: [],
					gap: { source: kind, reason: '', unit: '', extent: '' },
				},
			];
			vi.spyOn(collationRunner, 'gatherWitnessesForSegment').mockResolvedValue({
				error: null,
				orphanedMembers: [],
				witnesses: [
					{
						...incoming,
						id: 'N',
						transcriptionUid: 'N-tx',
						kind: 'firsthand',
						handId: 'firsthand',
						source: { kind: 'version', transcriptionId: 'N-tx', versionId: 'N-v1' },
					},
				],
			});
			expect(await collationState.refreshWitnessesFromSource(['N-tx'])).toBe(true);
			const view = collationState.peekUnitView(0);
			expect(view.readings.some(reading => reading.witnessIds.includes('N'))).toBe(false);
			expect(view.unconfirmedWitnessIds).toEqual([]);
			expect(view.unresolvedAttestations).toEqual([]);
		}
	);

	it('marks only the changed reading on refresh and keeps other rows untouched', async () => {
		setup({ A: 'alpha start omega', B: 'beta start psi', C: 'beta start psi' });
		collationState.getReadingsForUnit(0);
		collationState.getReadingsForUnit(2);
		const before = collationState.alignmentColumns.map(column => ({
			id: column.id,
			cell: column.cells.get('A'),
		}));
		await refresh({ B: 'gamma start psi' });
		expect(collationState.peekUnitView(0).unconfirmedWitnessIds).toEqual(['B']);
		expect(collationState.peekUnitView(2).unconfirmedWitnessIds).toEqual([]);
		expect(
			collationState.alignmentColumns.map(column => ({
				id: column.id,
				cell: column.cells.get('A'),
			}))
		).toEqual(before);
	});

	it('re-aligns from source tokens, keeping recognized editorial work and orphaning the rest', () => {
		setup({ A: 'alpha start omega', B: 'beta middle psi' });
		collationState.setSegmentation(false);
		const readings = collationState.getReadingsForUnit(0);
		const beta = readings.find(reading => reading.text === 'beta')!;
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		collationState.updateReadingText(0, beta.id, 'edited beta');
		collationState.setReadingType(0, beta.id, 'nonsense');
		collationState.setLemmaReading(0, beta.id);
		collationState.setReadingSource(0, alpha.id, { kind: 'derived', from: beta.id });
		collationState.setConnectivity(0, 3);
		collationState.setConnectivity(1, 5);
		collationState.setConnectivity(2, 'absolute');
		const before = reviewView(0);
		const decisions = new Map(collationState.unitDecisions);
		const arcs = new Map(collationState.readingArcs);
		collationState.mergeColumns(['column-1', 'column-2']);
		collationState.setPhase('review');
		collationState.showPhase('stemma');
		collationState.setAlignmentSnapshot(
			collateToAlignmentSnapshot({
				witnesses: collationState.buildCollationWitnessInputs({
					forceSourceWitnesses: true,
				}),
				options: { segmentation: false },
			}).snapshot
		);
		expect(collationState.alignmentColumns).toHaveLength(3);
		expect(collationState.alignmentColumns[0].id).toBe('column-0');
		expect(reviewView(0)).toEqual(before);
		expect(collationState.unitDecisions).toEqual(decisions);
		expect(collationState.readingArcs).toEqual(arcs);
		expect([...collationState.classifiedReadings.keys()]).toEqual(['unit:column-0']);
		expect(collationState.getOrphanedUnitDecisions().map(orphan => orphan.unitId)).toEqual([
			'unit:column-1',
			'unit:column-2',
		]);
		expect(collationState.phase).toBe('stemma');
		expect(collationState.furthestPhase).toBe('review');
	});

	it.each(['remove', 'refresh removal', 'exclude'] as const)(
		'%s drops only its row and empty columns, orphaning units that stop varying',
		async action => {
			setup({ A: 'alpha same end', B: 'beta same end', C: 'alpha extra end' });
			const columns = serializeAlignmentColumns(collationState.alignmentColumns);
			columns[2].cells = columns[2].cells.map(([id, cell]) => [
				id,
				id === 'C' ? cell : makeOmissionCell(),
			]);
			collationState.setAlignmentSnapshot({ witnessOrder: ['A', 'B', 'C'], columns });
			collationState.getReadingsForUnit(0);
			collationState.setConnectivity(1, 3);
			collationState.setPhase('review');
			collationState.showPhase('readings');
			const before = collationState.alignmentColumns.slice(0, 2).map(column => ({
				...column,
				cells: new Map([...column.cells].filter(([id]) => id !== 'C')),
			}));
			const removedUnitId = `unit:${collationState.alignmentColumns[1].id}`;
			if (action === 'exclude') collationState.toggleWitnessExclusion('C');
			else if (action === 'remove') {
				collationState.setWitnesses(
					collationState.witnesses.filter(w => w.witnessId !== 'C')
				);
			} else {
				vi.spyOn(collationRunner, 'gatherWitnessesForSegment').mockResolvedValue({
					error: null,
					orphanedMembers: [],
					witnesses: [],
				});
				await collationState.refreshWitnessesFromSource(['C-tx']);
			}
			expect(collationState.alignmentColumns).toEqual(before);
			expect(collationState.witnessOrder).toEqual(['A', 'B']);
			expect(collationState.getOrphanedUnitDecisions()).toContainEqual({
				unitId: removedUnitId,
				decisions: { connectivity: 3 },
			});
			expect(
				collationState.peekReadingsForUnit(0).flatMap(reading => reading.witnessIds)
			).not.toContain('C');
			expect(collationState.phase).toBe('readings');
			expect(collationState.furthestPhase).toBe('review');
			if (action === 'exclude') {
				collationState.toggleWitnessExclusion('C');
				expect(
					collationState.alignmentColumns
						.map(column => column.id)
						.filter(id => before.some(column => column.id === id))
				).toEqual(before.map(column => column.id));
				expect(collationState.alignmentColumns.every(column => column.cells.has('C'))).toBe(
					true
				);
				expect(collationState.peekUnitView(0).unconfirmedWitnessIds).toContain('C');
			}
		}
	);

	it.each(['new witnesses only', 'existing tokens changed'] as const)(
		'handles a segment member change with %s',
		mode => {
			setup({ A: 'alpha start', B: 'beta end' });
			collationState.setSegmentation(false);
			collationState.mergeColumns(['column-0', 'column-1']);
			const mergedId = collationState.alignmentColumns[0].id;
			collationState.setConnectivity(0, 3);
			collationState.setPhase('review');
			collationState.showPhase('setup');
			collationState.setSegmentMembers(['Romans 1:1', 'Rom.1.1']);
			collationState.setWitnesses(
				[
					...(mode === 'new witnesses only'
						? collationState.witnesses
						: [
								makeWitness('A', 'alpha changed', { isBaseText: true }),
								makeWitness('B', 'beta changed'),
							]),
					makeWitness('N', 'beta end'),
				],
				{ segmentChanged: true }
			);
			if (mode === 'new witnesses only') {
				expect(collationState.alignmentColumns[0].id).toBe(mergedId);
				expect(collationState.alignmentColumns[0].merged).toBe(true);
				expect(collationState.getConnectivity(0)).toBe(3);
			} else {
				expect(collationState.alignmentColumns.every(column => !column.merged)).toBe(true);
				expect(collationState.alignmentColumns.some(column => column.id === mergedId)).toBe(
					false
				);
				expect(collationState.getOrphanedUnitDecisions()).toContainEqual({
					unitId: `unit:${mergedId}`,
					decisions: { connectivity: 3 },
				});
			}
			expect(collationState.phase).toBe('setup');
			expect(collationState.furthestPhase).toBe('review');
		}
	);

	it('re-aligns when ignore-word-breaks changes and leaves regularization changes deferred', async () => {
		setup({ A: 'alpha start end', B: 'beta middle finish' });
		collationState.setSegmentation(false);
		collationState.setConnectivity(0, 3);
		collationState.mergeColumns(['column-1', 'column-2']);
		const mergedId = collationState.alignmentColumns[1].id;
		collationState.setConnectivity(1, 5);
		const beforeRules = serializeAlignmentColumns(collationState.alignmentColumns);
		collationState.addRule(makeRule({ pattern: 'absent', replacement: 'other' }));
		expect(serializeAlignmentColumns(collationState.alignmentColumns)).toEqual(beforeRules);
		vi.spyOn(collationRunner, 'gatherWitnessesForSegment').mockResolvedValue({
			error: null,
			orphanedMembers: [],
			witnesses: collationState.witnesses.map(witness => ({
				...witness,
				source: {
					kind: 'version',
					transcriptionId: witness.transcriptionId,
					versionId: 'v1',
				},
				id: witness.witnessId,
				transcriptionUid: witness.transcriptionId,
				kind: 'firsthand',
				handId: 'firsthand',
			})),
		});
		collationState.setPhase('review');
		await collationState.setIgnoreWordBreaks(true);
		expect(collationState.alignmentColumns).toHaveLength(3);
		expect(collationState.alignmentColumns[0].id).toBe('column-0');
		expect(collationState.getConnectivity(0)).toBe(3);
		expect(collationState.getOrphanedUnitDecisions()).toContainEqual({
			unitId: `unit:${mergedId}`,
			decisions: { connectivity: 5 },
		});
		expect(collationState.phase).toBe('review');
		expect(collationState.furthestPhase).toBe('review');
	});

	it('leaves export and CBGM input identical with unconfirmed marks', async () => {
		setup({ A: 'alpha', B: 'beta' });
		await refresh({ N: 'beta' });
		const marked = document();
		const unmarked = structuredClone(marked);
		for (const unit of unmarked.apparatus!.units) delete unit.decisions?.unconfirmedWitnessIds;
		expect(exportApparatusTei(buildApparatusTeiExportInput(marked))).toBe(
			exportApparatusTei(buildApparatusTeiExportInput(unmarked))
		);
		const settings = {
			minExtantUnits: null,
			minExtantProportion: null,
			excludedWitnesses: [],
			classicRules: false,
			mergeSplitReadings: false,
			droppedReadingTypes: [],
			includedCorrectors: [],
		};
		expect(buildCbgmInput([marked], settings)).toEqual(buildCbgmInput([unmarked], settings));
	});
});
