import { createProjectCollationSettings } from '$lib/collation/project-settings';
import { createProject, listProjectTranscriptionOptions } from '$lib/db/client';
import type { ProjectTranscriptionOption as LocalProjectTranscriptionOption } from '$lib/db/repositories/projects';

export type { ProjectTranscriptionHandOption } from '$lib/transcription/hands';
export type ProjectTranscriptionOption = LocalProjectTranscriptionOption;

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
			readingTypes: [],
		}),
	});
}

export async function listTranscriptions(
	projectId?: string
): Promise<ProjectTranscriptionOption[]> {
	return listProjectTranscriptionOptions(projectId);
}
