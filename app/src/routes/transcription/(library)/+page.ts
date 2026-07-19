import { redirect } from '@sveltejs/kit';

import { listProjects } from '$lib/client/collation/project-collation';
import {
	buildLegacyTranscriptionRedirectTarget,
	readLastOpenedProjectId,
} from '$lib/client/navigation/last-opened-project';

export const ssr = false;

export const load = async () => {
	const projects = await listProjects();
	redirect(302, buildLegacyTranscriptionRedirectTarget(readLastOpenedProjectId(), projects));
};
