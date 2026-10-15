import type { CbgmComputationProgress, ComputationPhase } from './cbgm-scheduler.svelte';

type WaitingComputation = { analysisId: string; phase: ComputationPhase };

export type CbgmAnalysisComputation =
	| { state: 'queued'; phase: ComputationPhase; position: number }
	| (CbgmComputationProgress & { state: 'running' | 'paused' | 'writing' });

export function isComputing(progress: CbgmComputationProgress | null): boolean {
	return progress?.state === 'running' || progress?.state === 'writing';
}

export function activeComputation(
	progress: CbgmComputationProgress | null
): CbgmComputationProgress | null {
	return progress && progress.state !== 'done' && progress.state !== 'failed' ? progress : null;
}

export function analysisComputation(
	progress: CbgmComputationProgress | null,
	queue: readonly WaitingComputation[],
	analysisId: string
): CbgmAnalysisComputation | null {
	const active = activeComputation(progress);
	if (active?.analysisId === analysisId && active.state !== 'queued') {
		return active as CbgmAnalysisComputation;
	}
	const waiting = [...(active?.state === 'queued' ? [active] : []), ...queue];
	const position = waiting.findIndex(entry => entry.analysisId === analysisId);
	return position === -1
		? null
		: { state: 'queued', phase: waiting[position].phase, position: position + 1 };
}
