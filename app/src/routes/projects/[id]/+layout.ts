import { redirect } from '@sveltejs/kit';

import {
	buildLastOpenedProjectSectionTarget,
	readLastOpenedProjectId,
	recordLastOpenedProject,
	type ProjectSection,
} from '$lib/shell/last-opened-project';
import {
	convertProjectToTei,
	getProject,
	listProjects,
	refreshChangedDocumentFiles,
} from '$lib/db/client';
import { notificationCenter } from '$lib/shell/notification-center.svelte';

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
	void convertProjectToTei(project.id).then(
		report => {
			if (report.status !== 'failed' || !report.failure) return;
			notificationCenter.upsert({
				id: `tei-conversion:${project.id}`,
				title: 'Project not converted to TEI',
				message: `${report.failure.entity} (${report.failure.path}) could not be converted: ${report.failure.difference} The project was left unchanged.`,
				tone: 'warning',
				persistent: true,
			});
		},
		error => console.error('[project] converting the project to TEI failed', error)
	);
	void refreshChangedDocumentFiles(project.id).catch(error =>
		console.error('[project] checking files changed outside the app failed', error)
	);
	return { project };
};

function readSection(pathname: string): ProjectSection {
	const section = pathname.split('/').filter(Boolean).at(-1);
	if (
		section === 'collations' ||
		section === 'cbgm' ||
		section === 'settings' ||
		section === 'location' ||
		section === 'transcriptions'
	) {
		return section;
	}
	return 'transcriptions';
}
