FROM python:3.11.1-slim-buster
ENV PYTHONUNBUFFERED=1
WORKDIR /django
COPY _static _static
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
COPY wait_for_db.py wait_for_db.py
COPY clear_db.py clear_db.py

RUN apt-get update
RUN apt-get install graphviz -y

RUN pip3 install -r requirements_prod.txt