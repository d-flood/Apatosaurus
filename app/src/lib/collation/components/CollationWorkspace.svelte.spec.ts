import { page, userEvent } from '@vitest/browser/context';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collateToAlignmentSnapshot } from '$lib/collation/collation-adapter';
import { collationState, type WitnessConfig } from '$lib/collation/collation-state.svelte';
import CollationWorkspace from './CollationWorkspace.svelte';

function makeWitness(witnessId: string, content: string, isBaseText = false): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		sourceVersion: 'v1',
		content,
		tokens: content.split(/\s+/).map(token => ({
			kind: 'text' as const,
			original: token,
			segments: [{ text: token, hasUnclear: false, isPunctuation: false, isSupplied: false }],
			gap: null,
		})),
		treatment: 'inherit',
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
	};
}

function witnessesOfReadings(): string[][] {
	return collationState.peekReadingsForUnit(0).map(reading => reading.witnessIds);
}

function mergeLastReadingIntoSecond() {
	const readings = collationState.peekReadingsForUnit(0);
	collationState.mergeReadings(0, [readings[2].id], readings[1].id);
}

describe('CollationWorkspace undo/redo', () => {
	beforeEach(() => {
		collationState.reset();
		collationState.setPhase('readings');
		collationState.setWitnesses([
			makeWitness('A', 'λογος', true),
			makeWitness('B', 'θεος'),
			makeWitness('C', 'πνευμα'),
		]);
		collationState.refreshCollationInput();
		const snapshot = collateToAlignmentSnapshot({
			witnesses: collationState.buildCollationWitnessInputs(),
			options: { segmentation: false },
		});
		collationState.setAlignmentSnapshot(snapshot.snapshot);
	});

	it('undoes and redoes a merge from the toolbar', async () => {
		render(CollationWorkspace);
		const undo = page.getByRole('button', { name: 'Undo' });
		const redo = page.getByRole('button', { name: 'Redo' });
		await expect.element(undo).toBeDisabled();
		const before = witnessesOfReadings();

		mergeLastReadingIntoSecond();
		const merged = witnessesOfReadings();
		await expect.element(undo).toBeEnabled();

		await undo.click();
		expect(witnessesOfReadings()).toEqual(before);
		await expect.element(redo).toBeEnabled();

		await redo.click();
		expect(witnessesOfReadings()).toEqual(merged);
		await expect.element(redo).toBeDisabled();
	});

	it('undoes with Mod+Z and redoes with Mod+Shift+Z or Ctrl+Y, but not inside text fields', async () => {
		render(CollationWorkspace);
		await expect.element(page.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
		const before = witnessesOfReadings();
		mergeLastReadingIntoSecond();
		const merged = witnessesOfReadings();

		const field = document.querySelector<HTMLInputElement>(
			'input[aria-label^="Text of reading"]'
		)!;
		field.focus();
		await userEvent.keyboard('{Control>}z{/Control}');
		expect(witnessesOfReadings()).toEqual(merged);
		field.blur();

		await userEvent.keyboard('{Meta>}z{/Meta}');
		expect(witnessesOfReadings()).toEqual(before);
		await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
		expect(witnessesOfReadings()).toEqual(merged);
		await userEvent.keyboard('{Control>}z{/Control}');
		expect(witnessesOfReadings()).toEqual(before);
		await userEvent.keyboard('{Control>}y{/Control}');
		expect(witnessesOfReadings()).toEqual(merged);
	});
});
