FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED 1

WORKDIR /app
COPY . .

RUN apt-get update
RUN apt-get -y install graphviz

RUN pip install -r requirements.txt