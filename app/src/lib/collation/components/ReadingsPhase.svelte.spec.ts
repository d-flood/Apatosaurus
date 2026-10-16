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
	return collationState
		.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
		.map(reading => reading.witnessIds);
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
		.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
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
		expect(
			collationState.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)[0]
				?.witnessIds
		).toEqual(['A', 'B', 'D']);
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
			collationState
				.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
				.find(reading => reading.label === 'b')!.id
		);
		await expect.element(page.getByTestId('merge-warning')).toHaveTextContent('πνευμα');

		document.querySelector<HTMLButtonElement>('[data-testid="apply-merge"]')!.focus();
		await userEvent.keyboard('{Enter}');

		await expect
			.element(page.getByTestId('readings-announcer'))
			.toHaveTextContent('Merged 2 readings into b.');
		expect(announcement()).toContain('Discarded the text of');
		expect(
			collationState
				.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
				.map(reading => reading.witnessIds)
		).toEqual([['A'], ['B', 'C', 'D']]);
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
			collationState
				.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
				.find(reading => reading.label === 'b')!.id
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
		collationState.selectedUnitId = `unit:${collationState.alignmentColumns[2].id}`;
		await expect.element(page.getByRole('button', { name: '+2 more' })).toBeInTheDocument();
		await expect.element(page.getByTestId('selection-count')).not.toBeInTheDocument();
		collationState.selectedUnitId = `unit:${collationState.alignmentColumns[0].id}`;
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

		expect(
			collationState.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)[0]
				?.witnessIds
		).toEqual(['A', ...sigla]);
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

		expect(
			collationState.getNonAttestationForUnit(`unit:${collationState.alignmentColumns[0].id}`)
				.witnessIds
		).toEqual(['C']);
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
		const readings = collationState.peekReadingsForUnit(
			`unit:${collationState.alignmentColumns[0].id}`
		);
		const main = readings.find(reading => reading.label === 'b')!;
		const subreading = readings.find(reading => reading.label === 'c')!;
		collationState.setReadingParent(
			`unit:${collationState.alignmentColumns[0].id}`,
			subreading.id,
			main.id
		);
		collationState.moveWitnessesToReading(
			`unit:${collationState.alignmentColumns[0].id}`,
			['B'],
			readings.find(r => r.label === 'a')!.id
		);

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
		return collationState
			.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
			.map(reading => reading.label);
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
			collationState
				.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
				.find(reading => reading.label === 'ao')?.readingType
		).toBe('orthographic');
	});

	it('attaches a reading as a subreading only once a reading type is chosen', async () => {
		render(ReadingsPhase);
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }))
			.toBeInTheDocument();
		const main = collationState
			.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
			.find(reading => reading.label === 'a')!;
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

describe('ReadingsPhase reading tags', () => {
	const originalViewport = { width: window.innerWidth, height: window.innerHeight };
	afterEach(async () => {
		await page.viewport(originalViewport.width, originalViewport.height);
	});

	it.each([390, 1280])('adds existing and new tags, and removes badges at %ipx', async width => {
		await page.viewport(width, 844);
		collationState.reset();
		collate([
			makeWitness('A', 'λογος', true),
			makeWitness('B', 'θεος'),
			makeWitness('C', 'πνευμα'),
		]);
		collationState.setAlignmentDisplayMode('original');
		const main = collationState.peekReadingsForUnit(
			`unit:${collationState.alignmentColumns[0].id}`
		)[0];
		await collationState.addReadingTag(
			`unit:${collationState.alignmentColumns[0].id}`,
			main.id,
			'Nomen sacrum'
		);
		collationState.removeReadingTag(
			`unit:${collationState.alignmentColumns[0].id}`,
			main.id,
			collationState.getReadingTags()[0].id
		);
		const sub = collationState.peekReadingsForUnit(
			`unit:${collationState.alignmentColumns[0].id}`
		)[1];
		collationState.setReadingParent(
			`unit:${collationState.alignmentColumns[0].id}`,
			sub.id,
			main.id,
			'orthographic'
		);
		const label = collationState
			.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
			.find(reading => reading.id === sub.id)!.label;
		render(ReadingsPhase);
		await expect
			.poll(() =>
				[...document.querySelectorAll('summary')].map(element =>
					element.getAttribute('aria-label')
				)
			)
			.toContain(`More actions for reading ${label}`);
		(
			document
				.querySelector(`summary[aria-label="More actions for reading ${label}"]`)!
				.closest('details') as HTMLDetailsElement
		).open = true;
		const input = page.getByRole('combobox', { name: `Tag for reading ${label}`, exact: true });
		await expect.element(input).toBeVisible();
		expect(
			document
				.querySelector(`input[aria-label="Tag for reading ${label}"]`)
				?.getAttribute('list')
		).toBeTruthy();
		expect(
			[...document.querySelectorAll('datalist option')].some(
				option => option.getAttribute('value') === 'Nomen sacrum'
			)
		).toBe(true);
		await input.fill('nomen SACRUM');
		await page
			.getByRole('button', { name: `Add tag to reading ${label}`, exact: true })
			.click();
		const badge = page.getByRole('button', {
			name: `Remove tag Nomen sacrum from reading ${label}`,
			exact: true,
		});
		await expect.element(badge).toBeVisible();
		await input.fill('Abbreviation');
		await page
			.getByRole('button', { name: `Add tag to reading ${label}`, exact: true })
			.click();
		await expect
			.element(
				page.getByRole('button', {
					name: `Remove tag Abbreviation from reading ${label}`,
					exact: true,
				})
			)
			.toBeVisible();
		expect(collationState.getReadingTags().map(tag => tag.label)).toEqual([
			'Nomen sacrum',
			'Abbreviation',
		]);
		expect(
			collationState
				.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
				.find(reading => reading.id === sub.id)?.readingTags
		).toHaveLength(2);
		await expect
			.poll(() => {
				const menu = document
					.querySelector(`input[aria-label="Tag for reading ${label}"]`)!
					.closest('.dropdown-content')!;
				const bounds = menu.getBoundingClientRect();
				return (
					bounds.left >= 0 &&
					bounds.right <= width &&
					menu.scrollWidth <= menu.clientWidth
				);
			})
			.toBe(true);
		await badge.click();
		await expect.element(badge).not.toBeInTheDocument();
		expect(
			collationState
				.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
				.find(reading => reading.id === sub.id)?.readingTags
		).toEqual([collationState.getReadingTags()[1].id]);
		collationState.undo();
		await expect.element(badge).toBeVisible();
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
		collationState.primeReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`);
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
		expect(
			collationState.peekUnitView(`unit:${collationState.alignmentColumns[0].id}`)
				.unconfirmedWitnessIds
		).toEqual([]);
		collationState.undo();
		await expect
			.element(page.getByRole('button', { name: 'Confirm attestations', exact: true }))
			.toBeInTheDocument();
	});

	it('shows candidates first and resolves a held-out witness to any reading from the UI', async () => {
		const key = `unit:${collationState.alignmentColumns[0].id}`;
		const readings = collationState.peekReadingsForUnit(
			`unit:${collationState.alignmentColumns[0].id}`
		);
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
			collationState
				.peekUnitView(`unit:${collationState.alignmentColumns[0].id}`)
				.readings.find(reading => reading.label === 'a')?.witnessIds
		).toEqual(['A', 'C']);
		collationState.undo();
		await expect.element(section).toBeInTheDocument();
		await page
			.getByRole('button', { name: 'Assign C to reading b (candidate)', exact: true })
			.click();
		expect(
			collationState.peekUnitView(`unit:${collationState.alignmentColumns[0].id}`)
				.unresolvedAttestations
		).toEqual([]);
		expect(
			collationState
				.peekUnitView(`unit:${collationState.alignmentColumns[0].id}`)
				.readings.find(reading => reading.id === beta.id)?.witnessIds
		).toEqual(['B', 'C']);
	});
});

describe('ReadingsPhase manual witnesses', () => {
	const originalViewport = { width: window.innerWidth, height: window.innerHeight };
	afterEach(async () => {
		await page.viewport(originalViewport.width, originalViewport.height);
	});

	it('keeps an authored subreading’s manual witnesses visible when the family is collapsed', async () => {
		collationState.reset();
		collate([makeWitness('A', 'λογος', true), makeWitness('B', 'θεος')]);
		const main = collationState.peekReadingsForUnit(
			`unit:${collationState.alignmentColumns[0].id}`
		)[0];
		const id = collationState.addAuthoredReading(
			`unit:${collationState.alignmentColumns[0].id}`,
			'λογου'
		)!;
		await collationState.attachManualWitness(
			`unit:${collationState.alignmentColumns[0].id}`,
			id,
			'Father'
		);
		collationState.setReadingParent(
			`unit:${collationState.alignmentColumns[0].id}`,
			id,
			main.id,
			'orthographic'
		);
		render(ReadingsPhase);
		await expect
			.element(
				page.getByRole('button', { name: 'Detach Father from reading a', exact: true })
			)
			.toBeVisible();
		await page.getByRole('radio', { name: 'Original', exact: true }).click();
		await expect
			.element(
				page.getByRole('button', { name: 'Detach Father from reading ao', exact: true })
			)
			.toBeVisible();
	});

	it.each([390, 1280])(
		'attaches existing and new sigla, refuses collisions, and authors readings at %ipx',
		async width => {
			await page.viewport(width, 844);
			collationState.reset();
			collate([makeWitness('A', 'λογος', true), makeWitness('B', 'θεος')]);
			const first = collationState.peekReadingsForUnit(
				`unit:${collationState.alignmentColumns[0].id}`
			)[0];
			await collationState.attachManualWitness(
				`unit:${collationState.alignmentColumns[0].id}`,
				first.id,
				'Father'
			);
			collationState.detachManualWitness(
				`unit:${collationState.alignmentColumns[0].id}`,
				collationState.getManualWitnesses()[0].id
			);
			render(ReadingsPhase);
			const input = page.getByRole('combobox', {
				name: 'Manual witness for reading a',
				exact: true,
			});
			await expect.element(input).toBeVisible();
			expect(
				[...document.querySelectorAll('datalist option')].some(
					option => option.getAttribute('value') === 'Father'
				)
			).toBe(true);
			await input.fill('Father');
			await page
				.getByRole('button', { name: 'Attach manual witness to reading a', exact: true })
				.click();
			const existing = page.getByRole('button', {
				name: 'Detach Father from reading a',
				exact: true,
			});
			await expect.element(existing).toBeVisible();
			expect(collationState.getManualWitnesses()).toHaveLength(1);
			await input.fill(' A ');
			await page
				.getByRole('button', { name: 'Attach manual witness to reading a', exact: true })
				.click();
			await expect.poll(announcement).toContain('CBGM joins witnesses by siglum');
			await expect.element(page.getByRole('alert')).toBeVisible();
			await expect
				.element(page.getByRole('alert'))
				.toHaveTextContent('CBGM joins witnesses by siglum');
			expect(collationState.getManualWitnesses()).toHaveLength(1);
			await input.fill('Version');
			await page
				.getByRole('button', { name: 'Attach manual witness to reading a', exact: true })
				.click();
			await expect
				.element(
					page.getByRole('button', { name: 'Detach Version from reading a', exact: true })
				)
				.toBeVisible();
			expect(collationState.getManualWitnesses().map(witness => witness.siglum)).toEqual([
				'Father',
				'Version',
			]);
			await page
				.getByRole('textbox', { name: 'New reading text', exact: true })
				.fill('πνευμα');
			await page.getByRole('button', { name: 'Add reading', exact: true }).click();
			await expect
				.element(page.getByRole('textbox', { name: 'Text of reading c', exact: true }))
				.toHaveValue('πνευμα');
			await page
				.getByRole('combobox', { name: 'Manual witness for reading c', exact: true })
				.fill('Version');
			await page
				.getByRole('button', { name: 'Attach manual witness to reading c', exact: true })
				.click();
			await expect
				.element(
					page.getByRole('button', { name: 'Detach Version from reading c', exact: true })
				)
				.toBeVisible();
			await page.getByRole('checkbox', { name: 'Omission', exact: true }).click();
			await page.getByRole('button', { name: 'Add reading', exact: true }).click();
			await expect
				.element(page.getByRole('textbox', { name: 'Text of reading d', exact: true }))
				.toBeDisabled();
			await expect
				.poll(() =>
					[
						...document.querySelectorAll<HTMLElement>(
							'input[aria-label^="Manual witness"], button[aria-label^="Attach manual"], form[aria-label="Add authored reading"]'
						),
					].every(element => {
						const rect = element.getBoundingClientRect();
						return (
							rect.left >= 0 &&
							rect.right <= width &&
							element.scrollWidth <= element.clientWidth
						);
					})
				)
				.toBe(true);
			await page
				.getByRole('button', { name: 'Detach Version from reading c', exact: true })
				.click();
			await expect
				.element(page.getByRole('textbox', { name: 'Text of reading c', exact: true }))
				.toHaveAttribute('placeholder', 'om.');
			expect(
				collationState
					.peekReadingsForUnit(`unit:${collationState.alignmentColumns[0].id}`)
					.some(reading => reading.text === 'πνευμα')
			).toBe(false);
		}
	);
});

it('records all full-manual testimony states and manual ambiguity at phone width', async () => {
	const original = { width: window.innerWidth, height: window.innerHeight };
	await page.viewport(390, 844);
	try {
		collationState.reset();
		collate([makeWitness('A', 'alpha', true), makeWitness('B', 'beta')]);
		collationState
			.getManualWitnesses()
			.push({ id: 'full', siglum: 'Syriac', treatment: 'full', includeInCbgm: false });
		render(ReadingsPhase);
		await expect.element(page.getByLabelText('Unrecorded manual witnesses')).toBeVisible();
		await page.getByRole('button', { name: 'Set Syriac uncited', exact: true }).click();
		await expect
			.poll(
				() =>
					collationState.peekUnitView(`unit:${collationState.alignmentColumns[0].id}`)
						.uncitedManualWitnessIds
			)
			.toEqual(['full']);
		await expect
			.poll(
				() =>
					collationState.peekUnitView(`unit:${collationState.alignmentColumns[0].id}`)
						.unrecordedManualWitnessIds
			)
			.toEqual([]);
		await page.getByRole('button', { name: 'Set Syriac non-attestation', exact: true }).click();
		await expect
			.poll(
				() =>
					collationState.peekUnitView(`unit:${collationState.alignmentColumns[0].id}`)
						.nonAttestingManualWitnessIds
			)
			.toEqual(['full']);
		await page
			.getByRole('combobox', { name: 'Manual witness for reading a', exact: true })
			.fill('Syriac');
		await page
			.getByRole('button', { name: 'Attach manual witness to reading a', exact: true })
			.click();
		await page
			.getByRole('button', { name: 'Select manual witness Syriac', exact: true })
			.click();
		await page.getByRole('checkbox', { name: 'Ambiguous between: a', exact: true }).click();
		await page.getByRole('checkbox', { name: 'Ambiguous between: b', exact: true }).click();
		await page.getByRole('button', { name: 'Record zw', exact: true }).click();
		await expect
			.poll(
				() =>
					collationState.peekUnitView(`unit:${collationState.alignmentColumns[0].id}`)
						.ambiguousAttestations[0]?.witnessIds
			)
			.toEqual(['full']);
		await expect
			.poll(() =>
				[
					...document.querySelectorAll<HTMLElement>(
						'section[aria-label="Manual witness testimony"] button'
					),
				].every(element => {
					const rect = element.getBoundingClientRect();
					return rect.left >= 0 && rect.right <= 390;
				})
			)
			.toBe(true);
	} finally {
		await page.viewport(original.width, original.height);
	}
});

describe('ReadingsPhase overlapping units', () => {
	beforeEach(() => collationState.reset());
	afterEach(() => collationState.reset());

	it('selects enclosing and inner units with the same start independently', async () => {
		collate([makeWitness('A', 'one two three', true), makeWitness('B', 'other two three')]);
		const columns = collationState.alignmentColumns;
		const inner = `unit:${columns[0].id}`;
		expect(collationState.declareUnit(columns.map(column => column.id))).toBe(true);
		const enclosing = collationState.getVariationUnitSpans()[0].unitId;
		render(ReadingsPhase);
		const enclosingButton = page.getByRole('button', {
			name: 'one two three 2-6',
			exact: true,
		});
		const innerButton = page.getByRole('button', { name: 'one 2', exact: true });
		await enclosingButton.click();
		await expect.element(enclosingButton).toHaveAttribute('aria-pressed', 'true');
		expect(collationState.selectedUnitId).toBe(enclosing);
		await expect
			.element(page.getByRole('textbox', { name: 'Text of reading a', exact: true }))
			.toHaveValue('one two three');
		await innerButton.click();
		await expect.element(innerButton).toHaveAttribute('aria-pressed', 'true');
		await expect.element(enclosingButton).toHaveAttribute('aria-pressed', 'false');
		expect(collationState.selectedUnitId).toBe(inner);
		await expect
			.element(page.getByRole('textbox', { name: 'Text of reading a', exact: true }))
			.toHaveValue('one');
		await enclosingButton.click();
		await expect
			.element(page.getByRole('textbox', { name: 'Text of reading a', exact: true }))
			.toHaveValue('one two three');
	});
});
