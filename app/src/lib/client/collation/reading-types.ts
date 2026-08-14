/**
 * The reading-type vocabulary: evidential qualifiers a reading carries on its own, without
 * reference to any other reading, plus the orthogonal certainty axis.
 */

/** Open vocabulary: a project may record a value the bundled list does not carry. */
export type ReadingTypeId = string;

/** TEI `@cert` values, or a probability. */
export type Certainty = 'high' | 'medium' | 'low' | 'unknown' | number;

export interface ReadingTypeDefinition {
	id: ReadingTypeId;
	label: string;
	description: string;
	/**
	 * Whether a scholar may choose it. Facts the aligner determines — omission above all — are
	 * reported on a reading but never picked from a menu.
	 */
	selectable: boolean;
}

export const CERTAINTY_LEVELS = ['high', 'medium', 'low', 'unknown'] as const;

export const BUNDLED_READING_TYPES: readonly ReadingTypeDefinition[] = [
	{
		id: 'omission',
		label: 'Omission',
		description: 'The witnesses attest the absence of text. Determined by the alignment.',
		selectable: false,
	},
	{
		id: 'deficient',
		label: 'Deficient',
		description: 'Damage or illegibility leaves the reading only partly identifiable.',
		selectable: true,
	},
	{
		id: 'apparent',
		label: 'Apparent',
		description: 'The witnesses only appear to read this.',
		selectable: true,
	},
	{
		id: 'nonsense',
		label: 'Nonsense',
		description: 'Not meaningful Greek.',
		selectable: true,
	},
	{
		id: 'orthographic',
		label: 'Orthographic',
		description: 'Differs from its main reading only in spelling.',
		selectable: true,
	},
];

/**
 * The bundled vocabulary extended by a project's own values. A project entry sharing a bundled
 * id replaces it, so a project can relabel a standard type without forking the list.
 */
export function resolveReadingTypeVocabulary(
	projectReadingTypes: readonly ReadingTypeDefinition[] = []
): ReadingTypeDefinition[] {
	const byId = new Map(BUNDLED_READING_TYPES.map(type => [type.id, type] as const));
	for (const type of projectReadingTypes) byId.set(type.id, type);
	return [...byId.values()];
}

export function findReadingTypeDefinition(
	vocabulary: readonly ReadingTypeDefinition[],
	readingTypeId: ReadingTypeId | null
): ReadingTypeDefinition | null {
	if (readingTypeId === null) return null;
	return vocabulary.find(type => type.id === readingTypeId) ?? null;
}

export function coerceReadingTypeDefinitions(value: unknown): ReadingTypeDefinition[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap(entry => {
		if (!entry || typeof entry !== 'object') return [];
		const raw = entry as Record<string, unknown>;
		if (typeof raw.id !== 'string' || raw.id.trim().length === 0) return [];
		// A project may relabel a bundled type but never promote one the aligner determines into
		// the menu: omission is a fact about the text, not an editorial choice.
		const bundled = BUNDLED_READING_TYPES.find(type => type.id === raw.id);
		return [
			{
				id: raw.id,
				label: typeof raw.label === 'string' && raw.label ? raw.label : raw.id,
				description: typeof raw.description === 'string' ? raw.description : '',
				selectable: bundled ? bundled.selectable : raw.selectable !== false,
			},
		];
	});
}

/**
 * The type the evidence implies before any scholar has judged the reading. A recorded decision
 * always outranks it. Damage outranks a nonsense rule: text one cannot read is not yet nonsense.
 */
export function proposeReadingType(reading: {
	isOmission: boolean;
	hasUnclear: boolean;
	hasSupplied: boolean;
	regularizationTypes: readonly string[];
}): ReadingTypeId | null {
	if (reading.isOmission) return 'omission';
	if (reading.hasUnclear || reading.hasSupplied) return 'deficient';
	if (reading.regularizationTypes.includes('ns')) return 'nonsense';
	return null;
}
