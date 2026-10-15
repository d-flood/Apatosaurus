import type { CbgmCoherenceState, CbgmGlobalStemmaState } from '$lib/storage/formats';
import type { ComputationPhase, ComputationState } from './cbgm-scheduler.svelte';

const coherenceLabels: Record<CbgmCoherenceState, string> = {
	computing: 'Computing',
	'awaiting-import': 'Awaiting import',
	ready: 'Ready',
	failed: 'Failed',
};

const coherenceBadges: Record<CbgmCoherenceState, string> = {
	computing: 'badge-info',
	'awaiting-import': 'badge-ghost',
	ready: 'badge-success',
	failed: 'badge-error',
};

const globalStemmaLabels: Record<CbgmGlobalStemmaState, string> = {
	none: 'No global stemma',
	computing: 'Global stemma computing',
	ready: 'Global stemma ready',
	'imported-dot': 'Global stemma imported',
};

const phaseLabels: Record<ComputationPhase, string> = {
	coherence: 'Coherence',
	'global-stemma': 'Global stemma',
};

const computationStateLabels: Record<ComputationState, string> = {
	queued: 'Queued',
	running: 'Running',
	paused: 'Paused',
	writing: 'Writing',
	done: 'Done',
	failed: 'Failed',
};

export function phaseLabel(phase: ComputationPhase): string {
	return phaseLabels[phase];
}

export function computationStateLabel(state: ComputationState): string {
	return computationStateLabels[state];
}

export function coherenceLabel(state: string): string {
	return coherenceLabels[state as CbgmCoherenceState] ?? state;
}

export function coherenceBadge(state: string): string {
	return coherenceBadges[state as CbgmCoherenceState] ?? 'badge-ghost';
}

export function globalStemmaLabel(state: string): string {
	return globalStemmaLabels[state as CbgmGlobalStemmaState] ?? state;
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function undecidedReadingsLabel(count: number): string {
	return `${countLabel(count, 'reading')} with undecided sources`;
}

export function formatAnalysisTime(value: string | null): string {
	return value ? new Date(value).toLocaleString() : 'Not yet';
}
