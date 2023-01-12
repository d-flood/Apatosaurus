FROM python:3.11.1-slim-buster
ENV PYTHONUNBUFFERED=1
WORKDIR /django
COPY . .

RUN apt-get update
RUN apt-get install graphviz -y

RUN pip3 install -r requirements_prod.txt