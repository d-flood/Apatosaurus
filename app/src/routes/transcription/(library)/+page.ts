import { redirect } from '@sveltejs/kit';

import {
	buildLegacyTranscriptionRedirectTarget,
	readLastOpenedProjectId,
} from '$lib/shell/last-opened-project';
import { listProjects } from '$lib/db/client';

export const ssr = false;

export const load = async () => {
	const projects = await listProjects();
	redirect(302, buildLegacyTranscriptionRedirectTarget(readLastOpenedProjectId(), projects));
};
