import '../../../app.css';
import { page } from '@vitest/browser/context';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collateToAlignmentSnapshot } from '$lib/collation/collation-adapter';
import { collationState, type WitnessConfig } from '$lib/collation/collation-state.svelte';
import ReadingsPhase from './ReadingsPhase.svelte';

function makeWitness(witnessId: string, content: string, isBaseText = false): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
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

function collate(witnesses: WitnessConfig[]) {
	collationState.setWitnesses(witnesses);
	const snapshot = collateToAlignmentSnapshot({
		witnesses: collationState.buildCollationWitnessInputs(),
		options: { segmentation: false },
	});
	collationState.setAlignmentSnapshot(snapshot.snapshot);
}

describe('ReadingsPhase empty value slots', () => {
	beforeEach(() => {
		collationState.reset();
		collate([makeWitness('A', 'λογος', true), makeWitness('B', 'θεος')]);
	});

	it('stays hidden at rest and opens for keyboard focus or after a click', async () => {
		render(ReadingsPhase);
		const textB = page.getByRole('textbox', { name: 'Text of reading b', exact: true });
		await expect.element(textB).toBeVisible();
		const slotVisible = (label: string) =>
			document
				.querySelector(`button[aria-label="Add a note to reading ${label}"]`)
				?.checkVisibility();
		expect(slotVisible('b')).toBe(false);

		(textB.element() as HTMLInputElement).focus();
		await expect.poll(() => slotVisible('b')).toBe(true);
		(textB.element() as HTMLInputElement).blur();
		await expect.poll(() => slotVisible('b')).toBe(false);

		await page.getByRole('button', { name: 'B', exact: true }).click();
		await expect.poll(() => slotVisible('b')).toBe(true);
		expect(slotVisible('a')).toBe(false);
	});
});
