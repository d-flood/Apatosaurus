export interface ProjectRecency {
	id: string;
	updatedAt: string;
}

export type ProjectSection = 'transcriptions' | 'collations' | 'settings' | 'backup';

const LAST_OPENED_PROJECT_STORAGE_KEY = 'lastOpenedProjectId';

export function readLastOpenedProjectId(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(LAST_OPENED_PROJECT_STORAGE_KEY);
}

export function recordLastOpenedProject(id: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(LAST_OPENED_PROJECT_STORAGE_KEY, id);
}

export function resolveLastOpenedProjectId(
	storedId: string | null,
	projects: readonly ProjectRecency[]
): string | null {
	if (storedId && projects.some(project => project.id === storedId)) return storedId;

	let mostRecentProject: ProjectRecency | null = null;
	for (const project of projects) {
		if (!mostRecentProject || project.updatedAt > mostRecentProject.updatedAt) {
			mostRecentProject = project;
		}
	}
	return mostRecentProject?.id ?? null;
}

export function resolveCreationTargetProjectId(
	queryProjectId: string | null | undefined,
	projects: readonly ProjectRecency[],
	defaultProjectId: string
): string {
	return (
		queryProjectId ||
		resolveLastOpenedProjectId(readLastOpenedProjectId(), projects) ||
		defaultProjectId
	);
}

export function buildLastOpenedProjectSectionTarget(
	storedId: string | null,
	projects: readonly ProjectRecency[],
	section: ProjectSection
): string {
	const projectId = resolveLastOpenedProjectId(storedId, projects);
	return projectId ? `/projects/${projectId}/${section}` : '/projects';
}

export function buildNavbarProjectTargets(
	storedId: string | null,
	projects: readonly ProjectRecency[]
): { transcriptions: string; collations: string } {
	return {
		transcriptions: buildLastOpenedProjectSectionTarget(storedId, projects, 'transcriptions'),
		collations: buildLastOpenedProjectSectionTarget(storedId, projects, 'collations'),
	};
}

export function buildLegacyTranscriptionRedirectTarget(
	storedId: string | null,
	projects: readonly ProjectRecency[]
): string {
	return buildLastOpenedProjectSectionTarget(storedId, projects, 'transcriptions');
}

export function buildLegacyCollationRedirectTarget(
	storedId: string | null,
	projects: readonly ProjectRecency[]
): string {
	return buildLastOpenedProjectSectionTarget(storedId, projects, 'collations');
}

export function buildProjectSwitcherTarget(
	currentSection: ProjectSection,
	targetProjectId: string
): string {
	return `/projects/${targetProjectId}/${currentSection}`;
}
