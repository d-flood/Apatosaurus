import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDecisions, applyOverlapDecisions, manualWitnessMembers } from './collation-decisions';
import { findBaseTextWitnessId, serializeCollationDocument } from './collation-document';
import { buildReadingProposal } from './collation-reading-proposal';
import { collationState } from './collation-state.svelte';
import { projectLocalStemma } from './collation-stemma';
import type { RegularizationRule } from './collation-types';
import { buildVariationUnitSpans, type VariationUnitSpan } from './collation-variation-units';
import { resolveReadingTypeVocabulary } from './reading-types';
import {
	generatedFixture,
	stateLoadFixtures,
	type Fixture,
} from './__fixtures__/collation-fixtures';
import * as db from '$lib/db/client';

vi.mock('$lib/db/client', { spy: true });

function makeRule(overrides: Partial<RegularizationRule>): RegularizationRule {
	return {
		id: 'rule-1',
		pattern: 'θς',
		replacement: 'θεος',
		scope: 'verse',
		description: '',
		enabled: true,
		type: 'none',
		...overrides,
	};
}

describe('collationState cached unit views', () => {
	beforeEach(() => collationState.reset());
	afterEach(async () => {
		await collationState.flushPendingSave();
		collationState.reset();
	});

	async function load({ document, vocab }: Fixture) {
		vi.mocked(db.loadCollation).mockResolvedValue({
			row: { projectId: 'project', notes: '' },
			artifact: { id: 'artifact', payload: serializeCollationDocument(document) },
		} as never);
		vi.mocked(db.getProject).mockResolvedValue({
			id: 'project',
			name: 'Project',
			collationSettings: {
				manualWitnesses: vocab.manualWitnesses ?? [],
				readingTags: vocab.readingTags ?? [],
				readingTypes: vocab.readingTypes ?? [],
			},
		} as never);
		vi.mocked(db.getProjectTranscriptionIds).mockResolvedValue([]);
		vi.mocked(db.getVerseIndexRowsForVerse).mockResolvedValue([]);
		vi.mocked(db.getCollationVersionStatus).mockResolvedValue(null as never);
		vi.mocked(db.saveCollationArtifact).mockResolvedValue({
			artifactId: 'artifact',
			versionStatus: null,
		} as never);
		vi.mocked(db.updateProjectMetadata).mockResolvedValue(undefined as never);
		expect(await collationState.loadCollationById(document.meta.collationId ?? 'c')).toBe(true);
		return resolveReadingTypeVocabulary(vocab.readingTypes ?? []);
	}

	function orderedActiveWitnessIds(): string[] {
		const active = collationState.witnesses.filter(witness => !witness.isExcluded);
		const activeIds = new Set(active.map(witness => witness.witnessId));
		const baseId =
			active.find(witness => witness.isBaseText)?.witnessId ?? active[0]?.witnessId;
		return [
			...new Set([
				...(baseId ? [baseId] : []),
				...collationState.witnessOrder,
				...collationState.witnesses.map(witness => witness.witnessId),
			]),
		].filter(id => activeIds.has(id));
	}

	function freshViews(vocabulary: ReturnType<typeof resolveReadingTypeVocabulary>) {
		const state = collationState;
		const spans = buildVariationUnitSpans(state.alignmentColumns, state.declaredUnits);
		const baseWitnessId = findBaseTextWitnessId(state.witnesses);
		const manualWitnesses = state.getManualWitnesses();
		const options = {
			baseWitnessId,
			vocabulary,
			manualWitnesses: manualWitnessMembers(
				manualWitnesses,
				manualWitnesses.map(witness => state.getManualWitnessOverride(witness.id)),
				state.unitDecisions.values()
			),
		};
		const ordered = orderedActiveWitnessIds();
		const proposalOf = (span: VariationUnitSpan) => {
			const columns = state.alignmentColumns.slice(span.startIndex, span.endIndex + 1);
			return buildReadingProposal({
				columns,
				spanColumnIds: span.columnIds,
				sourceWitnessIds:
					ordered.length > 0
						? ordered
						: [...new Set(columns.flatMap(column => [...column.cells.keys()]))],
				baseWitnessId,
			});
		};
		const viewWithoutOverlaps = (span: VariationUnitSpan) =>
			applyDecisions(
				state.classifiedReadings.get(span.unitId) ?? proposalOf(span).readings,
				state.unitDecisions.get(span.unitId) ?? {},
				options
			);
		const sources = spans
			.filter(span => state.unitDecisions.get(span.unitId)?.spanningReadingIds?.length)
			.map(span => ({
				span,
				decisions: state.unitDecisions.get(span.unitId) ?? {},
				view: viewWithoutOverlaps(span),
			}));
		return spans.map(span => {
			const decisions = state.unitDecisions.get(span.unitId) ?? {};
			const view = applyOverlapDecisions(viewWithoutOverlaps(span), decisions, span, sources);
			const overlaps = new Set(Object.keys(view.overlapTargets));
			const { nonAttestation } = proposalOf(span);
			return {
				unitId: span.unitId,
				view,
				nonAttestation: {
					witnessIds: [
						...nonAttestation.witnessIds.filter(id => !overlaps.has(id)),
						...view.nonAttestingManualWitnessIds,
					],
					untranscribedWitnessIds: nonAttestation.untranscribedWitnessIds.filter(
						id => !overlaps.has(id)
					),
				},
				stemma: projectLocalStemma(
					view.readings,
					state.readingArcs.get(span.unitId) ?? [],
					view.lemmaReadingId,
					decisions.sourceDecision ?? {}
				),
			};
		});
	}

	function expectCachedViewsFresh(
		vocabulary: ReturnType<typeof resolveReadingTypeVocabulary>,
		step: string
	) {
		const fresh = freshViews(vocabulary);
		const cached = fresh.map(({ unitId }) => ({
			unitId,
			view: collationState.peekUnitView(unitId),
			nonAttestation: collationState.getNonAttestationForUnit(unitId),
			stemma: collationState.getLocalStemma(unitId),
		}));
		expect(withoutGroupIds(cached), step).toEqual(withoutGroupIds(fresh));
		expect(collationState.getStemmaViolations(), step).toEqual(
			fresh
				.filter(entry => entry.stemma.violations.length > 0)
				.map(entry => ({ unitId: entry.unitId, violations: entry.stemma.violations }))
		);
	}

	// Proposals mint random witness-group ids on every build.
	function withoutGroupIds(value: unknown): unknown {
		return JSON.parse(
			JSON.stringify(value, (key, entry) =>
				key === 'witnessGroups'
					? (entry as Array<{ id: string }>).map(({ id: _, ...group }) => group)
					: entry
			)
		);
	}

	function unitWithReadings() {
		for (const span of collationState.getVariationUnitSpans()) {
			const readings = collationState
				.peekReadingsForUnit(span.unitId)
				.filter(reading => reading.witnessIds.length > 0)
				.sort(
					(a, b) =>
						Number(a.parentReadingId !== null) - Number(b.parentReadingId !== null)
				);
			if (readings.length >= 2)
				return { unitId: span.unitId, first: readings[0], second: readings[1] };
		}
		return null;
	}

	function withReadings(
		act: (unit: NonNullable<ReturnType<typeof unitWithReadings>>) => void
	): () => void {
		return () => {
			const unit = unitWithReadings();
			if (unit) act(unit);
		};
	}

	const actions: Array<[string, () => void]> = [
		[
			'reading type',
			withReadings(({ unitId, second }) =>
				collationState.setReadingType(unitId, second.id, 'orthographic')
			),
		],
		[
			'subreading attach',
			withReadings(({ unitId, first, second }) =>
				collationState.setReadingParent(unitId, second.id, first.id)
			),
		],
		[
			'subreading detach',
			withReadings(({ unitId }) => {
				const child = collationState
					.peekReadingsForUnit(unitId)
					.find(reading => reading.parentReadingId !== null);
				if (child) collationState.setReadingParent(unitId, child.id, null);
			}),
		],
		[
			'lemma elevation',
			withReadings(({ unitId, first, second }) =>
				collationState.setLemmaReading(
					unitId,
					second.parentReadingId === null ? second.id : first.id
				)
			),
		],
		[
			'split reading',
			withReadings(({ unitId, first }) =>
				collationState.splitWitnessesIntoNewReading(unitId, first.witnessIds.slice(0, 1))
			),
		],
		[
			'merge readings',
			withReadings(({ unitId, first, second }) =>
				collationState.mergeReadings(unitId, [second.id], first.id)
			),
		],
		[
			'source decision',
			withReadings(({ unitId, first, second }) =>
				collationState.setReadingSource(unitId, second.id, {
					kind: 'derived',
					from: first.id,
				})
			),
		],
		[
			'ambiguous attestation',
			withReadings(({ unitId, first, second }) =>
				collationState.recordAmbiguousAttestation(unitId, first.witnessIds.slice(-1), [
					first.id,
					second.id,
				])
			),
		],
		[
			'manual testimony',
			withReadings(({ unitId }) => {
				for (const witness of collationState.getManualWitnessMembers())
					collationState.setManualWitnessTestimony(unitId, witness.id, 'nonAttestation');
				for (const [key, decisions] of collationState.unitDecisions)
					for (const id of Object.keys(decisions.manualTestimony ?? {}))
						collationState.detachManualWitness(key, id);
			}),
		],
		[
			'manual witness treatment',
			() => {
				for (const witness of collationState.getManualWitnesses())
					collationState.updateManualWitness(witness.id, { treatment: 'full' });
			},
		],
		[
			'spanning reading',
			() => {
				const span = collationState
					.getVariationUnitSpans()
					.find(span => collationState.canMarkSpanning(span.unitId));
				const reading = span && collationState.peekReadingsForUnit(span.unitId)[0];
				if (span && reading)
					collationState.setReadingSpanning(span.unitId, reading.id, true);
			},
		],
		[
			'column merge',
			() => {
				const [left, right] = collationState.alignmentColumns;
				if (left && right) collationState.mergeColumns([left.id, right.id]);
			},
		],
		[
			'column split',
			() => {
				const column = collationState.alignmentColumns.find(column =>
					collationState.canSplitColumn(column.id)
				);
				if (column) collationState.splitColumn(column.id);
			},
		],
		[
			'shift token',
			() => {
				for (const column of collationState.alignmentColumns)
					for (const witnessId of column.cells.keys())
						for (const direction of ['left', 'right'] as const)
							if (collationState.canShiftToken(column.id, witnessId, direction)) {
								collationState.shiftToken(column.id, witnessId, direction);
								return;
							}
			},
		],
		[
			'merge cells',
			() => {
				for (const span of collationState.getVariationUnitSpans())
					collationState.primeReadingsForUnit(span.unitId);
				const columns = collationState.alignmentColumns;
				for (const [index, left] of columns.entries()) {
					const right = columns[index + 1];
					const witnessId = [...left.cells.keys()].find(
						id => left.cells.get(id)?.text && right?.cells.get(id)?.text
					);
					if (!witnessId) continue;
					collationState.selectCellRange(witnessId, left.id, right.id);
					collationState.mergeSelectedCells();
					return;
				}
			},
		],
		[
			'regularization rule change',
			() => collationState.addRule(makeRule({ pattern: 'ο', replacement: 'ω' })),
		],
		[
			'placement',
			() => {
				const witness = collationState.witnesses.find(witness => !witness.isBaseText);
				if (!witness) return;
				collationState.toggleWitnessExclusion(witness.witnessId);
				collationState.toggleWitnessExclusion(witness.witnessId);
			},
		],
	];

	const generated = generatedFixture();

	it.each([...stateLoadFixtures(), generated].map(fixture => [fixture.name, fixture]))(
		'matches views computed from scratch after every editorial action: %s',
		async (_, fixture) => {
			const vocabulary = await load(fixture as Fixture);
			if (collationState.getVariationUnitSpans().length === 0) {
				expectCachedViewsFresh(vocabulary, 'loaded');
				return;
			}
			const edited = vi.fn();
			const stopListening = collationState.onEdit(edited);
			for (const [step, act] of actions) {
				expectCachedViewsFresh(vocabulary, `before ${step}`);
				edited.mockClear();
				act();
				if (fixture === generated) expect(edited, step).toHaveBeenCalled();
				expectCachedViewsFresh(vocabulary, step);
				collationState.undo();
				expectCachedViewsFresh(vocabulary, `undo ${step}`);
				collationState.redo();
				expectCachedViewsFresh(vocabulary, `redo ${step}`);
			}
			stopListening();
		},
		60000
	);

	it('invalidates a unit when an overlapping unit marks a spanning reading', async () => {
		const vocabulary = await load(generatedFixture());
		const inner = collationState
			.getVariationUnitSpans()
			.find(span => span.unitId === 'unit:variant')!;
		const outer = collationState
			.getVariationUnitSpans()
			.find(
				span =>
					span.unitId !== inner.unitId &&
					span.startIndex <= inner.startIndex &&
					span.endIndex >= inner.endIndex
			)!;
		const before = collationState.peekUnitView(inner.unitId);
		const reading = collationState
			.peekReadingsForUnit(outer.unitId)
			.find(reading => reading.witnessIds.length > 0)!;

		expect(collationState.setReadingSpanning(outer.unitId, reading.id, true)).toBe(true);

		const after = collationState.peekUnitView(inner.unitId);
		expect(after).not.toBe(before);
		expect(after.overlappedWitnessIds.length).toBeGreaterThan(0);
		expectCachedViewsFresh(vocabulary, 'spanning');

		collationState.splitWitnessesIntoNewReading(outer.unitId, reading.witnessIds.slice(0, 1));

		expect(collationState.peekUnitView(inner.unitId).overlappedWitnessIds).toHaveLength(
			after.overlappedWitnessIds.length - 1
		);
		expectCachedViewsFresh(vocabulary, 'spanning source edit');
	}, 60000);
});
