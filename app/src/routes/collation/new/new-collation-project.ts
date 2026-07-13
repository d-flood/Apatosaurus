interface NewCollationProjectDependencies {
	ensureDefaultProject: () => Promise<string>;
	selectProject: (projectId: string) => Promise<void>;
}

export async function selectInitialCollationProject(
	requestedProjectId: string | null,
	dependencies: NewCollationProjectDependencies
): Promise<void> {
	const projectId = requestedProjectId || (await dependencies.ensureDefaultProject());
	await dependencies.selectProject(projectId);
}
