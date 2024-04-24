import json
import string

from collatex import collate
from django.db.models import Q

from collation import models as cmodels
from transcriptions import models as tmodels

# from rich import print


def get_basetext_tokens(basetext_pk: int, transcription_name: str) -> list[dict]:
    basetext = tmodels.Transcription.objects.filter(
        witness__pk=basetext_pk, name=transcription_name
    ).first()
    if not basetext:
        try:
            siglum = cmodels.Witness.objects.get(pk=basetext_pk).siglum
        except cmodels.Witness.DoesNotExist:
            siglum = f"ID-{basetext_pk}"
        raise ValueError(
            f"Basetext witness {siglum} not found for transcription {transcription_name}."
        )
    return [{"id": basetext_pk, "tokens": basetext.tokens}]


def gather_witness_transcriptions(
    witness_pks: list[int],
    transcription_name: str,
    basetext_pk: int,
    ab_pk: int,
    user_pk: int,
) -> tuple[list[dict], list[str]]:
    """
    Given a list of witness pks and a list of ab names, return a list of transcriptions.
    """
    errors = []
    ab = cmodels.Ab.objects.filter(
        section__collation__user_id=user_pk, pk=ab_pk
    ).first()
    if not ab:
        raise ValueError("Ab (verse) not found")
    witnesses = get_basetext_tokens(basetext_pk, transcription_name)
    available_witnesses = Q(default=True) | Q(user_id=user_pk)
    wit_errors = []
    for witness_pk in witness_pks:
        witness = cmodels.Witness.objects.filter(
            available_witnesses, pk=witness_pk
        ).first()
        if not witness:
            raise ValueError("Witness not found")
        transcription = tmodels.Transcription.objects.filter(
            witness__pk=witness_pk, name=transcription_name
        ).first()
        if not transcription:
            wit_errors.append(witness.siglum)
            continue
        witnesses.append({"id": witness_pk, "tokens": transcription.tokens})
    if wit_errors:
        errors.append(f"Transcription not found for: {', '.join(wit_errors)}.")
    return witnesses, errors


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


def get_variation_units(table, errors: list):
    variation_units: list[dict] = []
    for i, segment in enumerate(table[0]):
        if not segment:
            try:
                _from = (
                    int(table[0][i - 1][0]["index"]) + 1
                )  # get the index one less than current
            except (TypeError, IndexError):
                try:
                    _from = (
                        int(table[0][i + 1][0]["index"]) - 1
                    )  # get the index one more than current
                except (IndexError, TypeError):
                    errors.append(
                        f"There is probably an unhandled omission by the basetext."
                    )
                    continue
            _to = _from
            words = "-"
        else:
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
    return variation_units, errors


def get_readings(table, variation_units):
    cleaned_variation_units = []
    errors = []
    for i, variant in enumerate(variation_units):
        variant_readings = []
        for witness in table:
            for segment in witness:
                if segment:
                    witness_id = segment[0]["_sigil"]
                    break
            else:
                errors.append(f"No data for an unknown witness.")
                continue
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
    return cleaned_variation_units, errors


def add_collation_to_db(
    variation_units: list[dict], ab_pk: int, user_pk: int, errors_list: list[str]
):
    ab = cmodels.Ab.objects.filter(
        section__collation__user_id=user_pk, pk=ab_pk
    ).first()
    # delete existing app objects
    cmodels.App.objects.filter(ab=ab).delete()
    if not ab:
        raise ValueError("Ab (verse) not found")
    if errors_list:
        errors = "\n".join(errors_list)
        ab.note = f"———\nWarnings from automated collation: \n{errors}\n———\n{ab.note if ab.note else ''}"
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
    witnesses, errors = gather_witness_transcriptions(
        witnes_pks, transcription_names, basetext, ab_pk, user_pk
    )
    witnesses = {"witnesses": witnesses}
    collation = json.loads(
        collate(witnesses, output="json", segmentation=False, near_match=True)
    )
    table = collation["table"]
    variation_units, errors = get_variation_units(table, errors)
    variation_units, table_errors = get_readings(table, variation_units)
    add_collation_to_db(variation_units, ab_pk, user_pk, errors)
    return errors + table_errors
