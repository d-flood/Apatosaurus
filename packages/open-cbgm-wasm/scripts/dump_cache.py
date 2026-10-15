import gzip
import hashlib
import json
import sqlite3
import struct
import sys

TABLES = {
    "READINGS": "SELECT ROW_ID, VARIATION_UNIT, READING FROM READINGS ORDER BY ROW_ID",
    "READING_RELATIONS": "SELECT ROW_ID, VARIATION_UNIT, PRIOR, POSTERIOR, WEIGHT FROM READING_RELATIONS ORDER BY ROW_ID",
    "READING_SUPPORT": "SELECT ROW_ID, VARIATION_UNIT, WITNESS, READING FROM READING_SUPPORT ORDER BY ROW_ID",
    "VARIATION_UNITS": "SELECT ROW_ID, VARIATION_UNIT, LABEL, CONNECTIVITY FROM VARIATION_UNITS ORDER BY ROW_ID",
    "WITNESSES": "SELECT ROW_ID, WITNESS FROM WITNESSES ORDER BY ROW_ID",
}


def digest(blobs, cost):
    content = b"".join(struct.pack(">I", len(blob)) + blob for blob in blobs)
    return hashlib.sha256(content + struct.pack(">d", cost)).hexdigest()[:16]


db = sqlite3.connect(sys.argv[1])
tables = {name: [list(row) for row in db.execute(sql)] for name, sql in TABLES.items()}
witnesses = [row[1] for row in tables["WITNESSES"]]
comparisons = {
    (row[0], row[1]): digest(row[2:9], row[9])
    for row in db.execute(
        "SELECT PRIMARY_WIT, SECONDARY_WIT, EXTANT, AGREEMENTS, PRIOR, POSTERIOR, NOREL, UNCLEAR, EXPLAINED, COST "
        "FROM GENEALOGICAL_COMPARISONS"
    )
}
assert len(comparisons) == len(witnesses) ** 2
tables["GENEALOGICAL_COMPARISONS"] = [
    [primary, secondary, comparisons[(primary, secondary)]] for primary in witnesses for secondary in witnesses
]
content = "{\n" + ",\n".join(
    json.dumps(name) + ": [\n" + ",\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n]"
    for name, rows in tables.items()
) + "\n}\n"
with open(sys.argv[2], "wb") as out:
    out.write(gzip.compress(content.encode("utf-8"), mtime=0))
