export interface OnboardingGuidanceContent {
	heading: string;
	intro: string;
	steps: string[];
	dataOwnership: string[];
}

export const ONBOARDING_GUIDANCE: OnboardingGuidanceContent = {
	heading: 'Keep your projects safe',
	intro: 'Sign in with Google Drive or Dropbox. Every project backs up as you work and opens on any computer you sign in from.',
	steps: ['Sign in with Google Drive or Dropbox'],
	dataOwnership: [
		'Project files live in a working copy on this device, inside Apatosaurus project folders.',
		'Each project syncs to its location as an exact copy.',
		'Every transcription and collation is also saved as TEI.',
		'Leave anytime with your location or a zip export.',
	],
};
