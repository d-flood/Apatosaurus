import type { AlignmentSnapshot } from './alignment-snapshot';
import type {
	AlignmentCellKind,
	GapMetadata,
	RegularizationType,
	WitnessTextSegment,
} from './collation-types';

export interface CollationTokenInput {
	t: string;
	n: string;
	sourceTokenIds?: string[];
	kind?: Exclude<AlignmentCellKind, 'omission'>;
	displayRegularized?: string | null;
	originalSegments?: WitnessTextSegment[];
	gap?: GapMetadata | null;
	hasUnclear?: boolean;
	isPunctuation?: boolean;
	isSupplied?: boolean;
	ruleIds?: string[];
	regularizationTypes?: RegularizationType[];
}

export interface CollationWitnessInput {
	id: string;
	content: string;
	tokens?: CollationTokenInput[];
}

export interface CollationRunOptions {
	segmentation?: boolean;
}

export interface CollationRunPayload {
	witnesses: CollationWitnessInput[];
	options?: CollationRunOptions;
}

export interface CollationRunResult {
	snapshot: AlignmentSnapshot;
}

export type WorkerIncomingMessage = {
	type: 'collate';
	requestId: string;
	payload: CollationRunPayload;
};

export type WorkerOutgoingMessage =
	| { type: 'result'; requestId: string; result: CollationRunResult }
	| { type: 'error'; requestId: string; error: string };
