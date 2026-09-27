import { redirect } from '@sveltejs/kit';

import {
	buildLastOpenedProjectSectionTarget,
	readLastOpenedProjectId,
	recordLastOpenedProject,
	type ProjectSection,
} from '$lib/shell/last-opened-project';
import { getProject, listProjects } from '$lib/db/client';

export const ssr = false;

export const load = async ({ params, url }: { params: { id: string }; url: URL }) => {
	const project = await getProject(params.id);
	if (!project) {
		const projects = await listProjects();
		redirect(
			302,
			buildLastOpenedProjectSectionTarget(
				readLastOpenedProjectId(),
				projects,
				readSection(url.pathname)
			)
		);
	}

	recordLastOpenedProject(project.id);
	return { project };
};

function readSection(pathname: string): ProjectSection {
	const section = pathname.split('/').filter(Boolean).at(-1);
	if (
		section === 'collations' ||
		section === 'settings' ||
		section === 'backup' ||
		section === 'transcriptions'
	) {
		return section;
	}
	return 'transcriptions';
}
