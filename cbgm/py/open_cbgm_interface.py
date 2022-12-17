import contextlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
import random
import string
from subprocess import Popen, check_output
import os

from django.core.files.base import ContentFile

from natsort import natsorted
from rich import print

from accounts.models import JobStatus
from CONFIG.settings import BASE_DIR
from collation.models import Section
from cbgm import models
from cbgm.py.custom_sql import get_all_witness_siglums, get_all_apps, get_all_witnesses_and_apps
from witnesses.py.sort_ga_witnesses import sort_ga_witnesses



def construct_populate_db_command(tei_path: str, db_path: str, db: models.Cbgm_Db) -> str:
    populate_db_exe = BASE_DIR / 'cbgm' / 'bin' / 'populate_db.exe'
    populate_db_binary = populate_db_exe.resolve().as_posix()
    threshold = db.threshold
    trivial_types = db.trivial_types
    ignore_types = db.ignore_types
    ignore_suffixes = db.ignore_suffixes
    merge_splits = db.merge_splits
    use_classic_rules = db.use_classic_rules
    options = ['--threshold', str(threshold)]
    if trivial_types and trivial_types.strip():
        for trivial in trivial_types.split():
            options.extend(['-z', trivial])
    if ignore_types and ignore_types.strip():
        for ignore in ignore_types.split():
            options.extend(['-Z', ignore])
    if ignore_suffixes and ignore_suffixes.strip():
        for suffix in ignore_suffixes.split():
            suffix = '"*"' if suffix == '*' else suffix
            options.extend(['-s', suffix])
    if merge_splits:
        options.append('--merge-splits')
    if use_classic_rules:
        options.append('--classic')
    return f'{populate_db_binary} {" ".join(options)} "{tei_path}" "{db_path}"'.replace('\\', '/')


def import_tei_section(user_pk: int, section_pk: int, db_pk: int):
    section = Section.objects.get(pk=section_pk)
    tei, _ = section.as_tei()
    # I cannot get NamedTemporaryFile to work with open-cbgm.populate_db. I would
    # guess that it is because the file is opened by another process.
    tmp_name = f"tei_{''.join(random.choices(string.ascii_letters, k=5))}.xml"
    tei_file = BASE_DIR / 'temp' / tmp_name
    with open(tei_file, 'w', encoding='utf-8') as f:
        f.write(tei)
    db_file = NamedTemporaryFile(delete=False, dir=BASE_DIR / 'temp', prefix='cbgm_', suffix='.db')
    cbgm_db_instance = models.Cbgm_Db.objects.get(pk=db_pk)
    command = construct_populate_db_command(tei_file.resolve().as_posix(), db_file.name, cbgm_db_instance)
    p = Popen(command, shell=True)
    return_code = p.wait()
    if return_code != 0:
        Popen(f'Notepad {tei_file.resolve()}', shell=True)
        cleanup(tei_file, db_file)
        raise Exception(f'open-cbgm.populate_db error.\nCommand="{command}"\nReturn code={return_code}')
    witnesses, app_labels = get_all_witnesses_and_apps(db_file.name)
    cbgm_db_instance.witnesses = sort_ga_witnesses(witnesses) #type: ignore
    cbgm_db_instance.app_labels = app_labels #type: ignore
    django_db_file = ContentFile(db_file.read())
    cbgm_db_instance.db_file.save(f'{section.name}.db', django_db_file)
    cbgm_db_instance.active = True
    cbgm_db_instance.save()
    cleanup(tei_file, db_file)


def import_tei_section_task(user_pk: int, section_pk: int, db_pk: int, job_pk: int):
    JobStatus.objects.filter(pk=job_pk).update(
        in_progress=True,
        progress=-1,
        message='Importing TEI into open-cbgm'
    )
    try:
        import_tei_section(user_pk, section_pk, db_pk)
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            completed=True,
            progress=100,
            message='Imported TEI into open-cbgm'
        )
    except Exception as e:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            failed=True,
            message=f'Error: {e}'
        )
        models.Cbgm_Db.objects.get(pk=db_pk).delete()


def cleanup(tei_file: Path, db_file):
    tei_file.unlink(missing_ok=True)
    db_file.close()
    with contextlib.suppress(Exception):
        os.remove(db_file.name)


def construct_compare_wits_command(db: models.Cbgm_Db, witness: str, comparators: list):
    compare_wits_exe = BASE_DIR / 'cbgm' / 'bin' / 'compare_witnesses.exe'
    compare_wits_binary = compare_wits_exe.resolve().as_posix()
    if witness in comparators:
        comparators.remove(witness)
    witnesses = f'{witness} {" ".join(comparators)}'
    output_file = NamedTemporaryFile(delete=False, dir=BASE_DIR / 'temp', prefix='cbgm_', suffix='.json')
    command = f'"{compare_wits_binary}" -f json -o "{output_file.name}" "{db.db_file.path}" {witnesses}'
    return command.replace('\\', '/'), output_file


def compare_witnesses(db: models.Cbgm_Db, witness: str, comparators: list[str]) -> dict:
    command, output_file = construct_compare_wits_command(db, witness, comparators)
    p = Popen(command)
    return_code = p.wait()
    if return_code != 0:
        output_file.close()
        with contextlib.suppress(Exception):
            os.remove(output_file.name)
        raise Exception(f'open-cbgm.compare_witnesses error.\nCommand="{command}"\nReturn code={return_code}')
    output = json.load(output_file)
    output_file.close()
    with contextlib.suppress(Exception):
        os.remove(output_file.name)
    return output


def construct_find_relatives_command(db: models.Cbgm_Db, witness: str, app: str, readings: list): #type: ignore
    find_relatives_exe = BASE_DIR / 'cbgm' / 'bin' / 'find_relatives.exe'
    compare_wits_binary = find_relatives_exe.resolve().as_posix()
    output_file = NamedTemporaryFile(delete=False, dir=BASE_DIR / 'temp', prefix='cbgm_', suffix='.json')
    if readings == []:
        command = f'"{compare_wits_binary}" -f json -o "{output_file.name}" "{db.db_file.path}" {witness} {app}'
    else:
        command = f'"{compare_wits_binary}" -f json -o "{output_file.name}" "{db.db_file.path}" {witness} {app} {" ".join(readings)}'
    return command.replace('\\', '/'), output_file


def find_relatives(db: models.Cbgm_Db, witness: str, app: str, readings: list) -> dict:
    command, output_file = construct_find_relatives_command(db, witness, app, readings)
    p = Popen(command)
    return_code = p.wait()
    if return_code != 0:
        output_file.close()
        with contextlib.suppress(Exception):
            os.remove(output_file.name)
        raise Exception(f'open-cbgm.compare_witnesses error.\nCommand="{command}"\nReturn code={return_code}')
    output = json.load(output_file)
    output_file.close()
    with contextlib.suppress(Exception):
        os.remove(output_file.name)
    return output
