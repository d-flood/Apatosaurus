/** Open vocabulary: projects may record values outside the bundled list. */
export type ReadingTypeId = string;

export type Certainty = 'high' | 'medium' | 'low' | 'unknown' | number;

export interface ReadingTypeDefinition {
	id: ReadingTypeId;
	label: string;
	description: string;
	/** Aligner-determined facts are reported, never picked from a menu. */
	selectable: boolean;
	/** Empty when no subreading can carry the type. */
	suffix: string;
}

export const CERTAINTY_LEVELS = ['high', 'medium', 'low', 'unknown'] as const;

export const BUNDLED_READING_TYPES: readonly ReadingTypeDefinition[] = [
	{
		id: 'omission',
		label: 'Omission',
		description: 'The witnesses attest the absence of text. Determined by the alignment.',
		selectable: false,
		suffix: '',
	},
	{
		id: 'deficient',
		label: 'Deficient',
		description: 'Damage or illegibility leaves the reading only partly identifiable.',
		selectable: true,
		suffix: 'd',
	},
	{
		id: 'apparent',
		label: 'Apparent',
		description: 'The witnesses only appear to read this.',
		selectable: true,
		suffix: 'v',
	},
	{
		id: 'nonsense',
		label: 'Nonsense',
		description: 'Not meaningful Greek.',
		selectable: true,
		suffix: 'f',
	},
	{
		id: 'orthographic',
		label: 'Orthographic',
		description: 'Differs from its main reading only in spelling.',
		selectable: true,
		suffix: 'o',
	},
];

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

export function findReadingTypeSuffix(
	vocabulary: readonly ReadingTypeDefinition[],
	readingTypeId: ReadingTypeId | null
): string | null {
	return findReadingTypeDefinition(vocabulary, readingTypeId)?.suffix || null;
}

export function readingTypeSuffixProblem(
	suffix: unknown,
	vocabulary: readonly ReadingTypeDefinition[]
): string | null {
	if (typeof suffix !== 'string' || suffix === '') return 'Choose a suffix.';
	if (!/^[a-z]$/.test(suffix)) return 'A suffix is a single lowercase letter.';
	const owner = vocabulary.find(type => type.suffix === suffix);
	return owner ? `${owner.label} already uses ${suffix}.` : null;
}

export function coerceReadingTypeDefinitions(value: unknown): ReadingTypeDefinition[] {
	if (!Array.isArray(value)) return [];
	const accepted: ReadingTypeDefinition[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue;
		const raw = entry as Record<string, unknown>;
		if (typeof raw.id !== 'string' || raw.id.trim().length === 0) continue;
		// Omission is textual fact, not editorial choice.
		const bundled = BUNDLED_READING_TYPES.find(type => type.id === raw.id);
		if (
			!bundled &&
			readingTypeSuffixProblem(raw.suffix, [...BUNDLED_READING_TYPES, ...accepted]) !== null
		)
			continue;
		accepted.push({
			id: raw.id,
			label: typeof raw.label === 'string' && raw.label ? raw.label : raw.id,
			description: typeof raw.description === 'string' ? raw.description : '',
			selectable: bundled ? bundled.selectable : raw.selectable !== false,
			suffix: bundled ? bundled.suffix : (raw.suffix as string),
		});
	}
	return accepted;
}

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
