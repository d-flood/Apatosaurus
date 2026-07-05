import { coerceTranscriptionDocument } from '$lib/client/transcription/content';
import type { CorrectionReading, TranscriptionDocument } from '$lib/tei/tei-transcription';
import { createProjectCollationSettings } from './project-settings';
import {
	createProject,
	getCollationVersionStatus as getLocalCollationVersionStatus,
	getProject as getLocalProject,
	getProjectTranscriptionStatus as getLocalProjectTranscriptionStatus,
	getProjectTranscriptionStatusForOwnedTranscription as getLocalProjectTranscriptionStatusForOwnedTranscription,
	getProjectTranscriptionIds as getLocalProjectTranscriptionIds,
	listProjectCollationVersionStatuses as listLocalProjectCollationVersionStatuses,
	listProjects as listLocalProjects,
	listProjectTranscriptionOptions,
	listProjectTranscriptionStatuses as listLocalProjectTranscriptionStatuses,
	listProjectTranscriptionSourceCandidates as listLocalProjectTranscriptionSourceCandidates,
	listCommittedTranscriptionCheckpoints as listLocalCommittedTranscriptionCheckpoints,
	loadProjectTranscriptionContent,
	addProjectTranscriptionFromProject as addLocalProjectTranscriptionFromProject,
	refreshProjectTranscription as refreshLocalProjectTranscription,
	syncProjectTranscriptionIds as syncLocalProjectTranscriptionIds,
	updateProjectMetadata as updateLocalProjectMetadata,
} from '$lib/client/db/client';
import type {
	ProjectOption,
	ProjectRecord,
	ProjectTranscriptionOption as LocalProjectTranscriptionOption,
	ProjectTranscriptionStatusOptions,
	ProjectTranscriptionSourceCandidate,
	AddProjectTranscriptionFromProjectInput,
	RefreshProjectTranscriptionInput,
} from '$lib/client/db/repositories/projects';
import type { CollationVersionStatusOptions } from '$lib/client/db/repositories/collations';
import type { TranscriptionCheckpointSummary } from '$lib/client/db/repositories/revisions';

export interface ProjectTranscriptionHandOption {
	id: string;
	label: string;
	kind: 'firsthand' | 'corrector';
	isBaseHand: boolean;
}

export type { ProjectOption, ProjectRecord } from '$lib/client/db/repositories/projects';
export type {
	ProjectTranscriptionStatus,
	ProjectTranscriptionStatusOptions,
	ProjectTranscriptionSourceState,
} from '$lib/client/db/repositories/projects';
export type { RefreshProjectTranscriptionInput } from '$lib/client/db/repositories/projects';
export type {
	AddProjectTranscriptionFromProjectInput,
	ProjectTranscriptionSourceCandidate,
} from '$lib/client/db/repositories/projects';
export type { TranscriptionCheckpointSummary } from '$lib/client/db/repositories/revisions';
export type {
	CollationVersionStatus,
	CollationVersionStatusOptions,
} from '$lib/client/db/repositories/collations';

export interface ProjectTranscriptionOption extends LocalProjectTranscriptionOption {
	id: string;
	siglum: string;
	displayLabel: string;
	title: string;
	description: string;
	hands: ProjectTranscriptionHandOption[];
}

const PROJECT_COLLATION_LOG_PREFIX = '[project-collation]';

function nowMs(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function logProjectCollation(message: string, details?: Record<string, unknown>) {
	if (details && Object.keys(details).length > 0) {
		console.debug(`${PROJECT_COLLATION_LOG_PREFIX} ${message}`, details);
		return;
	}
	console.debug(`${PROJECT_COLLATION_LOG_PREFIX} ${message}`);
}

function normalizeHandRef(value: string | null | undefined): string {
	return (value || '').trim().replace(/^#/, '');
}

function inferBaseHand(document: TranscriptionDocument): string {
	const witnessIds = Array.isArray(document.header?.witnessIds)
		? document.header.witnessIds.map((value: string) => value.trim()).filter(Boolean)
		: [];
	const handIds = Array.isArray(document.header?.msDescription?.hands)
		? document.header.msDescription.hands
				.map((hand: any) => {
					const id = hand?.attrs?.['xml:id'] || hand?.attrs?.n || '';
					return id.trim();
				})
				.filter(Boolean)
		: [];
	const preferredWitness =
		witnessIds.find((id: string) => /firsthand/i.test(id)) ||
		witnessIds.find((id: string) => /base|main/i.test(id)) ||
		witnessIds.find((id: string) => !/correct/i.test(id));
	if (preferredWitness) return normalizeHandRef(preferredWitness);
	const preferredHand =
		handIds.find((id: string) => /firsthand/i.test(id)) ||
		handIds.find((id: string) => /first hand/i.test(id)) ||
		handIds.find((id: string) => !/correct/i.test(id));
	return normalizeHandRef(preferredHand || 'firsthand') || 'firsthand';
}

function collectCorrectionHandIds(corrections: CorrectionReading[] | undefined, into: Set<string>) {
	for (const correction of corrections || []) {
		const handId = normalizeHandRef(correction.hand);
		if (handId) into.add(handId);
	}
}

function collectDocumentHandOptions(
	document: TranscriptionDocument | null
): ProjectTranscriptionHandOption[] {
	if (!document) return [];
	const baseHand = inferBaseHand(document);
	const handIds = new Set<string>([baseHand]);
	for (const witnessId of document.header?.witnessIds || []) {
		const handId = normalizeHandRef(witnessId);
		if (handId) handIds.add(handId);
	}
	for (const hand of document.header?.msDescription?.hands || []) {
		const handId = normalizeHandRef(hand?.attrs?.['xml:id'] || hand?.attrs?.n || '');
		if (handId) handIds.add(handId);
	}
	for (const page of document.pages) {
		for (const column of page.columns) {
			for (const line of column.lines) {
				for (const item of line.items) {
					if (item.type === 'handShift') {
						const handId = normalizeHandRef(item.attrs.new || item.attrs.hand || '');
						if (handId) handIds.add(handId);
						continue;
					}
					if (item.type === 'text') {
						for (const mark of item.marks || []) {
							if (mark?.type === 'correction') {
								collectCorrectionHandIds(mark.attrs?.corrections, handIds);
							}
						}
						continue;
					}
					if (item.type === 'correctionOnly') {
						collectCorrectionHandIds(item.corrections, handIds);
					}
				}
			}
		}
	}
	return [...handIds]
		.sort((left, right) => {
			if (left === baseHand) return -1;
			if (right === baseHand) return 1;
			return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
		})
		.map(handId => ({
			id: handId,
			label: handId,
			kind: handId === baseHand ? 'firsthand' : 'corrector',
			isBaseHand: handId === baseHand,
		}));
}

export async function listProjects(): Promise<ProjectOption[]> {
	return listLocalProjects();
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
	return getLocalProject(projectId);
}

export async function createProjectRecord(input: {
	name: string;
	description?: string;
}): Promise<string> {
	return createProject({
		name: input.name.trim(),
		description: input.description?.trim() ?? '',
		charter: '',
		collationSettings: createProjectCollationSettings([], {
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
			transcriptionWitnessTreatments: new Map(),
			transcriptionWitnessExcludedHands: new Map(),
		}),
	});
}

export async function updateProjectMetadata(
	projectId: string,
	updates: {
		name?: string;
		description?: string;
		collationSettings?: unknown;
		updatedAt?: string;
	}
): Promise<void> {
	await updateLocalProjectMetadata({ projectId, ...updates });
}

export async function listTranscriptions(
	projectId?: string
): Promise<ProjectTranscriptionOption[]> {
	const queryStartedAt = nowMs();
	const rows = await listProjectTranscriptionOptions(projectId);
	const queryElapsedMs = nowMs() - queryStartedAt;
	const options = rows.map(row => ({ ...row, hands: [] as ProjectTranscriptionHandOption[] }));
	logProjectCollation('listTranscriptions completed', {
		projectId,
		rowCount: rows.length,
		queryElapsedMs,
	});
	return options;
}

export async function listProjectTranscriptionStatuses(
	projectId: string,
	options?: ProjectTranscriptionStatusOptions
) {
	return listLocalProjectTranscriptionStatuses(projectId, options);
}

export async function getProjectTranscriptionStatus(
	projectTranscriptionId: string,
	options?: ProjectTranscriptionStatusOptions
) {
	return getLocalProjectTranscriptionStatus(projectTranscriptionId, options);
}

export async function getProjectTranscriptionStatusForOwnedTranscription(
	projectOwnedTranscriptionId: string,
	options?: ProjectTranscriptionStatusOptions
) {
	return getLocalProjectTranscriptionStatusForOwnedTranscription(
		projectOwnedTranscriptionId,
		options
	);
}

export async function listProjectCollationVersionStatuses(
	projectId: string,
	options?: CollationVersionStatusOptions
) {
	return listLocalProjectCollationVersionStatuses(projectId, options);
}

export async function getCollationVersionStatus(
	collationId: string,
	options?: CollationVersionStatusOptions
) {
	return getLocalCollationVersionStatus(collationId, options);
}

export async function loadTranscriptionHands(
	transcriptionId: string
): Promise<ProjectTranscriptionHandOption[]> {
	const contentJson = await loadProjectTranscriptionContent(transcriptionId);
	if (!contentJson) return [];
	const document = coerceTranscriptionDocument(contentJson);
	return collectDocumentHandOptions(document);
}

export async function getProjectTranscriptionIds(projectId: string): Promise<string[]> {
	return getLocalProjectTranscriptionIds(projectId);
}

export async function syncProjectTranscriptionIds(
	projectId: string,
	nextIds: string[]
): Promise<string[]> {
	return syncLocalProjectTranscriptionIds(projectId, nextIds);
}

export async function refreshProjectTranscription(input: RefreshProjectTranscriptionInput) {
	return refreshLocalProjectTranscription(input);
}

export async function addProjectTranscriptionFromProject(
	input: AddProjectTranscriptionFromProjectInput
): Promise<{ projectTranscriptionId: string; projectOwnedTranscriptionId: string }> {
	return addLocalProjectTranscriptionFromProject(input);
}

export async function listProjectTranscriptionSourceCandidates(
	targetProjectId: string
): Promise<ProjectTranscriptionSourceCandidate[]> {
	return listLocalProjectTranscriptionSourceCandidates(targetProjectId);
}

export async function listCommittedTranscriptionCheckpoints(
	transcriptionId: string
): Promise<TranscriptionCheckpointSummary[]> {
	return listLocalCommittedTranscriptionCheckpoints(transcriptionId);
}
