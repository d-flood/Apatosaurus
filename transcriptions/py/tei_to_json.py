import os

import boto3
import lxml.etree as et
from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from zappa.asynchronous import task

from accounts.py.update_status import JobStatus, update_status
from collation.models import Witness
from transcriptions import models
from transcriptions.py.from_tei import (
    add_underdot_to_unclear_letters,
    get_verse_as_tuple,
    parse,
    pre_parse_cleanup,
    remove_unclear_tags,
    tei_ns,
)
from transcriptions.py.to_json import verse_to_dict

####################


def get_hands(root: et._Element) -> list:
    rdgs = root.xpath("//tei:rdg", namespaces={"tei": tei_ns})
    hands = []
    for rdg in rdgs:
        if rdg.get("hand") and rdg.get("hand") not in hands:
            hands.append(rdg.get("hand"))
    if hands == []:
        hands = ["firsthand"]
    return hands


def save_transcription_to_db(verse_dict: dict, user_pk, witness_pk: int):
    first_hand_witness = Witness.objects.get(pk=witness_pk)
    for witness in verse_dict["witnesses"]:
        if witness["id"] == first_hand_witness.siglum:
            witness_object = first_hand_witness
        else:
            witness_object, _ = Witness.objects.get_or_create(
                siglum=f"{first_hand_witness.siglum}-{witness['id']}",
                user_id=user_pk,
            )
        models.Transcription.objects.get_or_create(
            user_id=user_pk,
            witness=witness_object,
            name=verse_dict["n"],
            tokens=witness["tokens"],
        )


def put_file_in_s3(tei_file: UploadedFile, tei_file_name: str):
    session = boto3.Session(
        aws_access_key_id=os.environ.get("AWS_S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_S3_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("AWS_S3_REGION_NAME"),
    )
    s3 = session.client("s3")
    s3.put_object(
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=tei_file_name,
        Body=tei_file.read(),
    )


def get_file_from_s3(tei_file_name: str):
    session = boto3.Session(
        aws_access_key_id=os.environ.get("AWS_S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_S3_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("AWS_S3_REGION_NAME"),
    )
    s3 = session.client("s3")
    tei_string = (
        s3.get_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=tei_file_name)[
            "Body"
        ]
        .read()
        .decode("utf-8")
    )
    s3.delete_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=tei_file_name)
    return tei_string


@task
def tei_to_db(
    tei_file_name: str, siglum: str, user_pk: int, job_pk: int, witness_pk: int
):
    update_status(job_pk, "Started", 0)
    text: str = get_file_from_s3(tei_file_name)
    text = pre_parse_cleanup(text)
    root = parse(text)
    add_underdot_to_unclear_letters(root)
    text = et.tostring(root, encoding="unicode")
    text = remove_unclear_tags(text)
    _, root = parse(text)
    hands = get_hands(root)
    verses = root.xpath(f"//tei:ab", namespaces={"tei": tei_ns})
    total = len(verses)
    for i, verse in enumerate(verses, start=1):
        update_status(job_pk, f"Importing verse {i} of {total}", i / total * 100)
        ref = verse.get("n")
        witnesses = get_verse_as_tuple(verse, hands=hands)
        verse_dict = verse_to_dict(siglum, ref, witnesses)
        save_transcription_to_db(verse_dict, user_pk, witness_pk)
    update_status(job_pk, "", 100, False, True)


def import_transcription(tei_file: UploadedFile, user_pk, siglum: str, witness_pk: int):
    job_pk = JobStatus.objects.create(
        user_id=user_pk,
        name=f"Import TEI Transcription {siglum}",
        message="Enqueued",
    ).pk
    tei_file_name = f"tei/user-{user_pk}/{siglum}.xml"
    put_file_in_s3(tei_file, tei_file_name)
    tei_to_db(tei_file_name, siglum, user_pk, job_pk, witness_pk)
