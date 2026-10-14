# CBGM analyses are upstream open-cbgm SQLite files computed through our own binding

We compile the open-cbgm core library to WASM behind our own thin binding, and store each CBGM analysis as a project file in upstream open-cbgm-standalone's SQLite schema, plus a table of per-witness substemmata that native tools ignore.

- Computing an analysis can take hours or days, mostly the global stemma, so results are saved to the project location like other project files, not kept as a rebuildable browser cache.
- Upstream's format lets a scholar compute an analysis natively on a workstation or cluster and import the result.
- The standalone `print_global_stemma` writes only a `.dot` file at the end and starts one thread per witness, so it can neither resume per witness nor run in WASM as is.
- Rejected: compiling the standalone CLI programs and calling `main(argv)`, for the reason above.
- Rejected: a browser-only cache, because losing days of computation to eviction or a device change is unacceptable.
- This is the one binary project file, an exception to the plain-JSON formats of ADR 0003.
