import { page } from '@vitest/browser/context';
import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { CollationDocument } from '$lib/collation/collation-document';
import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';
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
	await expect.element(page.getByText('comes from 2 witness sources')).toBeVisible();
	await expect.element(start).toBeEnabled();
	await start.click();
	await expect.poll(() => onStart.mock.calls.length).toBe(1);
	expect(onStart).toHaveBeenCalledWith(
		expect.objectContaining({ name: 'Romans with P46', collationIds: ['rom-1'] })
	);
});

it('defaults manual exclusions, lets scholars change them, and keeps recompute exclusions', async () => {
	const manualWitnesses = [
		{ id: 'version', siglum: 'Syriac', treatment: 'full' as const, includeInCbgm: false },
		{ id: 'father', siglum: 'Origen', treatment: 'fragmentary' as const, includeInCbgm: true },
	];
	mocks.buildCbgmInput.mockImplementation((documents, settings: CoherenceSettings) => ({
		...input(documents),
		witnesses: ['P46', '01', 'Syriac', 'Origen'],
		blockingUnits: settings.excludedWitnesses.includes('Syriac')
			? []
			: [
					{
						collationId: 'rom-1',
						unitId: 'unit-1',
						label: 'Rom 1/1',
						kind: 'unrecorded-manual-witness',
					},
				],
	}));
	const props = {
		collations: [snapshot('rom-1')],
		unavailable: [],
		existingNames: [],
		readingTypes: [],
		manualWitnesses,
		onStart,
	};
	const view = render(CbgmAnalysisForm, props);
	const syriac = page.getByRole('checkbox', { name: 'Syriac', exact: true });
	await expect.element(syriac).toBeChecked();
	await expect
		.element(page.getByRole('checkbox', { name: 'Origen', exact: true }))
		.not.toBeChecked();
	await page.getByRole('textbox', { name: 'Name' }).fill('Manual');
	const start = page.getByRole('button', { name: 'Start analysis' });
	await expect.element(start).toBeEnabled();
	await syriac.click();
	await expect.element(start).toBeDisabled();
	await expect
		.element(page.getByRole('link', { name: 'Rom 1/1' }))
		.toHaveAttribute('href', '/collation/rom-1/readings?unit=unit-1');
	await syriac.click();
	await start.click();
	await expect.poll(() => onStart.mock.calls.length).toBe(1);
	expect(onStart).toHaveBeenCalledWith(
		expect.objectContaining({
			settings: expect.objectContaining({ excludedWitnesses: ['Syriac'] }),
		})
	);
	await view.unmount();
	render(CbgmAnalysisForm, {
		...props,
		prefill: {
			name: 'Again',
			collationIds: ['rom-1'],
			settings: {
				minExtantUnits: null,
				minExtantProportion: null,
				excludedWitnesses: ['Origen'],
				classicRules: false,
				mergeSplitReadings: false,
				droppedReadingTypes: [],
				trivialReadingTypes: [],
				includedCorrectors: [],
			},
		},
	});
	await expect
		.element(page.getByRole('checkbox', { name: 'Syriac', exact: true }))
		.not.toBeChecked();
	await expect.element(page.getByRole('checkbox', { name: 'Origen', exact: true })).toBeChecked();
});

it('disables Start while units block the analysis', async () => {
	const { name, start } = renderForm([snapshot('rom-1'), snapshot('rom-2')]);
	await name.fill('Romans');
	await expect.element(start).toBeDisabled();
	await expect
		.element(page.getByRole('link', { name: 'Rom 2/3' }))
		.toHaveAttribute('href', '/collation/rom-2/readings?unit=unit-3');

	await page.getByRole('checkbox', { name: 'rom-2' }).click();
	await expect.element(page.getByRole('link', { name: 'Rom 2/3' })).not.toBeInTheDocument();
	await expect.element(start).toBeEnabled();
});

it('starts the analysis with the chosen trivial reading types', async () => {
	const { name, start } = renderForm([snapshot('rom-1')]);
	await name.fill('Romans trivial');
	await page.getByRole('checkbox', { name: 'Orthographic', exact: true }).nth(1).click();
	await start.click();

	await expect.poll(() => onStart.mock.calls.length).toBe(1);
	expect(onStart).toHaveBeenCalledWith(
		expect.objectContaining({
			settings: expect.objectContaining({
				droppedReadingTypes: [],
				trivialReadingTypes: ['orthographic'],
			}),
		})
	);
});
