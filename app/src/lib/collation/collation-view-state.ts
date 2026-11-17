import {
	COLLATION_PHASES,
	type AlignmentDisplayMode,
	type AlignmentLayout,
	type CollationPhase,
} from './collation-types';

export type CollationViewState = {
	phase: CollationPhase;
	alignmentDisplayMode: AlignmentDisplayMode;
	alignmentLayout: AlignmentLayout;
};

const STORAGE_PREFIX = 'apatosaurus:collation-view:';

/** Unknown phases come from newer builds, so clamp instead of resetting progress. */
export function normalizePhase(value: unknown): CollationPhase {
	if (value === 'regularization') return 'alignment';
	if (COLLATION_PHASES.includes(value as CollationPhase)) return value as CollationPhase;
	return typeof value === 'string' ? 'review' : 'setup';
}

export function normalizeViewState(value: {
	phase?: unknown;
	alignmentDisplayMode?: unknown;
	alignmentLayout?: unknown;
}): CollationViewState {
	return {
		phase: normalizePhase(value.phase),
		alignmentDisplayMode:
			value.alignmentDisplayMode === 'original' ? 'original' : 'regularized',
		alignmentLayout: value.alignmentLayout === 'variation-units' ? 'variation-units' : 'grid',
	};
}

export function defaultCollationViewState(hasAlignment: boolean): CollationViewState {
	return {
		phase: hasAlignment ? 'alignment' : 'setup',
		alignmentDisplayMode: 'regularized',
		alignmentLayout: 'grid',
	};
}

export function readCollationViewState(collationId: string): CollationViewState | null {
	try {
		const stored = localStorage.getItem(STORAGE_PREFIX + collationId);
		if (stored === null) return null;
		const value: unknown = JSON.parse(stored);
		return value && typeof value === 'object' ? normalizeViewState(value) : null;
	} catch {
		return null;
	}
}

export function writeCollationViewState(collationId: string, state: CollationViewState): void {
	try {
		localStorage.setItem(STORAGE_PREFIX + collationId, JSON.stringify(state));
	} catch {
		// Storage is unavailable or full; the URL still shows the phase.
	}
}
