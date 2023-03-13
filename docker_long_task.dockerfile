# FROM amazon/aws-lambda-python:3.10
FROM python:3.11-slim-buster

ENV ZAPPA_RUNNING_IN_DOCKER=True
RUN mkdir -p /django
WORKDIR /django
COPY . .
RUN apt-get update
RUN apt-get install -y graphviz

RUN pip install -r requirements.txt