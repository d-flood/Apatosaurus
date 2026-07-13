import { describe, expect, it, vi } from 'vitest';

import { selectInitialCollationProject } from './new-collation-project';

describe('/collation/new project selection', () => {
	it('selects Default when the route has no project query parameter', async () => {
		const ensureDefaultProject = vi.fn().mockResolvedValue('default-project');
		const selectProject = vi.fn().mockResolvedValue(undefined);

		await selectInitialCollationProject(null, { ensureDefaultProject, selectProject });

		expect(ensureDefaultProject).toHaveBeenCalledOnce();
		expect(selectProject).toHaveBeenCalledWith('default-project');
	});

	it('selects the requested project without resolving Default', async () => {
		const ensureDefaultProject = vi.fn().mockResolvedValue('default-project');
		const selectProject = vi.fn().mockResolvedValue(undefined);

		await selectInitialCollationProject('project-1', { ensureDefaultProject, selectProject });

		expect(ensureDefaultProject).not.toHaveBeenCalled();
		expect(selectProject).toHaveBeenCalledWith('project-1');
	});
});
