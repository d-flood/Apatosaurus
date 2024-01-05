import re

from django.db.models import Q
from lxml import etree as et

from accounts.py.update_status import update_status
from collation import models
from collation.py.differentiate_subreading_ids import (
    differentiate_subreading_ids as diff_ids,
)
from collation.py.itsee_to_open_cbgm import reformat_xml

TEI_NS = "{http://www.tei-c.org/ns/1.0}"
XML_NS = "{http://www.w3.org/XML/1998/namespace}"
XML_NS_STR = "http://www.w3.org/XML/1998/namespace"
TEI_NS_STR = "http://www.tei-c.org/ns/1.0"


def parse_xml(text: str):
    text = text.replace('xml:id="1', 'xml:id="I')
    text = text.replace('xml:id="2', 'xml:id="II')
    text = text.replace('xml:id="3', 'xml:id="III')
    text = text.replace("subreading", "subr")
    try:
        xml_elem = et.fromstring(
            text.encode("utf-8"),
            parser=et.XMLParser(remove_blank_text=True, encoding="utf-8", recover=True),
        )
        xml = xml_elem.getroottree().getroot()
    except et.XMLSyntaxError:
        return None
    if re.search("<teiHeader>", text) is None:
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
    for elem in ab:  # type: ignore
        if elem.tag == "seg":
            if text := elem.text:
                basetext.append(text)
            else:
                print(f'seg element {elem.get(f"{TEI_NS}n")} has no text')
        elif elem.tag == f"{TEI_NS}seg":
            if text := elem.text:
                basetext.append(text)
            else:
                print(f'seg element {elem.get(f"{TEI_NS}n")} has no text')
        elif (
            elem.tag == f"{TEI_NS}app" is not None
            and (lem := elem.find(f"{TEI_NS}lem")) is not None
        ):
            if lem.get("type") == "om":
                continue
            lem = elem.find(f"{TEI_NS}lem")
            if lem is not None:
                if text := lem.text:
                    basetext.append(text)
                else:
                    print("lem text is None???")
    return " ".join(basetext)


def create_ab_instance(ab_elem: et._Element, section_pk: int, number: int) -> models.Ab:
    basetext = construct_basetext(ab_elem)
    if name := ab_elem.attrib.get(f"{XML_NS}id", ""):
        name = str(name).replace("-APP", "")
    else:
        name = f"{models.Section.objects.get(pk=section_pk).name}: {number}"
    if (lem := ab_elem.find(f"{TEI_NS}app/{TEI_NS}lem")) is not None:  # type: ignore
        basetext_label = lem.attrib.get("wit") or "unknown"
    else:
        basetext_label = "unknown"
    instance = models.Ab(
        section_id=section_pk,
        number=number,
        basetext=basetext,
        basetext_label=basetext_label,
        name=name,
    )
    instance.save()
    return instance


def create_app_instance(app_elem: et._Element, ab_pk: int):
    if (_index_from := app_elem.attrib.get("from")) and (
        _index_to := app_elem.attrib.get("to")
    ):
        index_from = int(_index_from)
        index_to = int(_index_to)
    elif n := str(
        app_elem.attrib.get("n")
    ):  # then maybe the format follows that of Joey's example: https://github.com/jjmccollum/open-cbgm/blob/master/examples/3_john_collation.xml
        if not "u" in n.lower():
            return
        index_single = re.search(r"u\d+", n.lower())
        index_range = re.search(r"u\d+-\d+", n.lower())
        if index_range:
            index = index_range.group(0)
        elif index_single:
            index = index_single.group(0)
        else:
            return
        if "-" in index:
            index_from, index_to = int(index.split("-")[0][1:]), int(
                index.split("-")[1]
            )
        else:
            index_from = int(index[1:])
            index_to = index_from
    else:
        return

    return models.App.objects.create(
        ab_id=ab_pk,
        atype="main",
        index_from=index_from,
        index_to=index_to,
        connectivity=10,
    )


def create_rdg_instance(rdg_elem: et._Element, app: models.App, user_pk: int):
    name = rdg_elem.attrib.get("n")
    varSeq = int(varSeq) if (varSeq := rdg_elem.attrib.get("varSeq")) else 0
    rtype = rdg_elem.attrib.get("type")
    if not rtype:
        rtype = "-"
    text = rdg_elem.text or ""
    if witnesses := rdg_elem.attrib.get("wit"):
        witnesses = witnesses.split()
        wits = []
        db_wits = models.Witness.objects.filter(
            Q(default=True) | Q(user_id=user_pk)
        ).order_by("-default")
        for w in witnesses:
            if not db_wits.filter(siglum=w).exists():
                wit_to_append = models.Witness.objects.create(siglum=w, user_id=user_pk)
            else:
                wit_to_append = db_wits.filter(siglum=w).first()

            wits.append(wit_to_append)
    else:
        wits = None
    rdg_instance = models.Rdg.objects.create(
        app_id=app.pk,
        name=name,
        varSeq=varSeq,
        rtype=rtype,
        text=text,
    )
    if wits:
        rdg_instance.wit.set(wits)
    return rdg_instance


def create_witDetail_rdg_instance(
    witDetail: et._Element, app: models.App, user_pk: int
):
    name = witDetail.attrib.get("n")
    varSeq = int(varSeq) if (varSeq := witDetail.attrib.get("varSeq")) else 0
    rtype = rtype if (rtype := witDetail.attrib.get("type")) else "ambiguous"
    if witnesses := witDetail.attrib.get("wit"):
        witnesses = witnesses.split()
        wits = []
        db_wits = models.Witness.objects.filter(
            Q(user_id=user_pk) | Q(default=True)
        ).order_by("-default")
        for w in witnesses:
            if not db_wits.filter(siglum=w).exists():
                wit_to_append = models.Witness.objects.create(siglum=w, user_id=user_pk)
            else:
                wit_to_append = db_wits.filter(siglum=w).first()
            wits.append(wit_to_append)
    else:
        wits = None
    if target := witDetail.attrib.get("target"):
        target = target.split()
        targets = []
        for t in target:
            try:
                targets.append(app.rdgs.filter(witDetail=False).get(name=t))
            except Exception as e:
                print(f"target not found: {t}\n{e}")
    else:
        targets = None
    rdg_instance = models.Rdg.objects.create(
        app_id=app.pk,
        name=name,
        varSeq=varSeq,
        rtype=rtype,
        witDetail=True,
    )
    if wits:
        rdg_instance.wit.set(wits)
    if targets:
        rdg_instance.target.set(targets)
    return rdg_instance


def create_arc_instance(app_elem: et._Element, app_pk: int):
    note_elem = app_elem.find(f"{TEI_NS}note")  # type: ignore
    if note_elem is None:
        return
    if (graph_elem := note_elem.find(f"{TEI_NS}graph")) is None:
        return
    for arc in graph_elem.findall(f"{TEI_NS}arc"):
        rdg_from = arc.attrib.get("from")
        rdg_to = arc.attrib.get("to")
        if not (
            rdg_from_instance := models.Rdg.objects.filter(
                app_id=app_pk, name=rdg_from
            ).first()
        ):
            print(f"rdg_from {rdg_from} not found in app {app_pk}")
            continue
        if not (
            rdg_to_instance := models.Rdg.objects.filter(
                app_id=app_pk, name=rdg_to
            ).first()
        ):
            print(f"rdg_to {rdg_to} not found in app {app_pk}")
            continue
        models.Arc.objects.create(
            rdg_from=rdg_from_instance,
            rdg_to=rdg_to_instance,
            app_id=app_pk,
        )


def tei_to_db(xml: et._Element, section_pk: int, job_pk: int, user_pk: int):
    total = len(xml.findall(f"{TEI_NS}ab"))  # type: ignore
    if total == 0:
        total = 1
    i = 1
    for i, ab_elem in enumerate(xml.xpath(f"//tei:ab", namespaces={"tei": TEI_NS_STR}), start=1):  # type: ignore
        update_status(
            job_pk,
            f'Importing {ab_elem.attrib.get(f"{XML_NS}id", "")}',
            int(i / total * 100),
        )
        ab_instance = create_ab_instance(ab_elem, section_pk, i)
        for app_elem in ab_elem.findall(f"{TEI_NS}app"):
            if not (app := create_app_instance(app_elem, ab_instance.pk)):
                continue
            for rdg_elem in app_elem.findall("rdg", namespaces={None: TEI_NS_STR, "xml": XML_NS_STR}):  # type: ignore
                if not (rdg_instance := create_rdg_instance(rdg_elem, app, user_pk)):
                    continue
            for witDetail in app_elem.findall(
                "witDetail", namespaces={None: TEI_NS_STR, "xml": XML_NS_STR}
            ):
                if not (
                    rdg_instance := create_witDetail_rdg_instance(
                        witDetail, app, user_pk
                    )
                ):
                    continue
            create_arc_instance(app_elem, app.pk)
        ab_instance.save()
        print(f"added {ab_instance.name} to db")
