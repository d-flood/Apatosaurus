import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

import {
	buildLegacyTranscriptionRedirectTarget,
	readLastOpenedProjectId,
} from '$lib/shell/last-opened-project';
import { listProjects } from '$lib/db/client';

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
