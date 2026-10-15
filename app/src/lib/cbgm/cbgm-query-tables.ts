import type {
	CompareWitnessesRow,
	CompareWitnessesTable,
	FindRelativesTable,
	OptimizeSubstemmataTable,
} from '@apatosaurus/open-cbgm-wasm';

export type QueryColumn<Row> = { header: string; value: (row: Row) => string };

type CoherenceRow = CompareWitnessesRow & { rdg?: string };

const coherenceColumns: QueryColumn<CoherenceRow>[] = [
	{ header: 'WITNESS', value: row => row.id },
	{ header: 'DIR', value: row => (row.dir === -1 ? '<' : row.dir === 1 ? '>' : '=') },
	{ header: 'NR', value: row => row.nr },
	{ header: 'READING', value: row => row.rdg ?? '' },
	{ header: 'PASS', value: row => String(row.pass) },
	{ header: 'EQ', value: row => String(row.eq) },
	{ header: '%', value: row => row.perc.toFixed(3) },
	{ header: 'PRIOR', value: row => String(row.prior) },
	{ header: 'POSTERIOR', value: row => String(row.posterior) },
	{ header: 'NOREL', value: row => String(row.norel) },
	{ header: 'UNCLEAR', value: row => String(row.uncl) },
	{ header: 'UNDECIDED', value: row => String(row.undecided) },
	{ header: 'EXPL', value: row => String(row.expl) },
	{ header: 'COST', value: row => row.cost },
];

export function coherenceTableColumns(
	table: CompareWitnessesTable | FindRelativesTable
): QueryColumn<CoherenceRow>[] {
	return 'primary_rdg' in table
		? coherenceColumns
		: coherenceColumns.filter(column => column.header !== 'READING');
}

export const substemmataColumns: QueryColumn<OptimizeSubstemmataTable['rows'][number]>[] = [
	{ header: 'ANCESTORS', value: row => row.ancestors.join(', ') },
	{ header: 'COST', value: row => String(row.cost) },
	{ header: 'AGREE', value: row => String(row.agreements) },
];

export function toCsv<Row>(columns: QueryColumn<Row>[], rows: Row[]): string {
	return [
		columns.map(column => column.header),
		...rows.map(row => columns.map(c => c.value(row))),
	]
		.map(cells => cells.map(csvCell).join(','))
		.join('\n')
		.concat('\n');
}

function csvCell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function resultFileStem(analysisName: string, tool: string, witness: string): string {
	return [analysisName, tool, witness].join('-').replace(/[\\/:*?"<>|\s]+/g, '-');
}
