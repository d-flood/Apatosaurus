pg_dump -U postgres \
    -h <db_endpoint> \
    -p 5432 -F c -b -v -f prod_dump.sql apatosaurus_db

pg_dumpall -U postgres \
    -h <db_endpoint> \
    -p 5432 -g -f global_objects.sql