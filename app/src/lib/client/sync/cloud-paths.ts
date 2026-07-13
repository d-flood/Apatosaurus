import {
	collationCheckpointRelativeFile,
	collationPrimaryRelativeFile,
	projectManifestRelativeFile,
	tombstoneRelativeFile,
	transcriptionCheckpointRelativeFile,
	transcriptionPrimaryRelativeFile,
} from '$lib/client/store/layout';

export interface ProjectCloudPaths {
	project: string;
	transcriptions: (projectTranscriptionId: string) => string;
	collations: (collationId: string) => string;
	transcriptionHistory: (projectTranscriptionId: string, checkpointId: string) => string;
	collationHistory: (collationId: string, checkpointId: string) => string;
	tombstones: (entityType: string, entityId: string) => string;
}

export function projectCloudRootPath(projectId: string): string {
	return `Apatosaurus/Projects/${projectId}`;
}

export function projectRelativeCloudPaths(): ProjectCloudPaths {
	return {
		project: projectManifestRelativeFile(),
		transcriptions: transcriptionPrimaryRelativeFile,
		collations: collationPrimaryRelativeFile,
		transcriptionHistory: transcriptionCheckpointRelativeFile,
		collationHistory: collationCheckpointRelativeFile,
		tombstones: tombstoneRelativeFile,
	};
}
