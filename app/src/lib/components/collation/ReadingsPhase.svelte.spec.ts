import { page, userEvent } from '@vitest/browser/context';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collateToAlignmentSnapshot } from '$lib/client/collation/collation-adapter';
import {
	collationState,
	type WitnessConfig,
} from '$lib/client/collation/collation-state.svelte';
import type { WitnessSourceToken } from '$lib/client/collation/collation-types';
import ReadingsPhase from './ReadingsPhase.svelte';

function makeTokens(content: string): WitnessSourceToken[] {
	return content
		.split(/\s+/)
		.filter(Boolean)
		.map(token => ({
			kind: 'text' as const,
			original: token,
			segments: [{ text: token, hasUnclear: false, isPunctuation: false, isSupplied: false }],
			gap: null,
		}));
}

function makeWitness(witnessId: string, content: string, isBaseText = false): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		sourceVersion: 'v1',
		content,
		tokens: makeTokens(content),
		treatment: 'inherit',
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
	};
}

const GAP_TOKEN: WitnessSourceToken = {
	kind: 'gap',
	original: '⊘',
	segments: [],
	gap: { source: 'gap', reason: '', unit: '', extent: '' },
};

/** The alignment the real collation pipeline produces, never a hand-built one. */
function collate(witnesses: WitnessConfig[]) {
	collationState.setWitnesses(witnesses);
	collationState.refreshCollationInput();
	const snapshot = collateToAlignmentSnapshot({
		witnesses: collationState.buildCollationWitnessInputs(),
		options: { segmentation: false },
	});
	collationState.setAlignmentSnapshot(snapshot.snapshot);
}

function chip(witnessId: string): HTMLButtonElement {
	const element = document.querySelector<HTMLButtonElement>(`[data-witness-id="${witnessId}"]`);
	if (!element) throw new Error(`no chip for ${witnessId}`);
	return element;
}

function witnessesOfReadings(): string[][] {
	return collationState.peekReadingsForUnit(0).map(reading => reading.witnessIds);
}

function clickText(text: string) {
	const button = [...document.querySelectorAll('button')].find(
		element => element.textContent?.trim() === text
	);
	if (!button) throw new Error(`no button labelled ${text}`);
	button.click();
}

function announcement(): string {
	return document.querySelector('[data-testid="readings-announcer"]')?.textContent ?? '';
}

/** Both destructive verbs take a target and then an explicit apply, never a `change` event. */
async function chooseAndApply(selectLabel: string, readingLabel: string, applyTestId: string) {
	const target = collationState
		.peekReadingsForUnit(0)
		.find(reading => reading.label === readingLabel);
	if (!target) throw new Error(`no reading labelled ${readingLabel}`);
	await userEvent.selectOptions(
		document.querySelector<HTMLSelectElement>(`select[aria-label="${selectLabel}"]`)!,
		target.id
	);
	const apply = document.querySelector<HTMLButtonElement>(`[data-testid="${applyTestId}"]`)!;
	apply.focus();
	await userEvent.keyboard('{Enter}');
}

describe('ReadingsPhase witness selection', () => {
	beforeEach(() => {
		collationState.reset();
		collate([
			makeWitness('A', 'λογος', true),
			makeWitness('B', 'θεος'),
			makeWitness('C', 'θεος'),
			makeWitness('D', 'πνευμα'),
		]);
	});

	it('gives the whole chip group a single tabstop', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		const chips = [...document.querySelectorAll('[data-chip-index]')];
		expect(chips).toHaveLength(4);
		expect(chips.filter(element => element.getAttribute('tabindex') === '0')).toHaveLength(1);
		expect(chips.every(element => ['0', '-1'].includes(element.getAttribute('tabindex') ?? ''))).toBe(
			true
		);

		// Tab lands in the group once and the next Tab leaves it; movement inside is by arrow key.
		document.querySelector<HTMLInputElement>('input[aria-label="Text of reading a"]')!.focus();
		await userEvent.tab();
		expect(document.activeElement?.getAttribute('data-witness-id')).toBe('A');
		await userEvent.tab();
		expect(document.activeElement?.hasAttribute('data-chip-index')).toBe(false);

		chip('A').focus();
		await userEvent.keyboard('{ArrowRight}');
		expect(document.activeElement?.getAttribute('data-witness-id')).toBe('B');
	});

	it('toggles a chip with Space and clears the selection with Escape', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		chip('A').focus();
		await userEvent.keyboard(' ');

		expect(chip('A').getAttribute('aria-pressed')).toBe('true');
		await expect
			.element(page.getByTestId('selection-count'))
			.toHaveTextContent('1 witness selected');

		await userEvent.keyboard('{Escape}');
		expect(chip('A').getAttribute('aria-pressed')).toBe('false');
		expect(document.querySelector('[data-testid="selection-bar"]')).toBeNull();
	});

	it('extends a selection across two cards with Shift and arrow keys', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		chip('A').focus();
		await userEvent.keyboard(' ');
		await userEvent.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}');

		expect(['A', 'B', 'C'].map(id => chip(id).getAttribute('aria-pressed'))).toEqual([
			'true',
			'true',
			'true',
		]);
		await expect
			.element(page.getByTestId('selection-count'))
			.toHaveTextContent('3 witnesses selected');
		// The selection spans the readings `a` and `b`, so merging them is offered.
		expect(
			document.querySelector<HTMLSelectElement>(
				'select[aria-label="Merge the selected readings into"]'
			)?.disabled
		).toBe(false);
	});

	it('moves a cross-card selection to a third reading in one action and one undo step', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();
		const before = witnessesOfReadings();

		chip('B').focus();
		await userEvent.keyboard(' ');
		chip('D').focus();
		await userEvent.keyboard(' ');

		await chooseAndApply('Move selected witnesses to reading', 'a', 'apply-move');

		await expect
			.element(page.getByTestId('readings-announcer'))
			.toHaveTextContent('Moved B, D to reading a.');
		expect(collationState.peekReadingsForUnit(0)[0]?.witnessIds).toEqual(['A', 'B', 'D']);
		// The bar that held the control is gone, so focus has to be put somewhere a keyboard
		// scholar can carry on from rather than dropped to the document.
		expect(document.activeElement?.getAttribute('data-witness-id')).toBe('B');

		// Selecting and deselecting is not editorial work, so it consumes no undo entry.
		chip('C').focus();
		await userEvent.keyboard(' ');
		await userEvent.keyboard('{Escape}');

		collationState.undo();
		expect(witnessesOfReadings()).toEqual(before);
	});

	it('acts on the whole selection when a verb is chosen with a keyboard, not on the value in view', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		// A closed select moves through its options with the arrow keys and fires `change` as it
		// goes, so choosing a target must not be the same event as performing the move.
		chip('B').focus();
		await userEvent.keyboard(' ');
		const before = witnessesOfReadings();
		document
			.querySelector<HTMLSelectElement>('select[aria-label="Move selected witnesses to reading"]')!
			.focus();
		await userEvent.keyboard('{ArrowDown}');

		expect(witnessesOfReadings()).toEqual(before);
		expect(announcement()).toBe('');
	});

	it('splits a selection into a new reading from the keyboard', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		chip('B').focus();
		await userEvent.keyboard(' ');
		document.querySelector<HTMLButtonElement>('[data-testid="split-selection"]')!.focus();
		await userEvent.keyboard('{Enter}');

		await expect
			.element(page.getByTestId('readings-announcer'))
			.toHaveTextContent('Split B into new reading');
		expect(witnessesOfReadings()).toContainEqual(['B']);
	});

	it('merges the readings a selection spans into one reading', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		chip('B').focus();
		await userEvent.keyboard(' ');
		chip('D').focus();
		await userEvent.keyboard(' ');

		// A merge discards the text of every reading it collapses, so the scholar is told which
		// text before committing to it.
		await userEvent.selectOptions(
			document.querySelector<HTMLSelectElement>(
				'select[aria-label="Merge the selected readings into"]'
			)!,
			collationState.peekReadingsForUnit(0).find(reading => reading.label === 'b')!.id
		);
		await expect.element(page.getByTestId('merge-warning')).toHaveTextContent('πνευμα');

		document.querySelector<HTMLButtonElement>('[data-testid="apply-merge"]')!.focus();
		await userEvent.keyboard('{Enter}');

		await expect
			.element(page.getByTestId('readings-announcer'))
			.toHaveTextContent('Merged 2 readings into b.');
		expect(announcement()).toContain('Discarded the text of');
		expect(collationState.peekReadingsForUnit(0).map(reading => reading.witnessIds)).toEqual([
			['A'],
			['B', 'C', 'D'],
		]);
		expect(document.activeElement?.getAttribute('data-witness-id')).toBe('B');
	});

	it('reports that a merge takes the lemma reading with it', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		// `a` is the base text's reading and so the lemma; merging it away is allowed but never
		// silent, because the lemma falls back to a reading the scholar did not choose.
		chip('A').focus();
		await userEvent.keyboard(' ');
		chip('B').focus();
		await userEvent.keyboard(' ');

		await userEvent.selectOptions(
			document.querySelector<HTMLSelectElement>(
				'select[aria-label="Merge the selected readings into"]'
			)!,
			collationState.peekReadingsForUnit(0).find(reading => reading.label === 'b')!.id
		);
		await expect.element(page.getByTestId('merge-warning')).toHaveTextContent('lemma reading');

		document.querySelector<HTMLButtonElement>('[data-testid="apply-merge"]')!.focus();
		await userEvent.keyboard('{Enter}');

		expect(announcement()).toContain('was the lemma reading');
	});

	it('clears the selection with Escape from the selection bar, not only from a chip', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		chip('B').focus();
		await userEvent.keyboard(' ');
		document.querySelector<HTMLButtonElement>('[data-testid="split-selection"]')!.focus();
		await userEvent.keyboard('{Escape}');

		expect(document.querySelector('[data-testid="selection-bar"]')).toBeNull();
		expect(chip('B').getAttribute('aria-pressed')).toBe('false');
		expect(document.activeElement?.hasAttribute('data-chip-index')).toBe(true);
	});
});

describe('ReadingsPhase selection beyond the witnesses on screen', () => {
	const sigla = Array.from({ length: 14 }, (_, index) => `W${String(index + 1).padStart(2, '0')}`);

	beforeEach(() => {
		collationState.reset();
		collate([
			makeWitness('A', 'λογος', true),
			...sigla.map(siglum => makeWitness(siglum, 'θεος')),
		]);
	});

	it('moves every selected witness, including those the reading has collapsed out of view', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		// A reading shows twelve sigla at a time, so the whole reading is brought into view, all
		// fourteen selected, and then the reading collapsed again.
		clickText('+2 more');
		await expect.element(page.getByRole('button', { name: 'W14', exact: true })).toBeInTheDocument();
		chip('W01').focus();
		await userEvent.keyboard(' ');
		await userEvent.keyboard('{Shift>}{End}{/Shift}');
		clickText('show less');

		await expect
			.element(page.getByTestId('selection-count'))
			.toHaveTextContent('14 witnesses selected');
		expect(document.querySelector('[data-witness-id="W14"]')).toBeNull();

		await chooseAndApply('Move selected witnesses to reading', 'a', 'apply-move');

		expect(collationState.peekReadingsForUnit(0)[0]?.witnessIds).toEqual(['A', ...sigla]);
		expect(announcement()).toContain('W14');
	});
});

describe('ReadingsPhase non-attestation', () => {
	beforeEach(() => {
		collationState.reset();
		collate([
			makeWitness('A', 'λογος', true),
			makeWitness('B', 'θεος'),
			{ ...makeWitness('C', 'λογος'), tokens: [GAP_TOKEN] },
		]);
	});

	it('gives a witness that does not testify no selectable chip', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		expect(collationState.getNonAttestationForUnit(0).witnessIds).toEqual(['C']);
		expect(document.querySelector('[data-witness-id="C"]')).toBeNull();
		await expect
			.element(page.getByLabelText('Witnesses that do not testify'))
			.toHaveTextContent('C');
	});
});

describe('ReadingsPhase per-card menu', () => {
	beforeEach(() => {
		collationState.reset();
		collate([makeWitness('A', 'λογος', true), makeWitness('B', 'θεος')]);
	});

	it('keeps rare operations out of the card surface and explains a refused reorder', async () => {
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		// Nothing on the card itself offers them; they live behind the card's menu.
		expect(document.querySelector('summary[aria-label="More actions for reading a"]')).not.toBeNull();
		const menu = document
			.querySelector('summary[aria-label="More actions for reading a"]')!
			.closest('details') as HTMLDetailsElement;
		expect(menu.open).toBe(false);
		menu.open = true;

		const moveUp = [...menu.querySelectorAll('button')].find(button =>
			button.textContent?.includes('Move up')
		)!;
		moveUp.focus();
		await userEvent.keyboard('{Enter}');

		await expect
			.element(page.getByTestId('readings-announcer'))
			.toHaveTextContent('a is already first in its group.');
	});
});

describe('ReadingsPhase deletion guard', () => {
	beforeEach(() => {
		collationState.reset();
		collate([
			makeWitness('A', 'λογος', true),
			makeWitness('B', 'θεος'),
			makeWitness('C', 'πνευμα'),
		]);
	});

	it('keeps deletion blocked while the card still shows attesting witnesses', async () => {
		const readings = collationState.peekReadingsForUnit(0);
		const main = readings.find(reading => reading.label === 'b')!;
		const subreading = readings.find(reading => reading.label === 'c')!;
		collationState.setReadingParent(0, subreading.id, main.id);
		// The main reading's own witnesses go elsewhere; its subreading's witness still attests it,
		// and the card still shows that siglum.
		collationState.moveWitnessesToReading(0, ['B'], readings.find(r => r.label === 'a')!.id);

		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeInTheDocument();

		const menu = document
			.querySelector('summary[aria-label="More actions for reading b"]')!
			.closest('details') as HTMLDetailsElement;
		menu.open = true;
		const remove = [...menu.querySelectorAll('button')].find(button =>
			button.textContent?.includes('Delete reading')
		)!;

		expect(remove.disabled).toBe(true);
		expect(menu.textContent).toContain('still attest this reading');
	});
});
