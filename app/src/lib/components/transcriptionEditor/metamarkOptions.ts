export interface MetamarkFunctionOption {
	value: string;
	label: string;
}

// IGNTP schema gives examples, not a closed list.
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
