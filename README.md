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

## Running the dev server
This will be dockerized once the initial development on the main site is done. Until then:
- Apatosaurus is being developed with Python 3.11 and Django 4.1
- The following environment variables must be present:
    - `SECRET_KEY`
    - `DEBUG`
    - `ADMIN_URL`
- on Windows run `py manage.py runserver`
- on Mac/Linux run `python3 manage.py runserver`