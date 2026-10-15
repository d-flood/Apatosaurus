import { page } from '@vitest/browser/context';
import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { CollationDocument } from '$lib/collation/collation-document';
import type { CbgmInput } from '$lib/cbgm/cbgm-input';
import type { CbgmCollationSnapshot } from '$lib/db/repositories/cbgm-analyses';

const mocks = vi.hoisted(() => ({ buildCbgmInput: vi.fn() }));
vi.mock('$lib/cbgm/cbgm-input', () => ({ buildCbgmInput: mocks.buildCbgmInput }));

import CbgmAnalysisForm from './CbgmAnalysisForm.svelte';

function snapshot(collationId: string): CbgmCollationSnapshot {
	return {
		collationId,
		title: collationId,
		segmentName: collationId,
		contentHash: `sha256:${collationId}`,
		document: { meta: { collationId } } as CollationDocument,
	};
}

function input(documents: CollationDocument[]): CbgmInput {
	const blocked = documents.some(document => document.meta.collationId === 'rom-2');
	return {
		tei: blocked ? null : '<TEI/>',
		witnesses: ['P46', '01'],
		siglumConflicts: [{ siglum: 'P46', transcriptionIds: ['p46-rom', 'p46-1cor'] }],
		blockingUnits: blocked
			? [{ collationId: 'rom-2', unitId: 'unit-3', label: 'Rom 2/3', kind: 'missing-lemma' }]
			: [],
		undecidedReadings: [],
		availableCorrectors: [],
	};
}

const onStart = vi.fn(async () => undefined);

beforeEach(() => {
	onStart.mockClear();
	mocks.buildCbgmInput.mockImplementation(input);
});

function renderForm(collations: CbgmCollationSnapshot[]) {
	render(CbgmAnalysisForm, {
		collations,
		unavailable: [],
		existingNames: ['Romans first hands'],
		readingTypes: [],
		onStart,
	});
	return {
		name: page.getByRole('textbox', { name: 'Name' }),
		start: page.getByRole('button', { name: 'Start analysis' }),
	};
}

it('refuses a name already used in the project', async () => {
	const { name, start } = renderForm([snapshot('rom-1')]);
	await name.fill('  romans FIRST hands ');
	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('This project already has an analysis with this name.');
	await expect.element(start).toBeDisabled();

	await name.fill('Romans with P46');
	await expect.element(page.getByText('comes from 2 transcriptions')).toBeVisible();
	await expect.element(start).toBeEnabled();
	await start.click();
	await expect.poll(() => onStart.mock.calls.length).toBe(1);
	expect(onStart).toHaveBeenCalledWith(
		expect.objectContaining({ name: 'Romans with P46', collationIds: ['rom-1'] })
	);
});

it('disables Start while units block the analysis', async () => {
	const { name, start } = renderForm([snapshot('rom-1'), snapshot('rom-2')]);
	await name.fill('Romans');
	await expect.element(start).toBeDisabled();
	await expect
		.element(page.getByRole('link', { name: 'Rom 2/3' }))
		.toHaveAttribute('href', '/collation/rom-2/readings');

	await page.getByRole('checkbox', { name: 'rom-2' }).click();
	await expect.element(page.getByRole('link', { name: 'Rom 2/3' })).not.toBeInTheDocument();
	await expect.element(start).toBeEnabled();
});
