Copyright (C) 2023  David Flood

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

# Apatosaurus

Apatosaurus is live at [apatosaurus.io](https://www.apatosaurus.io)

See the ["About"](https://www.apatosaurus.io/about/introduction/) pages for details about use, the tech stack, tutorials, and more.

This is the open source rewrite of [Apparatus Explorer](https://www.apparatusexplorer.com/).

This new version is more than an explorer. Its features include
- visualization
- editing
- publishing
- analysis tools
- CBGM via `open-cbgm`
- and as many modules from [Criticus](https://github.com/d-flood/criticus/) as make sense to bring to a web app.


## Running the dev server
- Apatosaurus is being developed with Python 3.11 and Django 4.1
- Docker and Docker Compose is required to run.
- Start development server `docker compose --file docker-compose_dev.yml up`
This will start up a Postgres container and the main app container. In production, several functions in the app container are actually run either as serverless functions via AWS Lambda, and others are queued as an AWS Batch job.

