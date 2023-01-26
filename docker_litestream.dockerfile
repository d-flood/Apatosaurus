FROM litestream/litestream:latest
COPY litestream.yml /etc/litestream.yml
COPY start_lightstream.sh start_lightstream.sh
ENTRYPOINT ["/bin/sh", "./start_lightstream.sh"]