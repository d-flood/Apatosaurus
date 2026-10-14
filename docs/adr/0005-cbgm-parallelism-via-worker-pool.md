# CBGM computation uses a pool of Web Workers, not pthreads

Each worker runs its own instance of the open-cbgm WASM module and takes witnesses from a shared queue; no memory is shared and the site never needs cross-origin isolation.

- Both slow steps, coherence for each witness and each witness's substemma, are independent per witness.
- Per-witness work units are also what resuming an interrupted computation needs.
- Rejected: Emscripten pthreads, which would compile upstream's `std::thread` code almost unchanged but require COOP/COEP on the whole site, risking IIIF images from third-party servers and OAuth popups.
