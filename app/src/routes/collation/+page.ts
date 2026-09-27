import { redirect } from '@sveltejs/kit';

import {
	buildLegacyCollationRedirectTarget,
	readLastOpenedProjectId,
} from '$lib/shell/last-opened-project';
import { listProjects } from '$lib/db/client';

export const ssr = false;

export const load = async () => {
	const projects = await listProjects();
	redirect(302, buildLegacyCollationRedirectTarget(readLastOpenedProjectId(), projects));
};
