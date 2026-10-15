import type {
	CompareWitnessesRow,
	CompareWitnessesTable,
	FindRelativesTable,
} from '@apatosaurus/open-cbgm-wasm';
import { page } from '@vitest/browser/context';
import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import CbgmCoherenceTable from './CbgmCoherenceTable.svelte';

const row: CompareWitnessesRow = {
	id: '03',
	dir: 1,
	nr: '8',
	pass: 116,
	eq: 98,
	perc: 84.4828,
	prior: 6,
	posterior: 11,
	norel: 0,
	uncl: 1,
	undecided: 2,
	expl: 109,
	cost: '11',
};

const compare: CompareWitnessesTable = { primary_wit: '5', primary_extant: 116, rows: [row] };

const relatives: FindRelativesTable = {
	primary_wit: '5',
	primary_extant: 116,
	label: '3Jo 1:4/22-26',
	connectivity: 10,
	primary_rdg: 'a',
	rows: [{ ...row, rdg: 'b' }],
};

function cellUnder(header: string): string {
	const headers = page.getByRole('columnheader').elements();
	const index = headers.findIndex(cell => cell.textContent?.trim() === header);
	expect(index).toBeGreaterThanOrEqual(0);
	return page.getByRole('row').nth(1).getByRole('cell').nth(index).element().textContent!.trim();
}

it.each([
	['compare witnesses', compare],
	['find relatives', relatives],
])('reports undecided units apart from unclear ones in %s', async (_name, table) => {
	render(CbgmCoherenceTable, { table });

	await expect.element(page.getByRole('columnheader', { name: 'UNDECIDED' })).toBeVisible();
	expect(cellUnder('UNDECIDED')).toBe('2');
	expect(cellUnder('UNCLEAR')).toBe('1');

	const unclearHeaders = page
		.getByRole('columnheader')
		.elements()
		.filter(cell => /unclear/i.test(cell.textContent ?? ''));
	expect(unclearHeaders.map(cell => cell.textContent?.trim())).toEqual(['UNCLEAR']);
	const note = page.getByText('Undecided counts places');
	await expect
		.element(note)
		.toHaveTextContent("Undecided counts places where a source decision hasn't been made yet.");
	expect(note.element().textContent).not.toMatch(/unclear/i);
});

it('shows each witness reading in find relatives', async () => {
	render(CbgmCoherenceTable, { table: relatives });
	await expect.element(page.getByRole('columnheader', { name: 'READING' })).toBeVisible();
	expect(cellUnder('READING')).toBe('b');
});

it('omits the undecided note when no unit is undecided', async () => {
	render(CbgmCoherenceTable, {
		table: { ...compare, rows: [{ ...row, uncl: 3, undecided: 0 }] },
	});
	await expect.element(page.getByRole('columnheader', { name: 'UNCLEAR' })).toBeVisible();
	expect(cellUnder('UNCLEAR')).toBe('3');
	await expect.element(page.getByText('Undecided counts places')).not.toBeInTheDocument();
});
