import { page, type Locator } from '@vitest/browser/context';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { collationState, type WitnessConfig } from '$lib/collation/collation-state.svelte';
import type { AlignmentCell } from '$lib/collation/alignment-snapshot';
import type { WitnessSourceToken } from '$lib/collation/collation-types';
import ReviewPhase from './ReviewPhase.svelte';

const WITNESS_IDS = ['A', 'B', 'C'] as const;

beforeAll(async () => {
	const style = document.createElement('style');
	style.textContent = (await import('../../../app.css?inline')).default as string;
	document.head.appendChild(style);
});

function tokens(content: string): WitnessSourceToken[] {
	return content.split(/\s+/).map(text => ({
		kind: 'text' as const,
		original: text,
		segments: [{ text, hasUnclear: false, isPunctuation: false, isSupplied: false }],
		gap: null,
	}));
}

function witness(witnessId: string, content: string): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		content,
		tokens: tokens(content),
		treatment: 'inherit',
		isBaseText: witnessId === 'A',
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

function seed(columns: Array<[string, string, string]>) {
	collationState.reset();
	collationState.setWitnesses(
		WITNESS_IDS.map((witnessId, index) =>
			witness(witnessId, columns.map(column => column[index]).join(' '))
		)
	);
	collationState.setAlignmentSnapshot({
		witnessOrder: [...WITNESS_IDS],
		columns: columns.map((texts, index) => ({
			id: `col-${index}`,
			index,
			merged: false,
			cells: WITNESS_IDS.map((witnessId, cellIndex) => [
				witnessId,
				textCell(texts[cellIndex]),
			]),
		})),
	});
}

function unit(label: string): Locator {
	return page.getByRole('group', { name: `Variation unit ${label}` });
}

function readingRow(unitLabel: string, text: string): HTMLElement {
	return unit(unitLabel).getByText(text, { exact: true }).element().closest('li')!;
}

function siglum(unitLabel: string, name: string): Locator {
	return unit(unitLabel).getByRole('button', { name, exact: true });
}

function isHighlighted(element: Element): boolean {
	return getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)';
}

async function openParallel() {
	render(ReviewPhase);
	await page.getByRole('radio', { name: 'Parallel' }).click();
}

describe('ParallelApparatus', () => {
	beforeEach(() => {
		seed([
			['en', 'en', 'en'],
			['arche', 'arche', 'archei'],
			['ho', 'ho', 'ho'],
			['logos', 'logoi', 'logos'],
		]);
	});

	it('replaces the traditional apparatus when Parallel is chosen', async () => {
		render(ReviewPhase);
		await expect.element(page.getByText(/4 ⸂ arche \]/)).toBeInTheDocument();
		await expect.element(unit('4')).not.toBeInTheDocument();
		await page.getByRole('radio', { name: 'Parallel' }).click();
		await expect.element(unit('4')).toBeVisible();
		await expect.element(page.getByText(/4 ⸂ arche \]/)).not.toBeInTheDocument();
		await page.getByRole('radio', { name: 'Traditional' }).click();
		await expect.element(page.getByText(/4 ⸂ arche \]/)).toBeInTheDocument();
	});

	it('flows base words and variation units in base-text order', async () => {
		collationState.setReadingParent(
			'unit:col-3',
			collationState.getReadingsForUnit('unit:col-3')[1]!.id,
			collationState.getReadingsForUnit('unit:col-3')[0]!.id,
			'orthographic'
		);
		await openParallel();
		const flow = [
			page.getByText('en', { exact: true }),
			unit('4'),
			page.getByText('ho', { exact: true }),
			unit('8'),
		].map(locator => locator.element());
		for (let index = 1; index < flow.length; index++)
			expect(
				flow[index - 1].compareDocumentPosition(flow[index]) &
					Node.DOCUMENT_POSITION_FOLLOWING
			).toBeTruthy();
		await expect.element(page.getByText('2', { exact: true })).toBeVisible();
		await expect.element(unit('4').getByText('arche', { exact: true })).toBeVisible();
		await expect.element(unit('4').getByText('archei', { exact: true })).toBeVisible();
		await expect.element(unit('4').getByText('a', { exact: true })).toBeVisible();
		await expect.element(siglum('4', 'C')).toBeVisible();
		await expect
			.poll(
				() =>
					readingRow('8', 'logoi').getBoundingClientRect().left >
					readingRow('8', 'logos').getBoundingClientRect().left
			)
			.toBe(true);
	});

	it('highlights a clicked witness across units and moves the highlight', async () => {
		await openParallel();
		await siglum('4', 'C').click();
		await expect.element(siglum('4', 'C')).toHaveAttribute('aria-pressed', 'true');
		await expect.element(siglum('8', 'C')).toHaveAttribute('aria-pressed', 'true');
		await expect
			.poll(() => getComputedStyle(siglum('8', 'C').element()).outlineStyle)
			.toBe('solid');
		await expect.poll(() => isHighlighted(readingRow('4', 'archei'))).toBe(true);
		await expect.poll(() => isHighlighted(readingRow('8', 'logos'))).toBe(true);
		await expect.poll(() => isHighlighted(readingRow('4', 'arche'))).toBe(false);
		await expect.poll(() => isHighlighted(readingRow('8', 'logoi'))).toBe(false);

		await siglum('8', 'B').click();
		await expect.element(siglum('4', 'C')).toHaveAttribute('aria-pressed', 'false');
		await expect.element(siglum('4', 'B')).toHaveAttribute('aria-pressed', 'true');
		await expect
			.poll(() => getComputedStyle(siglum('8', 'C').element()).outlineStyle)
			.toBe('none');
		await expect.poll(() => isHighlighted(readingRow('4', 'arche'))).toBe(true);
		await expect.poll(() => isHighlighted(readingRow('8', 'logoi'))).toBe(true);
		await expect.poll(() => isHighlighted(readingRow('4', 'archei'))).toBe(false);
		await expect.poll(() => isHighlighted(readingRow('8', 'logos'))).toBe(false);
	});

	it('hides and restores every sigla list', async () => {
		await openParallel();
		await expect.element(siglum('4', 'A')).toBeVisible();
		await page.getByRole('checkbox', { name: 'Hide witnesses' }).click();
		await expect
			.element(page.getByRole('button', { name: 'A', exact: true }).first())
			.not.toBeInTheDocument();
		await expect.element(unit('4').getByText('archei', { exact: true })).toBeVisible();
		await page.getByRole('checkbox', { name: 'Hide witnesses' }).click();
		await expect.element(siglum('8', 'A')).toBeVisible();
	});

	it('shows a manual witness description as the siglum tooltip', async () => {
		collationState.getManualWitnesses().push({
			id: 'syr',
			siglum: 'Syr',
			treatment: 'fragmentary',
			includeInCbgm: false,
			description: 'Syriac Peshitta',
		});
		await collationState.attachManualWitness(
			'unit:col-1',
			collationState.getReadingsForUnit('unit:col-1')[0]!.id,
			'Syr'
		);
		await openParallel();
		await expect.element(siglum('4', 'Syr')).toHaveAttribute('title', 'Syriac Peshitta');
		await expect.element(siglum('4', 'C')).not.toHaveAttribute('title');
	});
});

it('wraps the parallel flow within a phone viewport', async () => {
	const original = { width: window.innerWidth, height: window.innerHeight };
	await page.viewport(390, 844);
	try {
		seed([
			['ἐγένετο', 'ἐγένετο', 'ἐγένετο'],
			['ἄνθρωπος', 'ἄνθρωπος', 'ἀνθρώπων'],
			['ἀπεσταλμένος', 'ἀπεσταλμένος', 'ἀπεσταλμένος'],
			['παρὰ', 'παρὰ', 'ὑπὸ'],
			['θεοῦ', 'θεοῦ', 'θεοῦ'],
			['ὄνομα', 'ὀνόματι', 'ὄνομα'],
			['αὐτῷ', 'αὐτῷ', 'αὐτῷ'],
			['Ἰωάννης', 'Ἰωάννης', 'Ἰωάνης'],
		]);
		await openParallel();
		await expect.element(unit('16')).toBeVisible();
		const flow = unit('4').element().parentElement!;
		await expect.poll(() => flow.scrollWidth <= flow.clientWidth).toBe(true);
		await expect
			.poll(() =>
				[...flow.children].every(
					child => child.getBoundingClientRect().right <= window.innerWidth
				)
			)
			.toBe(true);
		await expect
			.poll(() => document.documentElement.scrollWidth <= window.innerWidth)
			.toBe(true);
	} finally {
		await page.viewport(original.width, original.height);
	}
});
