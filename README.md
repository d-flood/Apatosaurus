# Apatosaurus

I'm still waiting on a better name. This is the open source rewrite of [Apparatus Explorer](https://www.apparatusexplorer.com/).

At this stage I am merely creating the basic data models.

This new version is more than an explorer. Its features will include
- visualization
- editing
- publishing
- analysis tools
- CBGM via `open-cbgm`
- and as many modules from [Criticus](https://github.com/d-flood/criticus/) as make sense to bring to a web app.

## Redesign Priorities
- type annotate most places (or where it makes sense) for static typing analysis
- push SQLite as far as it will go with [Litestream](https://litestream.io/) or [litefs](https://github.com/superfly/litefs). 
    - For data integrity, SQLite is essentially bulletproof.
    - [Simon Willison has shown that it is far more performant](https://simonwillison.net/2022/Oct/23/datasette-gunicorn/) concerning concurrent writes than most people think.
    - Apatosauros will need to make many database calls due to the tree-like structure of collations. These will be *far* faster in SQLite.
    - We can even explore a per-user database
    - If we need to eject and transition to a managed PostGreSQL instance, we can.