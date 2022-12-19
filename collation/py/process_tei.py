import re
from django.core.files.uploadedfile import UploadedFile

from lxml import etree as et

from accounts.models import JobStatus
from accounts.py.update_status import update_status
from collation import models
from collation.py.itsee_to_open_cbgm import reformat_xml
from collation.py.differentiate_subreading_ids import differentiate_subreading_ids as diff_ids


TEI_NS = '{http://www.tei-c.org/ns/1.0}'
XML_NS = '{http://www.w3.org/XML/1998/namespace}'
XML_NS_STR = 'http://www.w3.org/XML/1998/namespace'
TEI_NS_STR = 'http://www.tei-c.org/ns/1.0'

def parse_xml(xml_file: UploadedFile) -> et._Element|None:
    text: str = xml_file.read().decode('utf-8', errors='ignore')
    text = text.replace('xml:id="1', 'xml:id="I')
    text = text.replace('xml:id="2', 'xml:id="II')
    text = text.replace('xml:id="3', 'xml:id="III')
    text = text.replace('subreading', 'subr')
    try:
        xml_elem = et.fromstring(text.encode('utf-8'), parser=et.XMLParser(remove_blank_text=True, encoding='utf-8', recover=True))
        xml = xml_elem.getroottree().getroot()
    except et.XMLSyntaxError:
        return None
    if re.search('<teiHeader>', text) is None:
        try:
            xml = reformat_xml(xml)
            xml = diff_ids(xml)
        except Exception as e:
            print(e)
            return None
    return xml


def construct_basetext(ab: et._Element) -> str:
    if ab.text:
        return ab.text
    basetext = []
    for elem in ab:
        if elem.tag == 'seg':
            if text := elem.text:
                basetext.append(text)
            else:
                print(f'seg element {elem.get(f"{TEI_NS}n")} has no text')
        elif elem.tag == f'{TEI_NS}seg':
            if text := elem.text:
                basetext.append(text)
            else:
                print(f'seg element {elem.get(f"{TEI_NS}n")} has no text')
        elif elem.tag == f'{TEI_NS}app' is not None and (lem := elem.find(f'{TEI_NS}lem')) is not None:
            if lem.get('type') == 'om':
                continue
            lem = elem.find(f'{TEI_NS}lem')
            if lem is not None:
                if text := lem.text:
                    basetext.append(text)
                else:
                    print('lem text is None???')
    return ' '.join(basetext)


def create_ab_instance(ab_elem: et._Element, section_id: int, number: int) -> models.Ab:
    basetext = construct_basetext(ab_elem)
    if name := ab_elem.attrib.get(f'{XML_NS}id', ''):
        name = str(name).replace('-APP', '')
    else:
        name = f'{models.Section.objects.get(pk=section_id).name}: {number}'
    if (lem := ab_elem.find(f'{TEI_NS}app/{TEI_NS}lem')) is not None:
        basetext_label = lem.attrib.get('wit') or 'unknown'
    else:
        basetext_label = 'unknown'
    instance =  models.Ab(
        section_id=section_id, 
        number=number, 
        basetext=basetext, 
        basetext_label=basetext_label, 
        name=name
    )
    instance.save()
    return instance


def create_app_instance(app_elem: et._Element, ab_pk: int) -> models.App|None:
    if _index_from := app_elem.attrib.get('from'):
        index_from = int(_index_from)
    else:
        return
    if _index_to := app_elem.attrib.get('to'):
        index_to = int(_index_to)
    else:
        return

    return models.App.objects.create(
        ab_id=ab_pk, 
        atype='main',
        index_from=index_from,
        index_to=index_to,
        connectivity=10,
    )


def create_rdg_instance(rdg_elem: et._Element, app_pk: int, user_pk: int) -> models.Rdg|None:
    name = rdg_elem.attrib.get('n')
    varSeq = int(varSeq) if (varSeq := rdg_elem.attrib.get('varSeq')) else 0
    rtype = rdg_elem.attrib.get('type')
    if not rtype:
        rtype = '0'
    text = rdg_elem.text or ''
    if witnesses := rdg_elem.attrib.get('wit'):
        witnesses = witnesses.split()
        wits = []
        for w in witnesses:
            if w not in models.Witness.objects.values_list('siglum', flat=True):
                wit_to_append = models.Witness.objects.create(siglum=w, user_id=user_pk)
            else:
                wit_to_append = models.Witness.objects.get(siglum=w)
            wits.append(wit_to_append)
    else:
        wits = None
    rdg_instance = models.Rdg.objects.create(
        app_id=app_pk,
        name=name,
        varSeq=varSeq,
        rtype=rtype,
        text=text,
        active=True,
    )
    if wits:
        rdg_instance.wit.set(wits)
    return rdg_instance


def create_arc_instance(app_elem: et._Element, app_pk: int):
    note_elem = app_elem.find(f'{TEI_NS}note')
    if note_elem is None:
        return
    graph_elem = note_elem.find(f'{TEI_NS}graph')
    if graph_elem is not None:
        for arc in graph_elem.findall(f'{TEI_NS}arc'):
            rdg_from = arc.attrib.get('from')
            rdg_to = arc.attrib.get('to')
            rdg_from_instance = models.Rdg.objects.filter(app_id=app_pk, name=rdg_from).first()
            rdg_to_instance = models.Rdg.objects.filter(app_id=app_pk, name=rdg_to).first()
            models.Arc.objects.create(
                rdg_from=rdg_from_instance,
                rdg_to=rdg_to_instance,
                app_id=app_pk,
            )


def tei_to_db(xml: et._Element, section_id: int, job_pk: int, user_pk: int):
    total = len(xml.findall(f'{TEI_NS}ab'))
    if total == 0:
        total = 1
    i = 1
    try:
        for i, ab_elem in enumerate(xml.findall(f'{TEI_NS}ab'), start=1):
            update_status(job_pk, f'Importing {ab_elem.attrib.get(f"{XML_NS}id", "")}', int(i/total*100))
            ab_instance = create_ab_instance(ab_elem, section_id, i)
            for app_elem in ab_elem.findall(f'{TEI_NS}app'):
                if not (app := create_app_instance(app_elem, ab_instance.pk)):
                    continue
                for rdg_elem in app_elem.findall('rdg', namespaces={None: TEI_NS_STR, 'xml': XML_NS_STR}): #type: ignore
                    if not (rdg_instance := create_rdg_instance(rdg_elem, app.pk, user_pk)):
                        continue
                create_arc_instance(app_elem, app.pk)
            ab_instance.save()
            print(f'added {ab_instance.name} to db')
        update_status(job_pk, '', 100, False, True)
    except Exception as e:
        print(e)
        update_status(job_pk, f'Error: {e}', int(i/total*100), False, False, True)
