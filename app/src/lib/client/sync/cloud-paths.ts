import { projectRelativePaths, type ProjectRelativePaths } from '$lib/client/store/layout';

export type ProjectCloudPaths = ProjectRelativePaths;

export function projectCloudRootPath(projectId: string): string {
	return `Apatosaurus/Projects/${projectId}`;
}

export function projectRelativeCloudPaths(): ProjectCloudPaths {
	return projectRelativePaths();
}
