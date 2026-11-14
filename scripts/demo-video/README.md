# Collation demo video

Records the real app walking Romans 8:28 from Setup to Review, then edits it with Remotion.
Requires pnpm, uv (for ffmpeg and numpy) and a GPU-capable Chromium from Playwright.

```sh
cd app && pnpm run build && cd ../scripts/demo-video
pnpm install
./take.sh <take> <port>      # fresh profile; imports 11 IGNTP witnesses off-camera
node assemble.mjs <take>     # CFR video/public/screen.mp4 + timeline.json
./render.sh out/demo.mp4     # music timed to the outro, then the Remotion render
./sheets.sh out/demo.mp4 review 5 15 25 35 45 55   # contact sheets for review
```

`video/src/edit.ts` keys clips, camera moves and captions to marks the recorder logs, so a re-take
needs no re-edit unless the flow changes.
