from huey.contrib.djhuey import task

from collation.py import process_tei
from accounts.py.update_status import update_status


@task()
def tei_to_db_task(tei_file, section_id: int, job_pk: int, user_pk: int):
    try:
        if (xml := process_tei.parse_xml(tei_file)) is not None:
            process_tei.tei_to_db(xml, section_id, job_pk, user_pk)
            update_status(job_pk, '', 100, False, True)
        else:
            update_status(job_pk, 'Error: XML file is not valid', 0, False, False, True)
    except Exception as e:
        print(e)
        update_status(job_pk, f'Error: {e}', 0, False, False, True)
