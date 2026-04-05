interface DuplicateKeySource {
	siglum?: string | null;
	title?: string | null;
}

export function normalizeTranscriptionDuplicateValue(value: string): string {
	return value.trim().toLocaleLowerCase();
}

export function buildTranscriptionDuplicateKey(source: DuplicateKeySource): string | null {
	const candidate = source.siglum?.trim() || source.title?.trim() || '';
	if (!candidate) return null;
	return normalizeTranscriptionDuplicateValue(candidate);
}
