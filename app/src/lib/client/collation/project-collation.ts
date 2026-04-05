import { Project } from '$generated/models/Project';
import { ProjectTranscription } from '$generated/models/ProjectTranscription';
import { Transcription } from '$generated/models/Transcription';
import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
import { coerceTranscriptionDocument } from '$lib/client/transcription/content';
import { getPreferredTranscriptionLabel } from '$lib/client/transcription/display';
import type { CorrectionReading, TranscriptionDocument } from '@apatopwa/tei-transcription';
import { createProjectCollationSettings } from './project-settings';

export interface ProjectTranscriptionHandOption {
	id: string;
	label: string;
	kind: 'firsthand' | 'corrector';
	isBaseHand: boolean;
}

export interface ProjectOption {
	id: string;
	name: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectRecord extends ProjectOption {
	charter: string;
	collationSettings: unknown;
	ownerId: number | null;
}

export interface ProjectTranscriptionOption {
	id: string;
	siglum: string;
	displayLabel: string;
	title: string;
	description: string;
	hands: ProjectTranscriptionHandOption[];
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

function collectDocumentHandOptions(document: TranscriptionDocument | null): ProjectTranscriptionHandOption[] {
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
		.map((handId) => ({
			id: handId,
			label: handId,
			kind: handId === baseHand ? 'firsthand' : 'corrector',
			isBaseHand: handId === baseHand,
		}));
}

export async function listProjects(): Promise<ProjectOption[]> {
	await ensureDjazzkitRuntime();
	const rows = await Project.objects
		.filter((fields) => fields._djazzkit_deleted.eq(false))
		.orderBy((fields) => fields.updated_at, 'desc')
		.all();
	return rows.map((row) => ({
		id: row._djazzkit_id,
		name: row.name,
		description: row.description,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}));
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
	await ensureDjazzkitRuntime();
	const row = await Project.objects
		.filter((fields) => fields._djazzkit_id.eq(projectId))
		.filter((fields) => fields._djazzkit_deleted.eq(false))
		.first();
	if (!row) return null;
	return {
		id: row._djazzkit_id,
		name: row.name,
		description: row.description,
		charter: row.charter,
		collationSettings: row.collation_settings,
		ownerId: row.owner_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function createProjectRecord(input: {
	name: string;
	description?: string;
}): Promise<string> {
	await ensureDjazzkitRuntime();
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	await Project.objects.create({
		_djazzkit_id: id,
		_djazzkit_rev: 0,
		_djazzkit_deleted: false,
		_djazzkit_updated_at: now,
		name: input.name.trim(),
		description: input.description?.trim() ?? '',
		charter: '',
		collation_settings: JSON.stringify(
			createProjectCollationSettings([], {
				ignoreWordBreaks: false,
				lowercase: false,
				ignoreTokenWhitespace: true,
				ignorePunctuation: false,
				suppliedTextMode: 'clear',
				segmentation: true,
				transcriptionWitnessTreatments: new Map(),
				transcriptionWitnessExcludedHands: new Map(),
			}),
		),
		owner_id: null,
		created_at: now,
		updated_at: now,
	});
	return id;
}

export async function updateProjectMetadata(
	projectId: string,
	updates: {
		name?: string;
		description?: string;
	},
): Promise<void> {
	await ensureDjazzkitRuntime();
	const now = new Date().toISOString();
	const payload: Record<string, unknown> = {
		_djazzkit_updated_at: now,
		updated_at: now,
	};
	if (updates.name !== undefined) payload.name = updates.name.trim();
	if (updates.description !== undefined) payload.description = updates.description.trim();
	await Project.objects.update(projectId, payload);
}

export async function listTranscriptions(): Promise<ProjectTranscriptionOption[]> {
	await ensureDjazzkitRuntime();
	const rows = await Transcription.objects
		.filter((fields) => fields._djazzkit_deleted.eq(false))
		.all();
	return rows
		.map((row) => {
			const document = coerceTranscriptionDocument(row.content_json);
			const displayLabel = getPreferredTranscriptionLabel({
				document,
				siglum: row.siglum,
				fallbackId: row._djazzkit_id,
			});
			return {
				id: row._djazzkit_id,
				siglum: row.siglum,
				displayLabel,
				title: row.title,
				description: row.description,
				hands: collectDocumentHandOptions(document),
			};
		})
		.sort((a, b) =>
			a.displayLabel.localeCompare(b.displayLabel, undefined, { sensitivity: 'base', numeric: true }),
		);
}

export async function getProjectTranscriptionIds(projectId: string): Promise<string[]> {
	await ensureDjazzkitRuntime();
	const rows = await ProjectTranscription.objects
		.filter((fields) => fields.project.eq(projectId))
		.filter((fields) => fields._djazzkit_deleted.eq(false))
		.all();
	return rows.map((row) => row.transcription_id);
}

export async function syncProjectTranscriptionIds(
	projectId: string,
	nextIds: string[],
): Promise<void> {
	await ensureDjazzkitRuntime();
	const existing = await ProjectTranscription.objects
		.filter((fields) => fields.project.eq(projectId))
		.all();
	const activeByTranscriptionId = new Map(
		existing
			.filter((row) => !row._djazzkit_deleted)
			.map((row) => [row.transcription_id, row] as const),
	);
	const deletedByTranscriptionId = new Map(
		existing
			.filter((row) => row._djazzkit_deleted)
			.map((row) => [row.transcription_id, row] as const),
	);
	const nextIdSet = new Set(nextIds);
	const now = new Date().toISOString();

	for (const row of activeByTranscriptionId.values()) {
		if (nextIdSet.has(row.transcription_id)) continue;
		await ProjectTranscription.objects.update(row._djazzkit_id, {
			_djazzkit_deleted: true,
			_djazzkit_updated_at: now,
		});
	}

	for (const transcriptionId of nextIdSet) {
		if (activeByTranscriptionId.has(transcriptionId)) continue;
		const deleted = deletedByTranscriptionId.get(transcriptionId);
		if (deleted) {
			await ProjectTranscription.objects.update(deleted._djazzkit_id, {
				_djazzkit_deleted: false,
				_djazzkit_updated_at: now,
			});
			continue;
		}
		await ProjectTranscription.objects.create({
			_djazzkit_id: crypto.randomUUID(),
			_djazzkit_rev: 0,
			_djazzkit_deleted: false,
			_djazzkit_updated_at: now,
			project_id: projectId,
			transcription_id: transcriptionId,
			added_at: now,
			added_by_id: null,
		});
	}
}
