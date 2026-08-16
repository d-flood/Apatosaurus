import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collationState, type WitnessConfig } from '$lib/client/collation/collation-state.svelte';
import type { AlignmentCell, AlignmentSnapshot } from '$lib/client/collation/alignment-snapshot';
import type { WitnessSourceToken } from '$lib/client/collation/collation-types';
import ReviewPhase from './ReviewPhase.svelte';

function tokens(content: string): WitnessSourceToken[] {
	return content.split(/\s+/).map(text => ({
		kind: 'text' as const,
		original: text,
		segments: [{ text, hasUnclear: false, isPunctuation: false, isSupplied: false }],
		gap: null,
	}));
}

function witness(witnessId: string, content: string, isBaseText = false): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		sourceVersion: 'v1',
		content,
		tokens: tokens(content),
		treatment: 'inherit',
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
	};
}

function textCell(text: string): AlignmentCell {
	return {
		text,
		regularizedText: text,
		alignmentValue: text,
		sourceTokenIds: [],
		kind: 'text',
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
	};
}

function untranscribedCell(): AlignmentCell {
	return {
		...textCell('⊘'),
		regularizedText: null,
		alignmentValue: '__untranscribed__:none:none:none',
		kind: 'untranscribed',
		gap: { source: 'untranscribed', reason: '', unit: '', extent: '' },
		isLacuna: true,
	};
}

function snapshot(columnIds: string[]): AlignmentSnapshot {
	return {
		witnessOrder: ['A', 'B'],
		columns: columnIds.map((id, index) => ({
			id,
			index,
			merged: false,
			cells: [
				['A', textCell(`alpha-${index}`)],
				['B', textCell(`beta-${index}`)],
			],
		})),
	};
}

function renderReview() {
	render(ReviewPhase, {
		canCommitVersion: false,
		commitDisabledReason: '',
		commitInFlight: false,
		isCommitFormOpen: false,
		commitMessage: '',
		commitError: null,
		commitSuccess: null,
		onOpenCommitForm: () => {},
		onCloseCommitForm: () => {},
		onCommitVersion: event => event.preventDefault(),
		onCommitMessage: () => {},
	});
}

describe('ReviewPhase orphan worklist', () => {
	beforeEach(() => {
		collationState.reset();
		collationState.setWitnesses([
			witness('A', 'alpha-0 alpha-1', true),
			witness('B', 'beta-0 beta-1'),
		]);
	});

	it('surfaces an orphaned decision at a live variation unit with its reading-phase action', async () => {
		collationState.setAlignmentSnapshot(snapshot(['col-1']));
		const reading = collationState.getReadingsForUnit(0)[0]!;
		const addedReadingId = collationState.addReading(0);
		collationState.setReadingParent(0, addedReadingId, reading.id);
		collationState.deleteReading(0, addedReadingId);

		renderReview();

		await expect
			.element(page.getByRole('button', { name: /Resolve orphaned reading decision/ }))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByText('refers to a reading that is no longer in this variation unit.')
			)
			.toBeInTheDocument();
	});

	it('surfaces decisions for a vanished variation unit with an alignment action', async () => {
		collationState.setAlignmentSnapshot(snapshot(['col-1', 'col-2']));
		const readings = collationState.getReadingsForUnit(1);
		collationState.setReadingParent(1, readings[1]!.id, readings[0]!.id);
		collationState.mergeColumns(['col-1', 'col-2']);

		renderReview();

		await expect
			.element(page.getByRole('button', { name: 'Review vanished variation unit' }))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					/Review the alignment to restore it before resolving those decisions/
				)
			)
			.toBeInTheDocument();
	});
});

describe('ReviewPhase export refusals', () => {
	beforeEach(() => {
		collationState.reset();
		collationState.setWitnesses([
			witness('A', 'alpha', true),
			witness('B', 'alpha'),
			witness('C', ''),
		]);
		vi.spyOn(collationState, 'collationId', 'get').mockReturnValue('collation-1');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('lists an untranscribed witness in agreed text with transcription and Setup routes', async () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B', 'C'],
			columns: [
				{
					id: 'agreed-column',
					index: 0,
					merged: false,
					cells: [
						['A', textCell('alpha')],
						['B', textCell('alpha')],
						['C', untranscribedCell()],
					],
				},
			],
		});

		renderReview();

		await expect
			.element(
				page.getByText(
					'C is untranscribed in agreed text 2. No variation unit is responsible.'
				)
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Open C transcription for agreed text 2' }))
			.toHaveAttribute('href', '/transcription/C-tx');
		await expect
			.element(page.getByRole('link', { name: 'Exclude C in Setup' }))
			.toHaveAttribute('href', '/collation/collation-1/setup');
		await expect
			.element(page.getByText('No unresolved decisions.'))
			.not.toBeInTheDocument();
	});

	it('lists agreed text and variation units independently when the same witness is untranscribed', async () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B', 'C'],
			columns: [
				{
					id: 'agreed-column',
					index: 0,
					merged: false,
					cells: [
						['A', textCell('one')],
						['B', textCell('one')],
						['C', untranscribedCell()],
					],
				},
				{
					id: 'variant-column',
					index: 1,
					merged: false,
					cells: [
						['A', textCell('alpha')],
						['B', textCell('beta')],
						['C', untranscribedCell()],
					],
				},
			],
		});

		renderReview();

		await expect
			.element(
				page.getByText('C is untranscribed in agreed text 2. No variation unit is responsible.')
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Unit 4: Finish transcribing witnesses' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('C is untranscribed at variation unit 4.'))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Open C transcription for variation unit 4' }))
			.toHaveAttribute('href', '/transcription/C-tx');
	});

	it('links an agreed-text transcription refusal to Alignment without inventing a variation unit', async () => {
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B', 'C'],
			columns: [
				{
					id: 'agreed-column',
					index: 0,
					merged: false,
					cells: [
						['A', textCell('alpha')],
						['B', textCell('alpha')],
						['C', untranscribedCell()],
					],
				},
			],
		});

		renderReview();
		await page.getByRole('button', { name: 'Export TEI apparatus' }).click();

		const refusal = page.getByRole('link', {
			name: /Agreed text .*untranscribed witness coverage \(C\) in Alignment before export/,
		});
		await expect.element(refusal).toHaveAttribute('href', '/collation/collation-1/alignment');
		await expect.element(refusal).toHaveTextContent('This agreed-text refusal has no variation unit.');
	});
});
