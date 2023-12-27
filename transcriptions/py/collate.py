import json
import string

from collatex import collate

text = [
    {
        "id": "Base",
        "tokens": [
            {"t": "a", "n": "a", "index": 2},
            {"t": "big", "n": "big", "index": 4},
            {"t": "brown", "n": "brown", "index": 6},
            {"t": "dog", "n": "dog", "index": 8},
            {"t": "growls", "n": "growls", "index": 10},
        ],
    },
    {
        "id": "A",
        "tokens": [
            {"t": "a", "n": "a"},
            {"t": "black", "n": "black"},
            {"t": "dog", "n": "dog"},
            {"t": "growls", "n": "growls"},
        ],
    },
    {
        "id": "B",
        "tokens": [
            {"t": "a", "n": "one"},
            {"t": "black", "n": "black"},
            {"t": "cat", "n": "cat"},
            {"t": "jumps", "n": "jumps"},
            {"t": "up", "n": "up"},
            {"t": "the", "n": "the"},
            {"t": "tree", "n": "tree"},
        ],
    },
]


def collapse_witness_readings(
    witness_readings: list[dict[str, str | list[str]]]
) -> list[dict[str, str | list[str]]]:
    """
    Given a list of readings by different witnesses, combine witnesses that share the same reading.
    """
    collapsed_readings: list[dict[str, str | list[str]]] = []
    for reading in witness_readings:
        if not collapsed_readings:
            collapsed_readings.append(reading)
        else:
            for collapsed_reading in collapsed_readings:
                if reading["text"] == collapsed_reading["text"]:
                    collapsed_reading["witnesses"].extend(reading["witnesses"])
                    break
            else:
                collapsed_readings.append(reading)
    return collapsed_readings


def name_readings(
    readings: list[dict[str, str | list[str]]]
) -> list[dict[str, str | list[str]]]:
    if len(readings) <= 26:
        names = string.ascii_lowercase
    else:
        names = range(1, len(readings) + 1)
    for i, reading in enumerate(readings):
        reading["name"] = names[i]
    return readings


def get_variation_units(table):
    variation_units: list[dict] = []
    for segment in table[0]:
        _from = min([token["index"] for token in segment])
        _to = max([token["index"] for token in segment])
        tokens = []
        for token in segment:
            tokens.append(token["t"])
        words = " ".join(tokens)
        variation_units.append(
            {
                "from": _from,
                "to": _to,
                "basetext": words,
                "readings": [],
            }
        )
    return variation_units


def get_readings(table, variation_units):
    for i, variant in enumerate(variation_units):
        variant_readings = []
        for witness in table:
            witness_id = witness[0][0]["_sigil"]
            if not witness[i]:
                text = ""
            else:
                text = " ".join([token["t"] for token in witness[i]])
            variant_readings.append({"witnesses": [witness_id], "text": text})
        variant_readings = collapse_witness_readings(variant_readings)
        variant_readings = name_readings(variant_readings)
        variant["readings"] = variant_readings
    return variation_units


def collate_verse(witnesses: list[dict]):
    witnesses = {"witnesses": witnesses}
    collation = json.loads(collate(witnesses, output="json", segmentation=True))
    table = collation["table"]
    variation_units = get_variation_units(table)
    variation_units = get_readings(table, variation_units)
    return variation_units
