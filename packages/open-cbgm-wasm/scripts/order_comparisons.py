import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
witnesses = [witness for (witness,) in db.execute("SELECT WITNESS FROM WITNESSES ORDER BY ROW_ID")]
db.executemany(
    "UPDATE GENEALOGICAL_COMPARISONS SET ROW_ID=? WHERE PRIMARY_WIT=? AND SECONDARY_WIT=?",
    [
        (i * len(witnesses) + j, primary, secondary)
        for i, primary in enumerate(witnesses)
        for j, secondary in enumerate(witnesses)
    ],
)
db.commit()
