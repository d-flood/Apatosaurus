echo "removing old db"
rm -rf /data/db/.apatosaurus.db-litestream
rm -f /data/db/apatosaurus.db
rm -f /data/db/apatosaurus.db-shm
rm -f /data/db/apatosaurus.db-wal
echo "starting restore"
litestream restore -o /data/db/apatosaurus.db s3://apatosaurus/litestream/main_db
echo "Starting replication"
litestream replicate /data/db/apatosaurus.db s3://apatosaurus/litestream/main_db