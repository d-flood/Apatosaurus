FROM python:3.9-slim-buster

WORKDIR /django
COPY . .

RUN apt-get update
RUN apt-get -y install graphviz

RUN pip install -r requirements_dev.txt