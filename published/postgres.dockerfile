FROM postgres:14.0-alpine
ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=postgres
ENV POSTGRES_DB=postgres
COPY ./data/db /var/lib/postgresql/data