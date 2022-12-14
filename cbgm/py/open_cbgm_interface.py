import contextlib
from pathlib import Path
from tempfile import NamedTemporaryFile
import random
import string
from subprocess import Popen, check_output
import os

from django.core.files.base import ContentFile

from accounts.models import JobStatus
from CONFIG.settings import BASE_DIR
from collation.models import Section
from cbgm import models



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
    tei = section.as_tei()
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
        tei_file.unlink(missing_ok=True)
        db_file.close()
        with contextlib.suppress(Exception):
            os.remove(db_file.name)
        raise Exception(f'open-cbgm.populate_db error.\nCommand="{command}"\nReturn code={return_code}')
    django_db_file = ContentFile(db_file.read())
    cbgm_db_instance.db_file.save(f'{section.name}.db', django_db_file)
    tei_file.unlink(missing_ok=True)
    db_file.close()
    with contextlib.suppress(Exception):
        os.remove(db_file.name)


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
