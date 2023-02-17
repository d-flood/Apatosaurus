# echo "removing old db"
# rm -rf /data/db/.apatosaurus.db-litestream
# rm -f /data/db/apatosaurus.db
# rm -f /data/db/apatosaurus.db-shm
# rm -f /data/db/apatosaurus.db-wal
echo "starting restore"
litestream restore -o /data/db/apatosaurus.db "s3://apatosaurus/litestream/main_db"
# echo "copying db to volume"

# if [ ! -f /data/db/apatosaurus.db ] 
# then
#     echo "File does not exist yet. Copying from temp location."
#     cp /temp/db/apatosaurus.db /data/db/apatosaurus.db
# else
#     echo "File found. Not copying."
# fi

echo "Starting replication" && litestream replicate