import json
import string

from collatex import collate
from django.db.models import Q
from natsort import index_natsorted

from collation import models as cmodels
from transcriptions import models as tmodels

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


def get_basetext_tokens(basetext_pk: int, transcription_names: list[str]) -> list[dict]:
    basetext = tmodels.Transcription.objects.filter(
        witness__pk=basetext_pk, name__in=transcription_names
    ).first()
    if not basetext:
        raise ValueError("Basetext not found")
    return [{"id": basetext_pk, "tokens": basetext.tokens}]


def gather_witness_transcriptions(
    witnes_pks: list[int],
    transcription_names: list[str],
    basetext_pk: int,
    ab_pk: int,
    user_pk: int,
) -> list:
    """
    Given a list of witness pks and a list of ab names, return a list of transcriptions.
    """
    ab = cmodels.Ab.objects.filter(
        section__collation__user_id=user_pk, pk=ab_pk
    ).first()
    if not ab:
        raise ValueError("Ab (verse) not found")
    witnesses = get_basetext_tokens(basetext_pk, transcription_names)
    available_witnesses = Q(default=True) | Q(user_id=user_pk)
    for witness_pk in witnes_pks:
        witness = cmodels.Witness.objects.filter(
            available_witnesses, pk=witness_pk
        ).first()
        if not witness:
            raise ValueError("Witness not found")
        transcription = tmodels.Transcription.objects.filter(
            witness__pk=witness_pk, name__in=transcription_names
        ).first()
        # for tr_name in transcription_names:
        #     transcription = tmodels.Transcription.objects.filter(
        #         witness=witness, name=tr_name
        #     ).first()
        #     if not transcription:
        #         continue
        witnesses.append({"id": witness_pk, "tokens": transcription.tokens})
        # break
    return witnesses


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
        if not segment:
            variation_units.append(None)
            continue
        print(f"segment: {segment}")
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
    cleaned_variation_units = []
    for i, variant in enumerate(variation_units):
        if not variant:
            continue
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
        # only include variaiton units with 2 or more readings
        if len(variant_readings) > 1:
            cleaned_variation_units.append(variant)
    return cleaned_variation_units


def add_collation_to_db(variation_units: list[dict], ab_pk: int, user_pk: int):
    ab = cmodels.Ab.objects.filter(
        section__collation__user_id=user_pk, pk=ab_pk
    ).first()
    # delete existing app objects
    cmodels.App.objects.filter(ab=ab).delete()
    if not ab:
        raise ValueError("Ab (verse) not found")
    for variation_unit in variation_units:
        app = cmodels.App.objects.create(
            ab=ab,
            index_from=variation_unit["from"],
            index_to=variation_unit["to"],
        )
        for reading in variation_unit["readings"]:
            # exclude basetext wit
            reading_obj = cmodels.Rdg.objects.create(
                app=app, name=reading["name"], text=reading["text"]
            )
            for witness_pk in reading["witnesses"]:
                if witness_pk == ab.basetext_label:
                    continue
                witness_obj = cmodels.Witness.objects.get(pk=witness_pk)
                reading_obj.wit.add(witness_obj)
        app.save()
    ab.save()


def collate_verse(
    witnes_pks: list[int],
    transcription_names: list[str],
    basetext: int,
    ab_pk: int,
    user_pk: int,
):
    witnesses = gather_witness_transcriptions(
        witnes_pks, transcription_names, basetext, ab_pk, user_pk
    )
    witnesses = {"witnesses": witnesses}
    collation = json.loads(collate(witnesses, output="json", segmentation=True))
    table = collation["table"]
    variation_units = get_variation_units(table)
    variation_units = get_readings(table, variation_units)
    add_collation_to_db(variation_units, ab_pk, user_pk)
