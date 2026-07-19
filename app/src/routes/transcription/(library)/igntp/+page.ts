import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

import { listProjects } from '$lib/client/collation/project-collation';
import {
	buildLegacyTranscriptionRedirectTarget,
	readLastOpenedProjectId,
} from '$lib/client/navigation/last-opened-project';

export const ssr = false;

export const load: PageLoad = ({ url }) => {
	const projectId = url.searchParams.get('projectId');
	if (projectId) return { projectId };
	return redirectWithoutProject();
};

async function redirectWithoutProject(): Promise<never> {
	const projects = await listProjects();
	redirect(302, buildLegacyTranscriptionRedirectTarget(readLastOpenedProjectId(), projects));
}
