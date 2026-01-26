import logging

from django.core.files.base import ContentFile
from peasy_jobs.peasy_jobs import peasy

from accounts.models import UserFile
from collation.models import Collation, Section
from collation.py import process_tei

logger = logging.getLogger(__name__)


@peasy.job("download apparatus")
def download_apparatus_task(corpus_type: str, user_pk: int, corpus_pk: int, job_pk: int):
    """Generate a TEI collation file for either a Section or a Collation object."""
    if corpus_type == "section":
        corpus = Section.objects.get(pk=corpus_pk)
    elif corpus_type == "collation":
        corpus = Collation.objects.get(pk=corpus_pk)
    else:
        raise ValueError("Invalid corpus type.")
    peasy.update_status(job_pk, f"Generate TEI for {corpus.name}")
    tei = corpus.as_tei(job_pk).encode("utf-8")
    peasy.update_status(job_pk, "TEI generated. Now adding to your files.")
    
    UserFile(
        user_id=user_pk,
        name=f"{corpus.name}.xml",
        file=ContentFile(tei, name=f"{corpus.name}.xml"),
    ).save()
    peasy.update_status(job_pk, "TEI file added to your files.")
    

@peasy.job("build collation index")
def build_collation_index(
    collation_pk: int, user_pk: int, child_rdg_types: list[str] = None, job_pk: int = None
):
    """Build the index for a collation."""
    collation = Collation.objects.get(pk=collation_pk)
    peasy.update_status(job_pk, f"Building index for {collation.name}")
    collation.build_index(child_rdg_types)
    peasy.update_status(job_pk, f"Index built for {collation.name}")


@peasy.job("import tei")
def tei_to_db(user_file_pk: int, section_pk: int, user_pk: int, job_pk: int):
    logger.info(f"Processing TEI file {user_file_pk} for section {section_pk}")
    try:
        user_file = UserFile.objects.get(pk=user_file_pk)
        with user_file.file.open('r') as f:
            tei_string = f.read()
        
        peasy.update_status(job_pk, "Processing XML file")
        
        if (xml := process_tei.parse_xml(tei_string)) is not None:
            process_tei.tei_to_db(xml, section_pk, user_pk)
            peasy.update_status(job_pk, "XML file processed")
        else:
            peasy.update_status(job_pk, "Error: TEI file could not be processed")
    except Exception as e:
        raise e
    finally:
        user_file.delete()
