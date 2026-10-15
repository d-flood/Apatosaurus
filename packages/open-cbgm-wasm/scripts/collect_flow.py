import json
import sqlite3
import sys

cache, flow_dir, output, *units = sys.argv[1:]
db = sqlite3.connect(cache)


def read(path):
    with open(f"{flow_dir}/{path}", encoding="utf-8") as dot:
        return dot.read()


flows = {
    unit: {
        "flow": read(f"flow/{unit}-textual-flow.dot"),
        "attestations": [
            [rdg, read(f"attestations/{unit}R{rdg}-coherence-attestations.dot")]
            for (rdg,) in db.execute("SELECT READING FROM READINGS WHERE VARIATION_UNIT=? ORDER BY ROW_ID", (unit,))
        ],
        "variants": read(f"variants/{unit}-coherence-variants.dot"),
    }
    for unit in units
}
with open(output, "w", encoding="utf-8") as out:
    json.dump(flows, out, ensure_ascii=False, indent="\t")
    out.write("\n")
