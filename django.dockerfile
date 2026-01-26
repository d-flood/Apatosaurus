FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED 1

WORKDIR /app

RUN apt-get update
RUN apt-get -y install graphviz

COPY requirements.txt requirements.txt
RUN pip install -r requirements.txt

COPY . .

RUN chmod -R 755 /app/cbgm/bin/compare_witnesses
RUN chmod -R 755 /app/cbgm/bin/dot
RUN chmod -R 755 /app/cbgm/bin/find_relatives
RUN chmod -R 755 /app/cbgm/bin/optimize_substemmata
RUN chmod -R 755 /app/cbgm/bin/populate_db
RUN chmod -R 755 /app/cbgm/bin/print_global_stemma
RUN chmod -R 755 /app/cbgm/bin/print_textual_flow
