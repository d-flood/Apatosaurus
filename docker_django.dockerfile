FROM amazon/aws-lambda-python:3.10
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
COPY requirements.txt requirements.txt
# COPY dot /usr/local/bin/dot

# ENV VIRTUAL_ENV=/venv
# RUN python -m venv $VIRTUAL_ENV
# ENV PATH="$VIRTUAL_ENV/bin:$PATH"

RUN pip install -r requirements.txt