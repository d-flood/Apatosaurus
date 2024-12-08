FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED 1

WORKDIR /app

RUN apt-get update
RUN apt-get -y install graphviz

COPY requirements.txt requirements.txt
RUN pip install -r requirements.txt

COPY . .
