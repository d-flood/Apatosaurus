FROM python:3.11.1-slim-buster
ENV PYTHONUNBUFFERED=1
WORKDIR /django
COPY . .

# graphviz is currently only run on the main server, but the global stemma should probably be created in the background and cached
# RUN apt-get update
# RUN apt-get install graphviz -y

# Install Litestream
# RUN wget https://github.com/benbjohnson/litestream/releases/download/v0.3.9/litestream-v0.3.9-linux-amd64.deb
# RUN dpkg -i litestream-v0.3.9-linux-amd64.deb
# COPY ./litestream.yml /etc/litestream.yml

RUN pip3 install -r requirements_prod.txt