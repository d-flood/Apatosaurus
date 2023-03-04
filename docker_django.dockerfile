FROM python:3.9-slim-buster
ENV PYTHONUNBUFFERED=1
WORKDIR /django
COPY _static _static
COPY _staticfiles _staticfiles
COPY _templates _templates
COPY accounts accounts
COPY cbgm cbgm
COPY collation collation
COPY CONFIG CONFIG
COPY published published
COPY theme theme
COPY witnesses witnesses
COPY content content

COPY manage.py manage.py
COPY requirements_prod.txt requirements_prod.txt

RUN pip3 install -r requirements_prod.txt