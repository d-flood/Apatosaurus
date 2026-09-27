import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	buildLegacyCollationRedirectTarget,
	buildLegacyTranscriptionRedirectTarget,
	buildNavbarProjectTargets,
	buildProjectSwitcherTarget,
	readLastOpenedProjectId,
	recordLastOpenedProject,
	resolveLastOpenedProjectId,
} from './last-opened-project';

const projects = [
	{ id: 'project-a', updatedAt: '2026-01-01T00:00:00.000Z' },
	{ id: 'project-b', updatedAt: '2026-02-01T00:00:00.000Z' },
];

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('last-opened project resolution', () => {
	it('uses a stored id that still names a project', () => {
		expect(
			resolveLastOpenedProjectId('project-a', [
				{ id: 'project-a', updatedAt: '2026-01-01T00:00:00.000Z' },
				{ id: 'project-b', updatedAt: '2026-02-01T00:00:00.000Z' },
			])
		).toBe('project-a');
	});

	it('falls back from a stale stored id to the most recently updated project', () => {
		expect(
			resolveLastOpenedProjectId('deleted-project', [
				{ id: 'project-a', updatedAt: '2026-02-01T00:00:00.000Z' },
				{ id: 'project-b', updatedAt: '2026-03-01T00:00:00.000Z' },
				{ id: 'project-c', updatedAt: '2026-01-01T00:00:00.000Z' },
			])
		).toBe('project-b');
	});

	it('uses the most recently updated project when no id is stored', () => {
		expect(
			resolveLastOpenedProjectId(null, [
				{ id: 'project-a', updatedAt: '2026-04-01T00:00:00.000Z' },
				{ id: 'project-b', updatedAt: '2026-03-01T00:00:00.000Z' },
			])
		).toBe('project-a');
	});

	it('resolves to null when there are no projects', () => {
		expect(resolveLastOpenedProjectId('deleted-project', [])).toBeNull();
	});
});

describe('last-opened project storage', () => {
	it('records and reads the last-opened project in local storage', () => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		});

		recordLastOpenedProject('project-a');

		expect(readLastOpenedProjectId()).toBe('project-a');
	});

	it('is safe when imported and called without a browser environment', () => {
		expect(readLastOpenedProjectId()).toBeNull();
		expect(() => recordLastOpenedProject('project-a')).not.toThrow();
	});
});

describe('project navigation targets', () => {
	it('builds navbar targets from the resolved last-opened project', () => {
		expect(buildNavbarProjectTargets('project-a', projects)).toEqual({
			transcriptions: '/projects/project-a/transcriptions',
			collations: '/projects/project-a/collations',
		});
	});

	it('falls navbar targets back to the project picker when there are no projects', () => {
		expect(buildNavbarProjectTargets('deleted-project', [])).toEqual({
			transcriptions: '/projects',
			collations: '/projects',
		});
	});

	it('builds legacy redirect targets from the resolved last-opened project', () => {
		expect(buildLegacyTranscriptionRedirectTarget(null, projects)).toBe(
			'/projects/project-b/transcriptions'
		);
		expect(buildLegacyCollationRedirectTarget(null, projects)).toBe(
			'/projects/project-b/collations'
		);
	});

	it.each(['transcriptions', 'collations', 'settings', 'backup'] as const)(
		'keeps the %s section when switching projects',
		section => {
			expect(buildProjectSwitcherTarget(section, 'project-b')).toBe(
				`/projects/project-b/${section}`
			);
		}
	);
});
