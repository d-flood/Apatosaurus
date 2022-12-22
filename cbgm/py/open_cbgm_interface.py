import contextlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
import random
from shutil import rmtree
import string
from subprocess import Popen, check_output, CalledProcessError
import os

from django.core.files.base import ContentFile

from natsort import natsorted
from rich import print

from accounts.models import JobStatus
from CONFIG.settings import BASE_DIR
from collation.models import Section
from cbgm import models
from cbgm.py.custom_sql import get_all_witness_siglums, get_all_apps, get_all_witnesses_and_apps
from cbgm.py.helpers import make_svg_from_dot
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
    # if ignore_suffixes and ignore_suffixes.strip():
    #     for suffix in ignore_suffixes.split():
    #         suffix = '"*"' if suffix == '*' else suffix
    #         options.extend(['-s', suffix])
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
    p = Popen(command)
    return_code = p.wait()
    if return_code != 0:
        Popen(f'Notepad {tei_file.resolve()}')
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
        command = f'"{compare_wits_binary}" -f json -o "{output_file.name}" "{db.db_file.path}" {witness} "{app}"'
    else:
        command = f'"{compare_wits_binary}" -f json -o "{output_file.name}" "{db.db_file.path}" {witness} "{app}" {" ".join(readings)}'
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


def construct_optimize_substemma_command(db: models.Cbgm_Db, witness: str, max_cost: int):
    optimize_substemma_exe = BASE_DIR / 'cbgm' / 'bin' / 'optimize_substemmata.exe'
    optimize_substemma_binary = optimize_substemma_exe.resolve().as_posix()
    output_file = NamedTemporaryFile(delete=False, dir=BASE_DIR / 'temp', prefix='cbgm_', suffix='.json')
    if max_cost == -1:
        command = f'"{optimize_substemma_binary}" -f json -o "{output_file.name}" "{db.db_file.path}" {witness}'
    else:
        command = f'"{optimize_substemma_binary}" -b {max_cost} -f json -o "{output_file.name}" "{db.db_file.path}" {witness}'
    return command.replace('\\', '/'), output_file


def optimize_substemma(db: models.Cbgm_Db, witness: str, max_cost: int):
    command, output_file = construct_optimize_substemma_command(db, witness, max_cost)
    try:
        message = check_output(command)
    except CalledProcessError as e:
        with contextlib.suppress(Exception):
            os.remove(output_file.name)
        print(f'{command=}\n{e.returncode=}')
        return False, '''{"title": "Error Calling the open-cbgm", "message": "The 'optimize_substemma' function failed to run. Please contact David about it."}'''

    if 'no potential ancestors' in message.decode('utf-8'):
        with contextlib.suppress(Exception):
            os.remove(output_file.name)
        print(f'{command=}\n{message=}')
        return False, '''{"title": "No Potential Ancestors", "message": "There are no potential ancestors for this witness."}'''
    try:
        output = json.load(output_file)
    except json.decoder.JSONDecodeError as e:
        output_file.close()
        with contextlib.suppress(Exception):
            os.remove(output_file.name)
        print(f'{command=}\n{e=}')
        return False, '''{"title": "No Results", "message": "There is no data for this witness. Probably, there is insufficient local stemma data for this witness."}'''
    output_file.close()
    with contextlib.suppress(Exception):
        os.remove(output_file.name)
    return True, output


def construct_print_local_stemma_command(db: models.Cbgm_Db, app: str):
    print_local_stemma_exe = BASE_DIR / 'cbgm' / 'bin' / 'print_local_stemma.exe'
    print_local_stemma_binary = print_local_stemma_exe.resolve().as_posix()
    tmp_name = f"cbgm-graphs-{''.join(random.choices(string.ascii_letters, k=5))}"
    # making a temporary directory is a hack to get around the fact that the open-cbgm
    # program doesn't have a way to specify the output directory for the dot files.
    # The *right* way to do this is to create Python bindings to the open-cbgm and
    # call it directly instead of making a subprocess call. This is a TODO.
    temp_dir = BASE_DIR / 'temp' / tmp_name
    temp_dir.mkdir(parents=True, exist_ok=True)
    command = f'"{print_local_stemma_binary}" "{db.db_file.path}" "{app}"'
    return command.replace('\\', '/'), temp_dir


def print_local_stemma(db: models.Cbgm_Db, app: str):
    command, temp_dir = construct_print_local_stemma_command(db, app)
    try:
        message = check_output(command, cwd=temp_dir.resolve().as_posix())
    except CalledProcessError as e:
        print(f'{command=}\n{e.returncode=}')
        return False, '''{"title": "Error Calling the open-cbgm", "message": "The 'print_local_stemma' function failed to run. Please contact David about it."}'''
    dot_path = temp_dir / 'local' / f'{app}-local-stemma.dot'
    with open(dot_path, 'r') as f:
        dot = f.read()
    svg = make_svg_from_dot(dot)
    with contextlib.suppress(Exception):
        rmtree(temp_dir)
    return True, svg


def print_textual_flow_command(db: models.Cbgm_Db, app: str, graph_type: str, connectivity_limit: int, strengths: bool):
    print_textual_flow_exe = BASE_DIR / 'cbgm' / 'bin' / 'print_textual_flow.exe'
    print_textual_flow_binary = print_textual_flow_exe.resolve().as_posix()
    tmp_name = f"cbgm-graphs-{''.join(random.choices(string.ascii_letters, k=5))}"
    temp_dir = BASE_DIR / 'temp' / tmp_name
    temp_dir.mkdir(parents=True, exist_ok=True)
    commands: list[str] = [f'"{print_textual_flow_binary}"', graph_type]
    if connectivity_limit:
        commands.append(f'-k {connectivity_limit}')
    if strengths:
        commands.append('--strengths')
    commands.extend([f'"{db.db_file.path}"', f'"{app}"'])
    return ' '.join(commands).replace('\\', '/'), temp_dir


def print_textual_flow(db: models.Cbgm_Db, data: dict[str, str | int | bool]):
    app = data['app_labels']
    graph_type = data['graph_type']
    connectivity_limit = data['connectivity_limit'] if data['connectivity_limit'] != -1 else None
    strengths = data['strengths']
    command, temp_dir = print_textual_flow_command(db, app, graph_type, connectivity_limit, strengths) # type: ignore
    try:
        message = check_output(command, cwd=temp_dir.resolve().as_posix())
    except CalledProcessError as e:
        print(f'{command=}\n{e.returncode=}')
        return False, '''{"title": "Error Calling the open-cbgm", "message": "The 'print_textual_flow' function failed to run. Please contact David about it."}''', ''
    svgs = []
    dot_dir = temp_dir / data['graph_type'].replace('--', '') # type: ignore
    for dot_file in dot_dir.glob('*.dot'):
        with open(dot_file, 'r', encoding='utf-8') as f:
            dot = f.read()
        svg = make_svg_from_dot(dot)
        svgs.append(svg)
    with contextlib.suppress(Exception):
        rmtree(temp_dir)
    if graph_type == '--flow':
        title = f'Textual Flow Graph for {app}'
    elif graph_type == '--attestations':
        title = f'Textual Flow at Attestations Graph for {app}'
    else:
        title = f'Textual Flow at Variants Graph for {app}'
    return True, svgs, title


def print_global_stemma_command(db: models.Cbgm_Db, data: dict[str, bool]):
    print_global_stemma_exe = BASE_DIR / 'cbgm' / 'bin' / 'print_global_stemma.exe'
    print_global_stemma_binary = print_global_stemma_exe.resolve().as_posix()
    tmp_name = f"cbgm-graphs-{''.join(random.choices(string.ascii_letters, k=5))}"
    temp_dir = BASE_DIR / 'temp' / tmp_name
    temp_dir.mkdir(parents=True, exist_ok=True)
    commands: list[str] = [f'"{print_global_stemma_binary}"']
    if data.get('strengths'):
        commands.append('--strengths')
    if data.get('lengths'):
        commands.append('--lengths')
    commands.append(f'"{db.db_file.path}"')
    return ' '.join(commands).replace('\\', '/'), temp_dir


def print_global_stemma(db: models.Cbgm_Db, data: dict[str, bool]):
    command, temp_dir = print_global_stemma_command(db, data)
    try:
        message = check_output(command, cwd=temp_dir.resolve().as_posix())
    except CalledProcessError as e:
        print(f'{command=}\n{e.returncode=}')
        return False, '''{"title": "Error Calling the open-cbgm", "message": "The 'print_global_stemma' function failed to run. Please contact David about it."}'''
    dot_path = temp_dir / 'global' / 'global-stemma.dot'
    with open(dot_path, 'r') as f:
        dot = f.read()
    svg = make_svg_from_dot(dot)
    with contextlib.suppress(Exception):
        rmtree(temp_dir)
    return True, svg
