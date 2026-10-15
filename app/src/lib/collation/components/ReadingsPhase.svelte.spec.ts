import { page, userEvent } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collateToAlignmentSnapshot } from '$lib/collation/collation-adapter';
import { collationState, type WitnessConfig } from '$lib/collation/collation-state.svelte';
import type { WitnessSourceToken } from '$lib/collation/collation-types';
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

function collate(witnesses: WitnessConfig[]) {
	collationState.setWitnesses(witnesses);
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
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

		const chips = [...document.querySelectorAll('[data-chip-index]')];
		expect(chips).toHaveLength(4);
		expect(chips.filter(element => element.getAttribute('tabindex') === '0')).toHaveLength(1);
		expect(
			chips.every(element => ['0', '-1'].includes(element.getAttribute('tabindex') ?? ''))
		).toBe(true);

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
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

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
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

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
		expect(
			document.querySelector<HTMLSelectElement>(
				'select[aria-label="Merge the selected readings into"]'
			)?.disabled
		).toBe(false);
	});

	it('moves a cross-card selection to a third reading in one action and one undo step', async () => {
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();
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
		expect(document.activeElement?.getAttribute('data-witness-id')).toBe('B');

		chip('C').focus();
		await userEvent.keyboard(' ');
		await userEvent.keyboard('{Escape}');

		collationState.undo();
		expect(witnessesOfReadings()).toEqual(before);
	});

	it('acts on the whole selection when a verb is chosen with a keyboard, not on the value in view', async () => {
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

		chip('B').focus();
		await userEvent.keyboard(' ');
		const before = witnessesOfReadings();
		document
			.querySelector<HTMLSelectElement>(
				'select[aria-label="Move selected witnesses to reading"]'
			)!
			.focus();
		await userEvent.keyboard('{ArrowDown}');

		expect(witnessesOfReadings()).toEqual(before);
		expect(announcement()).toBe('');
	});

	it('splits a selection into a new reading from the keyboard', async () => {
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

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
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

		chip('B').focus();
		await userEvent.keyboard(' ');
		chip('D').focus();
		await userEvent.keyboard(' ');

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
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

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
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

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
	const sigla = Array.from(
		{ length: 14 },
		(_, index) => `W${String(index + 1).padStart(2, '0')}`
	);

	beforeEach(() => {
		collationState.reset();
		collate([
			makeWitness('A', 'λογος', true),
			...sigla.map(siglum => makeWitness(siglum, 'θεος')),
		]);
	});

	it('clears witness expansion and selection when switching units', async () => {
		collationState.reset();
		collate([
			makeWitness('A', 'λογος και αλφα', true),
			...sigla.map(siglum => makeWitness(siglum, 'θεος και βητα')),
		]);
		render(ReadingsPhase);
		await expect.element(page.getByRole('button', { name: '+2 more' })).toBeInTheDocument();
		clickText('+2 more');
		await expect
			.element(page.getByRole('button', { name: 'W14', exact: true }))
			.toBeInTheDocument();
		chip('W01').focus();
		await userEvent.keyboard(' ');
		await expect
			.element(page.getByTestId('selection-count'))
			.toHaveTextContent('1 witness selected');
		collationState.selectedUnitIndex = 2;
		await expect.element(page.getByRole('button', { name: '+2 more' })).toBeInTheDocument();
		await expect.element(page.getByTestId('selection-count')).not.toBeInTheDocument();
		collationState.selectedUnitIndex = 0;
		await expect.element(page.getByRole('button', { name: '+2 more' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'W14', exact: true }))
			.not.toBeInTheDocument();
	});

	it('moves every selected witness, including those the reading has collapsed out of view', async () => {
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

		clickText('+2 more');
		await expect
			.element(page.getByRole('button', { name: 'W14', exact: true }))
			.toBeInTheDocument();
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
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

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
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

		expect(
			document.querySelector('summary[aria-label="More actions for reading a"]')
		).not.toBeNull();
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
		collationState.moveWitnessesToReading(0, ['B'], readings.find(r => r.label === 'a')!.id);

		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

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

describe('ReadingsPhase subreading types', () => {
	beforeEach(() => {
		collationState.reset();
		collate([makeWitness('A', 'λογος', true), makeWitness('B', 'θεος')]);
	});

	function openMenu(label: string): HTMLDetailsElement {
		const menu = document
			.querySelector(`summary[aria-label="More actions for reading ${label}"]`)!
			.closest('details') as HTMLDetailsElement;
		menu.open = true;
		return menu;
	}

	function selectIn(menu: HTMLElement, labelText: string): HTMLSelectElement {
		const label = [...menu.querySelectorAll('label')].find(element =>
			element.textContent?.includes(labelText)
		);
		if (!label) throw new Error(`no control labelled ${labelText}`);
		return label.querySelector('select')!;
	}

	function buttonIn(menu: HTMLElement, text: string): HTMLButtonElement {
		const button = [...menu.querySelectorAll('button')].find(element =>
			element.textContent?.includes(text)
		);
		if (!button) throw new Error(`no button labelled ${text}`);
		return button;
	}

	function labels(): string[] {
		return collationState.peekReadingsForUnit(0).map(reading => reading.label);
	}

	it('adds a subreading only once a reading type is chosen', async () => {
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();
		const menu = openMenu('a');

		expect(buttonIn(menu, 'Add subreading').disabled).toBe(true);
		buttonIn(menu, 'Add subreading').click();
		expect(labels()).toEqual(['a', 'b']);

		await userEvent.selectOptions(selectIn(menu, 'New subreading type'), 'orthographic');
		await expect.poll(() => buttonIn(menu, 'Add subreading').disabled).toBe(false);
		buttonIn(menu, 'Add subreading').click();

		await expect.poll(labels).toEqual(['a', 'b', 'ao']);
		expect(
			collationState.peekReadingsForUnit(0).find(reading => reading.label === 'ao')
				?.readingType
		).toBe('orthographic');
	});

	it('attaches a reading as a subreading only once a reading type is chosen', async () => {
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();
		const main = collationState.peekReadingsForUnit(0).find(reading => reading.label === 'a')!;
		const menu = openMenu('b');

		await userEvent.selectOptions(selectIn(menu, 'Attach as subreading of'), main.id);
		await expect.poll(() => buttonIn(menu, 'Attach').disabled).toBe(true);
		buttonIn(menu, 'Attach').click();
		expect(labels()).toEqual(['a', 'b']);

		await userEvent.selectOptions(selectIn(menu, 'Subreading type'), 'nonsense');
		await expect.poll(() => buttonIn(menu, 'Attach').disabled).toBe(false);
		buttonIn(menu, 'Attach').click();

		await expect.poll(labels).toEqual(['a', 'af']);
		await expect
			.element(page.getByTestId('readings-announcer'))
			.toHaveTextContent('b is now a subreading.');
	});
});

describe('ReadingsPhase ambiguous attestations', () => {
	beforeEach(() => {
		collationState.reset();
		collate([
			makeWitness('A', 'λογος', true),
			makeWitness('B', 'θεος'),
			makeWitness('C', 'θεος'),
			makeWitness('D', 'πνευμα'),
		]);
	});

	it('records selected witnesses as zw between two readings, then removes it', async () => {
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();

		chip('C').focus();
		await userEvent.keyboard(' ');
		const record = page.getByTestId('apply-ambiguous');
		await userEvent.click(page.getByRole('checkbox', { name: 'Ambiguous between: a' }));
		await expect.element(record).toBeDisabled();
		await userEvent.click(page.getByRole('checkbox', { name: 'Ambiguous between: b' }));
		await expect.element(record).toBeEnabled();
		await userEvent.click(record);

		await expect
			.element(page.getByTestId('readings-announcer'))
			.toHaveTextContent('Recorded C as zw a/b.');
		await expect
			.element(page.getByLabelText('Ambiguous attestations'))
			.toHaveTextContent(/zw a\/b\s*C/);
		await expect
			.element(page.getByLabelText('Apparatus notation for the selected variation unit'))
			.toHaveTextContent('zw a/b: C');
		expect(document.querySelector('[data-witness-id="C"]')).toBeNull();
		expect(witnessesOfReadings()).toEqual([['A'], ['B'], ['D']]);

		await userEvent.click(page.getByRole('button', { name: 'Remove zw a/b' }));

		await expect.element(page.getByLabelText('Ambiguous attestations')).not.toBeInTheDocument();
		expect(witnessesOfReadings()).toEqual([['A'], ['B', 'C'], ['D']]);
	});
});

describe('ReadingsPhase placement review', () => {
	const originalViewport = { width: window.innerWidth, height: window.innerHeight };
	afterEach(async () => {
		await page.viewport(originalViewport.width, originalViewport.height);
	});
	beforeEach(async () => {
		await page.viewport(390, 844);
		collationState.reset();
		collate([
			makeWitness('A', 'λογος', true),
			makeWitness('B', 'θεος'),
			makeWitness('C', 'θεος'),
			makeWitness('D', 'πνευμα'),
		]);
		collationState.primeReadingsForUnit(0);
	});

	it('marks units and witnesses, then confirms every attestation from the UI', async () => {
		const key = `unit:${collationState.alignmentColumns[0].id}`;
		collationState.unitDecisions.set(key, { unconfirmedWitnessIds: ['B', 'C'] });
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'B Unconfirmed attestation', exact: true }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: /Unconfirmed attestations/ }))
			.toBeInTheDocument();
		await expect
			.poll(() => {
				const section = document.querySelector<HTMLElement>(
					'section[aria-label="Unconfirmed attestations"]'
				)!;
				return (
					section.scrollWidth <= section.clientWidth &&
					section.getBoundingClientRect().right <= 390
				);
			})
			.toBe(true);
		await page.getByRole('button', { name: 'Confirm attestations', exact: true }).click();
		await expect
			.element(page.getByRole('button', { name: 'B', exact: true }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Confirm attestations', exact: true }))
			.not.toBeInTheDocument();
		expect(collationState.peekUnitView(0).unconfirmedWitnessIds).toEqual([]);
		collationState.undo();
		await expect
			.element(page.getByRole('button', { name: 'Confirm attestations', exact: true }))
			.toBeInTheDocument();
	});

	it('shows candidates first and resolves a held-out witness to any reading from the UI', async () => {
		const key = `unit:${collationState.alignmentColumns[0].id}`;
		const readings = collationState.peekReadingsForUnit(0);
		const beta = readings.find(reading => reading.witnessIds.includes('B'))!;
		const gamma = readings.find(reading => reading.witnessIds.includes('D'))!;
		collationState.unitDecisions.set(key, {
			unresolvedAttestations: [{ witnessId: 'C', candidateReadingIds: [beta.id, gamma.id] }],
		});
		render(ReadingsPhase);
		const section = page.getByRole('region', { name: 'Unresolved attestations' });
		await expect.element(section).toBeInTheDocument();
		expect(document.querySelector('[data-witness-id="C"]')).toBeNull();
		const choices = [
			...document.querySelectorAll<HTMLButtonElement>('[aria-label^="Assign C to reading"]'),
		];
		await expect
			.poll(() =>
				choices.every(button => {
					const rect = button.getBoundingClientRect();
					return (
						rect.left >= 0 &&
						rect.right <= 390 &&
						button.scrollWidth <= button.clientWidth
					);
				})
			)
			.toBe(true);
		expect(choices.map(button => button.getAttribute('aria-label'))).toEqual([
			'Assign C to reading b (candidate)',
			'Assign C to reading c (candidate)',
			'Assign C to reading a',
		]);
		await page.getByRole('button', { name: 'Assign C to reading a', exact: true }).click();
		await expect.element(section).not.toBeInTheDocument();
		expect(
			collationState.peekUnitView(0).readings.find(reading => reading.label === 'a')
				?.witnessIds
		).toEqual(['A', 'C']);
		collationState.undo();
		await expect.element(section).toBeInTheDocument();
		await page
			.getByRole('button', { name: 'Assign C to reading b (candidate)', exact: true })
			.click();
		expect(collationState.peekUnitView(0).unresolvedAttestations).toEqual([]);
		expect(
			collationState.peekUnitView(0).readings.find(reading => reading.id === beta.id)
				?.witnessIds
		).toEqual(['B', 'C']);
	});
});
