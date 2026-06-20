export interface ProjectCloudPaths {
	project: string;
	transcriptions: (projectTranscriptionId: string) => string;
	collations: (collationId: string) => string;
	transcriptionHistory: (projectTranscriptionId: string, checkpointId: string) => string;
	collationHistory: (collationId: string, checkpointId: string) => string;
	tombstones: (tombstoneId: string) => string;
}

export function projectCloudRootPath(projectId: string): string {
	return `Apatosaurus/Projects/${projectId}`;
}

export function projectRelativeCloudPaths(): ProjectCloudPaths {
	return {
		project: 'project.json',
		transcriptions: projectTranscriptionId => `transcriptions/${projectTranscriptionId}.json`,
		collations: collationId => `collations/${collationId}.json`,
		transcriptionHistory: (projectTranscriptionId, checkpointId) =>
			`history/transcriptions/${projectTranscriptionId}/${checkpointId}.json`,
		collationHistory: (collationId, checkpointId) =>
			`history/collations/${collationId}/${checkpointId}.json`,
		tombstones: tombstoneId => `tombstones/${tombstoneId}.json`,
	};
}
