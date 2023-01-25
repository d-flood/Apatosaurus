echo "starting restore"
litestream restore -o /data/db/apatosaurus.db s3://apatosaurus/litestream/main_db
echo "Starting replication"
litestream replicate /data/db/apatosaurus.db s3://apatosaurus/litestream/main_db