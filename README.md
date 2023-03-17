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
- Docker and Docker Compose are required to run.
- `docker-compose_dev.yml` sets most environment variables from a file `.env`. The following variables are the minimum dev server to run. Note that images being served by AWS (limited to the "About" pages) will not work without AWS credentials.
    - `SECRET_KEY`
    - `ADMIN_URL`
    - `POSTGRES_PASSWORD='atestpasswordforgettingup'`
- Start development server `docker compose --file docker-compose_dev.yml up`
This will start up a Postgres container and the main app container. In production, several functions in the app container are actually run either as serverless functions via AWS Lambda, and others are queued as an AWS Batch job.


## Production
In Apatosaurus' brief history, it has been run as several services all within an AWS EC2 instance and it has been deployed to AWS Fargate as a cluster of services running in containers.

Now Apatosaurus runs in an AWS Lambda serverless function and uses Zappa to automate (some) of the infrustructure setup. Tasks that would have been run in a task server are now run by starting another serverless function. Long tasks are sent to AWS Batch, which does not have a timeout like a Lambda, but at the expense of much longer startup times for each job. This option seems to provide the best balance of performance and affordability.
