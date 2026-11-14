import React from 'react';
import { Composition } from 'remotion';
import { Demo } from './Video';
import { FPS, W, H, totalFrames } from './edit';

export const Root: React.FC = () => (
	<Composition
		id="Demo"
		component={Demo}
		durationInFrames={totalFrames}
		fps={FPS}
		width={W}
		height={H}
	/>
);
