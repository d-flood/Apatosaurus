export interface MetamarkFunctionOption {
	value: string;
	label: string;
}

// The IGNTP schema documents examples rather than a closed enumeration.
// This curated list combines the guideline examples with values already used
// in this repo's fixtures, tests, and editor affordances.
export const METAMARK_FUNCTION_OPTIONS: MetamarkFunctionOption[] = [
	{ value: 'insertion', label: 'Insertion' },
	{ value: 'deletion', label: 'Deletion' },
	{ value: 'transposition', label: 'Transposition' },
	{ value: 'status', label: 'Status' },
	{ value: 'omission', label: 'Omission' },
	{ value: 'reference', label: 'Reference' },
	{ value: 'diple', label: 'Diple' },
	{ value: 'paragraphus', label: 'Paragraphus' },
];

