import csv
import json
import string

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import models
from django.db.models import Count, OuterRef, Q, QuerySet, Subquery, Sum
from django.template.defaultfilters import slugify
from django.utils import timezone
from lxml import etree as et

from accounts.models import JobStatus, UserFile

XML_NS = "{http://www.w3.org/XML/1998/namespace}"
TEI_NS = "{http://www.tei-c.org/ns/1.0}"
XML_NS_STR = "http://www.w3.org/XML/1998/namespace"
TEI_NS_STR = "http://www.tei-c.org/ns/1.0"


def unique_slugify(_model, initial_value: str):
    slug = slugify(initial_value)
    unique_slug = slug
    num = 1
    while _model.objects.filter(slug=unique_slug).exists():
        unique_slug = f"{slug}-{num}"
        num += 1
    return unique_slug


class Witness(models.Model):
    siglum = models.CharField(max_length=32)
    description = models.CharField(max_length=255, null=True, blank=True)
    default = models.BooleanField(default=False)
    user = models.ForeignKey(
        get_user_model(),
        on_delete=models.CASCADE,
        related_name="witnesses",
        null=True,
        blank=True,
    )

    class Meta:
        unique_together = ("siglum", "user")
        indexes = [models.Index(fields=["siglum"])]

    def __str__(self):
        return self.siglum

    def get_by_siglum(siglum: str, user=None):
        """
        Returns a Witness object by siglum and prefers default witnesses.
        """
        if (
            wits := Witness.objects.filter(siglum=siglum, default=False, user=user)
        ).exists():
            return wits.order_by("-default").first()
        else:
            return Witness.objects.filter(siglum=siglum, default=True).first()


class Collation(models.Model):
    user = models.ForeignKey(
        get_user_model(), on_delete=models.CASCADE, related_name="collations"
    )
    name = models.CharField(max_length=64)
    description = models.TextField(null=True, blank=True)
    slug = models.SlugField(max_length=84, null=True, blank=True)

    def as_tei(self, job_pk: int = 0, ignore_rdg_types: list[str] | None = None) -> str:
        tei_root = et.Element("TEI", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        total_abs = Ab.objects.filter(section__collation=self).count()
        section: Section
        for section in self.sections.all():  # type: ignore
            for ab in section.ab_elements(job_pk, total_abs, ignore_rdg_types):
                tei_root.append(ab)
        wits = add_tei_header(tei_root)
        return et.tostring(tei_root, encoding="unicode", pretty_print=True)  # type: ignore

    def __str__(self):
        return f"{self.user} - {self.name}"

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(f"{self.user.display_name}-{self.name}")  # type: ignore
        super().save(*args, **kwargs)

    def get_all_witnesses(self):
        return Witness.objects.filter(rdgs__app__ab__section__collation=self).distinct()

    def get_all_apps(self):
        return App.objects.filter(ab__section__collation=self, deleted=False)

    def get_all_arcs(self):
        return Arc.objects.filter(app__ab__section__collation=self)

    def get_all_rdgs(self):
        return Rdg.objects.filter(app__ab__section__collation=self)

    def get_owner(self):
        return self.user

    def build_index(self, child_rdg_types: list[str] | None = None):
        # delete all existing AppIndex and RdgIndex objects
        AppIndex.objects.filter(collation=self).delete()
        RdgIndex.objects.filter(app_index__collation=self).delete()
        if not child_rdg_types:
            child_rdg_types = []
        # iterate over all Apps in the Collation
        for app in App.objects.filter(ab__section__collation=self, deleted=False):
            app_indices = (
                f"{app.index_from}-{app.index_to}"
                if app.index_from != app.index_to
                else f"{app.index_from}"
            )
            app_index = AppIndex.objects.create(
                collation=self, app_pk=app.pk, name=f"{app.ab.name}U{app_indices}"
            )
            if child_rdg_types:
                rdgs = app.rdgs.filter(arcs_from=None, arcs_to=None)
                arcs = app.arcs.all()
            else:
                rdgs = app.rdgs.all()
                arcs = []
            # first gather readings not related to an Arc
            for rdg in rdgs:
                rdg_index = RdgIndex.objects.create(
                    app_index=app_index,
                    rdg_pk=rdg.pk,
                    name=rdg.name,
                    rtype=rdg.rtype,
                )
                rdg_index.witnesses.set(rdg.wit.all())
            # then gather readings related to an Arc; if there are any, conditionally collapse child and parent rdgs
            arc: Arc
            for arc in arcs:
                if arc.rdg_to.rtype in child_rdg_types:
                    # add the witnesses of rdg_to to rdg_from
                    rdg_parent = RdgIndex.objects.create(
                        app_index=app_index,
                        rdg_pk=arc.rdg_from.pk,
                        name=arc.rdg_from.name,
                        rtype=arc.rdg_from.rtype,
                    )
                    parent_witnesses = arc.rdg_from.wit.all() | arc.rdg_to.wit.all()
                    rdg_parent.witnesses.set(parent_witnesses)
                else:
                    rdg_index = RdgIndex.objects.create(
                        app_index=app_index,
                        rdg_pk=arc.rdg_to.pk,
                        name=arc.rdg_to.name,
                        rtype=arc.rdg_to.rtype,
                    )
                    rdg_index.witnesses.set(arc.rdg_to.wit.all())
                    rdg_index = RdgIndex.objects.create(
                        app_index=app_index,
                        rdg_pk=arc.rdg_from.pk,
                        name=arc.rdg_from.name,
                        rtype=arc.rdg_from.rtype,
                    )
                    rdg_index.witnesses.set(arc.rdg_from.wit.all())
            if app_index.rdg_indexes.count() == 1:
                app_index.rdg_indexes.all().delete()

    class Meta:
        unique_together = ("user", "name")
        indexes = [models.Index(fields=["name"])]


class Section(models.Model):
    collation = models.ForeignKey(
        Collation, on_delete=models.CASCADE, related_name="sections"
    )
    name = models.CharField(max_length=64, null=False, blank=True)
    number = models.SmallIntegerField()
    published = models.BooleanField(default=False)
    slugname = models.CharField(max_length=64, null=True, blank=True)

    def ab_elements(
        self,
        job_pk: int = 0,
        total_abs: int = 0,
        ignore_rdg_types: list[str] | None = None,
    ):
        self.abs: QuerySet[Ab]
        elements = []
        for i, ab in enumerate(self.abs.all(), start=1):
            elements.append(ab.as_element(ignore_rdg_types))
            if job_pk:
                if not total_abs:
                    total_abs = self.abs.count()
                JobStatus.objects.filter(pk=job_pk).update(
                    progress=round((i / total_abs) * 100, 1),
                    message=f"Converted {self.collation.name}, {self.name}, {ab.name} to TEI",
                )
        return elements

    def as_tei(self, job_pk: int = 0, ignore_rdg_types: list[str] | None = None) -> str:
        tei_root = et.Element("TEI", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        total_abs = self.abs.count()
        for ab in self.ab_elements(job_pk, total_abs, ignore_rdg_types):
            tei_root.append(ab)
        wits = add_tei_header(tei_root)
        return et.tostring(tei_root, encoding="unicode", pretty_print=True)  # type: ignore

    def all_app_labels(self):
        apps: list[str] = []
        for ab in self.abs.all():
            apps.extend(
                f"{ab.name}U{app.index_from}-{app.index_to}"
                for app in ab.active_apps.all()
            )
        return apps

    def get_all_witnesses(self):
        return Witness.objects.filter(rdgs__app__ab__section=self).distinct()

    def get_all_apps(self):
        return App.objects.filter(ab__section=self, deleted=False)

    def get_all_arcs(self):
        return Arc.objects.filter(app__ab__section=self)

    def get_all_rdgs(self):
        return Rdg.objects.filter(app__ab__section=self)

    def get_owner(self):
        return self.collation.user

    def __str__(self):
        return f"{self.collation.name} - {self.name}"

    def save(self, *args, **kwargs):
        if not self.slugname:
            self.slugname = slugify(self.name)
        super().save(*args, **kwargs)

    class Meta:
        ordering = ["number"]
        unique_together = ["collation", "name"]


class Ab(models.Model):
    section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name="abs")
    name = models.CharField(max_length=32, verbose_name="ID")
    basetext_label = models.CharField(max_length=32, verbose_name="Basetext Label")
    basetext = models.TextField()
    number = models.SmallIntegerField()
    indexed_basetext = models.JSONField(null=True, blank=True, default=list)
    note = models.TextField(null=True, blank=True)
    slugname = models.CharField(max_length=64, null=True, blank=True)
    right_to_left = models.BooleanField(default=False)

    def as_element(self, ignore_rdg_types: list[str] | None = None) -> et._Element:
        ab = et.Element("ab")  # type: ignore
        ab.set(f"{XML_NS}id", self.name.replace(":", ".").replace(" ", "_"))
        ab.text = self.basetext
        apps = (
            filter_apps_by_rtype(ignore_rdg_types, self.active_apps.all())
            if ignore_rdg_types
            else self.active_apps.all()
        )
        for app in apps:
            ab.append(app.as_element())
        return ab

    def as_tei(self, ignore_rdg_types: list[str] | None = None) -> str:
        tei_root = et.Element("TEI", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        tei_root.append(self.as_element(ignore_rdg_types))
        add_tei_header(tei_root)
        return et.tostring(tei_root, encoding="unicode", pretty_print=True)  # type: ignore

    def set_indexed_basetext(self):
        indexed_basetext = []
        if self.active_apps.count() > 0:
            for i, word in enumerate(self.basetext.split(), start=1):
                index = i * 2
                for app in self.active_apps.filter(deleted=False):
                    if app.index_from % 2 != 0 and index - 1 == app.index_from:
                        indexed_basetext.append(
                            {
                                "word": "-",
                                "index": index - 1,
                                "is_variant": True,
                                "app_pk": app.pk,
                            }
                        )
                    elif app.index_from <= index <= app.index_to:
                        indexed_basetext.append(
                            {
                                "word": word,
                                "index": index,
                                "is_variant": True,
                                "app_pk": app.pk,
                            }
                        )
                        break
                else:
                    indexed_basetext.append(
                        {
                            "word": word,
                            "index": index,
                            "is_variant": False,
                            "app_pk": None,
                        }
                    )
        else:
            indexed_basetext = [
                {"word": word, "index": i * 2, "is_variant": False, "app_pk": None}
                for i, word in enumerate(self.basetext.split(), start=1)
            ]
        if self.right_to_left:
            indexed_basetext.reverse()
        self.indexed_basetext = indexed_basetext

    @property
    def active_apps(self):
        self.apps: QuerySet[App]
        return self.apps.filter(deleted=False)

    def get_all_witnesses(self):
        return Witness.objects.filter(rdgs__app__ab=self)

    def get_all_apps(self):
        return self.apps.filter(deleted=False)

    def get_all_arcs(self):
        return Arc.objects.filter(app__ab=self)

    def get_all_rdgs(self):
        return Rdg.objects.filter(app__ab=self)

    def get_owner(self):
        return self.section.collation.user

    def save(self, *args, **kwargs):
        if not self.slugname:
            self.slugname = slugify(self.name)
        if not self.pk:
            super().save(*args, **kwargs)
        self.set_indexed_basetext()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.section.collation.user})"

    class Meta:
        ordering = ["number"]


class CollationConfig(models.Model):
    ab = models.OneToOneField(
        Ab, on_delete=models.CASCADE, related_name="collation_config"
    )
    witnesses = models.ManyToManyField(Witness, related_name="collation_configs")
    basetext = models.ForeignKey(
        Witness, on_delete=models.CASCADE, related_name="is_basetext_for", null=True
    )
    transcription_name = models.CharField(max_length=32, null=True)
    updated = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.ab.name}"

    class Meta:
        ordering = ["-updated"]


class App(models.Model):
    ab = models.ForeignKey(Ab, on_delete=models.CASCADE, related_name="apps")
    atype = models.CharField(max_length=9, default="main")
    index_from = models.SmallIntegerField()
    index_to = models.SmallIntegerField()
    connectivity = models.SmallIntegerField(default=10)
    slugname = models.CharField(max_length=32, null=True, blank=True)
    updated = models.DateTimeField(auto_now=True)
    deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["index_from"]

    def __str__(self) -> str:
        return f"{self.ab.name}: {self.index_from}-{self.index_to}"

    def as_element(self) -> et._Element:
        self.rdgs: QuerySet[Rdg]
        app = et.Element(
            "app",
            {
                "n": f'{self.ab.name.replace(":", ".").replace(" ", "_")}',
                "type": self.atype,
                "from": str(self.index_from),
                "to": str(self.index_to),
            },
            nsmap={None: TEI_NS_STR, "xml": XML_NS_STR},
        )  # type: ignore
        graph = et.Element("graph", {"type": "directed"}, nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        for rdg in self.rdgs.filter(witDetail=False):
            app.append(rdg.as_element())
            graph.append(et.Element("node", {"n": rdg.name}))  # type: ignore
        for wit_detail in self.rdgs.filter(witDetail=True):
            app.append(wit_detail.as_element())
            graph.append(et.Element("node", {"n": wit_detail.name}))  # type: ignore
        note = et.Element("note", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        fs = et.Element("fs", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        f = et.Element("f", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        numeric = et.Element("numeric", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        numeric.set("value", str(self.connectivity))
        f.append(numeric)
        fs.append(f)
        note.append(fs)
        note.append(graph)
        app.append(note)
        for arc in self.arcs.all():  # type: ignore
            graph.append(
                et.Element("arc", {"from": arc.rdg_from.name, "to": arc.rdg_to.name}, nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
            )
        return app

    def mark_deleted(self):
        self.deleted = True
        self.save()

    def combine_with(self, other_app: "App"):
        """
        Create and return a new App which combines the values of self and other_app. Marks both as deleted.
        """
        if self.ab != other_app.ab:
            raise ValueError("Cannot combine Apps from different Abs")
        if not (
            self.index_from
            == self.index_to
            == other_app.index_from
            == other_app.index_to
        ) and (
            self.index_from <= other_app.index_from <= self.index_to
            or self.index_from <= other_app.index_to <= self.index_to
        ):
            raise ValueError("Cannot combine overlapping Apps")
        if (
            self.rdgs.filter(witDetail=True).exists()
            or other_app.rdgs.filter(witDetail=True).exists()
        ):
            raise ValueError("Cannot combine Apps with abimiguous witnesses")
        if (
            self.index_from
            == self.index_to
            == other_app.index_from
            == other_app.index_to
        ):
            before_app = self
            after_app = other_app
        else:
            before_app = self if self.index_from < other_app.index_from else other_app
            after_app = self if self.index_from > other_app.index_from else other_app
        new_app = App.objects.create(
            ab=self.ab,
            atype=self.atype,
            index_from=min(self.index_from, other_app.index_from),
            index_to=max(self.index_to, other_app.index_to),
            connectivity=self.connectivity,
        )
        rdg_wits: dict[str, list[str]] = {}
        for w in self.rdgs.values_list("wit__pk", flat=True).union(
            other_app.rdgs.values_list("wit__pk", flat=True)
        ):
            if (
                before_app.rdgs.filter(wit__pk=w).exists()
                and after_app.rdgs.filter(wit__pk=w).exists()
            ):
                before_text = before_app.rdgs.get(wit__pk=w).text or ""
                after_text = after_app.rdgs.get(wit__pk=w).text or ""
                full_text = f"{before_text} {after_text}".strip()
            elif before_app.rdgs.filter(wit__pk=w).exists():
                full_text = before_app.rdgs.get(wit__pk=w).text or ""
            else:
                full_text = after_app.rdgs.get(wit__pk=w).text or ""
            if full_text in rdg_wits:
                rdg_wits[full_text].append(w)
            else:
                rdg_wits[full_text] = [w]
        # create the new rdgs
        self.mark_deleted()
        other_app.mark_deleted()
        for text, wits, name in zip(
            rdg_wits.keys(), rdg_wits.values(), string.ascii_lowercase
        ):
            rdg = Rdg(app=new_app, name=name, text=text)
            rdg.save(create_history=False)
            rdg.wit.set(Witness.objects.filter(pk__in=wits).distinct())
        self.ab.save()
        return new_app

    def save(self, *args, ab_pk: int = 0, **kwargs):
        self.slugname = f"{self.index_from}-{self.index_to}"
        if not self.pk and ab_pk > 0:
            # then create the main rdg
            super().save(*args, **kwargs)
            words = []
            if self.ab.indexed_basetext:
                for word in self.ab.indexed_basetext:
                    if self.index_from <= word["index"] <= self.index_to:
                        words.append(word["word"])
                if self.ab.right_to_left:
                    words = words[::-1]
                Rdg(
                    app=self, name="a", varSeq=1, rtype="-", text=" ".join(words)
                ).save()
        super().save(*args, **kwargs)


def filter_apps_by_rtype(ignore_rtypes: list[str], variants: QuerySet[App]):
    """
    Filters out App objects if they contain only a single reading that is not in the ignore list.
    It does the equivalent of this (probably) less efficient query:
    ```
    for app in variants:
        rdgs = app.rdgs.exclude(rtype__in=ignore_rtypes)
        if rdgs.count() < 2:
            variants = variants.exclude(pk=app.pk)
    return variants
    ```
    """

    rdgs_count = (
        RdgIndex.objects.filter(app_index=OuterRef("pk"))
        .exclude(rtype__in=ignore_rtypes)
        .values("app_index")
        .annotate(cnt=Count("pk"))
        .values("cnt")
    )
    variants = variants.annotate(relevant_rdg_count=Subquery(rdgs_count))
    variants = variants.filter(relevant_rdg_count__gte=2)

    return variants


class Rdg(models.Model):
    RDG_CHOICES = (
        "amb",  # 'Ambiguous'),
        "corr",  # 'Correction'),
        "def",  # 'Defective'),
        "emm",  # 'Emendation'),
        "err",  # 'Error'),
        "insi",  # 'Insignificant'),
        "lac",  # 'Lacuna'),
        "ilc",  # 'Lectionary Adaptation'),
        "ns",  # 'Nomen Sacrum'),
        "orth",  # 'Orthographic'),
        "om",  # 'Omission'),
        "subr",  # 'Subreading'),
    )
    app = models.ForeignKey(App, on_delete=models.CASCADE, related_name="rdgs")
    name = models.CharField(max_length=64)
    varSeq = models.SmallIntegerField(default=1)
    rtype = models.CharField(max_length=64, default="-", verbose_name="Reading Type")
    text = models.TextField(null=True, blank=True)
    wit = models.ManyToManyField(
        Witness, related_name="rdgs", blank=True, verbose_name="Witnesses"
    )

    witDetail = models.BooleanField(default=False, verbose_name="Ambiguous Reading")
    target = models.ManyToManyField(
        "self", blank=True, verbose_name="Potential Readings"
    )

    modified = models.DateTimeField(auto_now=True)
    note = models.TextField(null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.name}"

    class Meta:
        ordering = ["name"]

    def save(self, create_history: bool = True, *args, **kwargs):
        if self._state.adding or not create_history:
            super().save(*args, **kwargs)
            return
        self.history: QuerySet[RdgHistory]
        rdg_history = RdgHistory.objects.create(
            rdg=self,
            name=self.name,
            text=self.text,
            rtype=self.rtype,
            modified=self.modified,
        )
        rdg_history.wit.set(self.wit.all())
        if self.history.count() > 4:
            self.history.last().delete()  # type: ignore
        if self.witDetail:
            targets = "/".join([trdg.name for trdg in self.target.all()])
            self.name = f"zw-{targets}"
        super().save(*args, **kwargs)

    def as_element(self) -> et._Element:
        if self.witDetail:
            witDetail = et.Element("witDetail", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
            witnesses = " ".join([w.siglum for w in self.wit.all()])
            rdgs = [r.name for r in self.target.all()]
            witDetail.set("varSeq", str(self.varSeq))
            witDetail.set("n", self.name)
            witDetail.set("wit", witnesses)
            witDetail.set("type", "ambiguous")
            witDetail.set("target", " ".join(rdgs))
            return witDetail
        else:
            rdg = et.Element("rdg", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
            witnesses = " ".join([w.siglum for w in self.wit.all()])
            rdg.set("wit", witnesses)
            rdg.set("varSeq", str(self.varSeq))
            rdg.set("n", self.name)
            if self.rtype:
                rdg.set("type", self.rtype)
            rdg.text = self.text
            return rdg


class RdgHistory(models.Model):
    rdg = models.ForeignKey(Rdg, on_delete=models.CASCADE, related_name="history")
    modified = models.DateTimeField(auto_now=True)

    name = models.CharField(max_length=64)
    rtype = models.CharField(max_length=64, default="-", verbose_name="Reading Type")
    text = models.TextField(null=True, blank=True)
    wit = models.ManyToManyField(
        Witness, related_name="history_rdgs", blank=True, verbose_name="Witnesses"
    )

    def restore(self):
        self.rdg.name, self.name = self.name, self.rdg.name
        self.rdg.rtype, self.rtype = self.rtype, self.rdg.rtype
        self.rdg.text, self.text = self.text, self.rdg.text
        old_wit = tuple(self.rdg.wit.all())
        self.rdg.wit.set(self.wit.all())
        self.wit.set(old_wit)
        self.rdg.save(create_history=False)
        self.save()

    class Meta:
        ordering = ["-modified"]


class Arc(models.Model):
    app = models.ForeignKey(App, on_delete=models.CASCADE, related_name="arcs")
    rdg_from = models.ForeignKey(
        Rdg, on_delete=models.CASCADE, related_name="arcs_from"
    )
    rdg_to = models.ForeignKey(Rdg, on_delete=models.CASCADE, related_name="arcs_to")

    def __str__(self) -> str:
        return f"{self.app.ab.name}U{self.app.index_from}-{self.app.index_to} {self.rdg_from.name} -> {self.rdg_to.name}"

    class Meta:
        # unique_together = ('app', 'rdg_from', 'rdg_to')
        constraints = [
            models.UniqueConstraint(
                fields=["app", "rdg_from", "rdg_to"], name="unique_arc"
            ),
        ]


def add_tei_header(xml: et._Element):
    XML_NS_STR = "http://www.w3.org/XML/1998/namespace"
    TEI_NS_STR = "http://www.tei-c.org/ns/1.0"

    def get_wits(xml):
        wits: set[str] = set()
        for rdg in xml.xpath("//rdg"):
            for wit in rdg.get("wit").split():
                wits.add(wit)
        return wits

    TEI = xml.getroottree().getroot()
    wits = get_wits(TEI)
    teiHeader = et.Element("teiHeader", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
    TEI.insert(0, teiHeader)  # type: ignore
    fileDesc = et.Element("fileDesc", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
    teiHeader.append(fileDesc)
    titleStmt = et.Element("titleStmt", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
    fileDesc.append(titleStmt)
    titleStmt_p = et.Element("p", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
    # TODO: Replace these 'temporary' statements with user-supplied statements
    titleStmt_p.text = "Temporary titleStmt for validation"
    titleStmt.append(titleStmt_p)
    publicationStmt = et.Element("titleStmt", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
    fileDesc.append(publicationStmt)
    publicationStmt_p = et.Element("p", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
    publicationStmt_p.text = "Temporary publicationStmt for validation"
    publicationStmt.append(publicationStmt_p)
    sourceDesc = et.Element("sourceDesc", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
    fileDesc.append(sourceDesc)
    listWit = et.Element("listWit", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
    sourceDesc.append(listWit)
    for wit in wits:
        witness = et.Element("witness", nsmap={None: TEI_NS_STR, "xml": XML_NS_STR})  # type: ignore
        witness.set("n", wit)
        listWit.append(witness)
    return wits


class AppIndex(models.Model):
    collation = models.ForeignKey(
        Collation,
        on_delete=models.CASCADE,
        related_name="app_indexes",
        null=True,
        blank=True,
    )
    app_pk = models.IntegerField()
    name = models.CharField(max_length=64)


class RdgIndex(models.Model):
    app_index = models.ForeignKey(
        AppIndex,
        on_delete=models.CASCADE,
        related_name="rdg_indexes",
        null=True,
        blank=True,
    )
    rdg_pk = models.IntegerField()
    name = models.CharField(max_length=64)
    rtype = models.CharField(max_length=64)
    witnesses = models.ManyToManyField(Witness, related_name="rdg_indexes")


class WitnessComparisonBase(models.Model):

    # subclasses must include a corpus_instance field that is a foreign key to Collation, Section, or Ab
    corpus_instance: Collation | Section | Ab = None
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE, null=True)

    matrix_file = models.ForeignKey(
        UserFile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=64)
    collapse_rdg_types = models.JSONField(null=True, blank=True, default=list)
    ignore_rdg_types = models.JSONField(null=True, blank=True, default=list)
    witness_threshold = models.SmallIntegerField(default=0)
    ignore_singular_readings = models.BooleanField(default=False)
    witnesses = models.JSONField(null=True, blank=True, default=list)

    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

    def __str__(self):
        return f"{self.corpus_instance.name} - {self.name}"

    def generate_comparison(self):
        """
        Generate a comparison matrix and creates a UserFile for it.
        """
        if not self.corpus_instance:
            raise ValueError(
                "corpus_instance must be set before generating a comparison"
            )
        self.user = self.corpus_instance.get_owner()
        cleaned_apps = self._get_cleaned_apps()
        matrix = self._create_matrix(cleaned_apps)
        encoded_matrix = json.dumps(matrix, ensure_ascii=False).encode("utf-8")

        now = timezone.now().strftime("%Y%m%d-%H%M%S")
        new_matrix_file = UserFile.objects.create(
            user=self.user,
            name=f"{self.name}_{now}_matrix.json",
            file=ContentFile(encoded_matrix, f"{self.name}_matrix.json"),
        )

        if self.matrix_file:
            self.matrix_file.name = (
                f"{self.matrix_file.name.replace('.json', '_replaced.json')}"
            )
            self.matrix_file.save()

        self.matrix_file = new_matrix_file

        self.save()

    def generate_csv(self):
        """
        Generate a CSV file from the comparison matrix.
        """
        if not self.matrix_file:
            raise ValueError("A comparison matrix must be generated first.")

        if not self.user:
            self.user = self.corpus_instance.get_owner()

        matrix: dict[str, dict[str, dict[str, int | float]]] = json.loads(
            self.matrix_file.file.read().decode("utf-8")
        )

        nodes = sorted(set(matrix.keys()))
        csv_data = [[""] + nodes]  # Header row

        for row_node in nodes:
            row = [row_node]
            for col_node in nodes:
                agreements = (
                    matrix.get(row_node, {}).get(col_node, {}).get("agreements", 0)
                )
                total_apps = (
                    matrix.get(row_node, {}).get(col_node, {}).get("total_apps", 1)
                )
                percentage = self._calc_percent(agreements, total_apps)
                row.append(f"{percentage:.1f}% ({agreements}/{total_apps})")
            csv_data.append(row)

        # Create a CSV file
        csv_data_str = "\n".join([",".join(row) for row in csv_data])
        encoded_csv_data = csv_data_str.encode("utf-8")

        now = timezone.now().strftime("%Y%m%d-%H%M%S")
        filename = f"{self.name}_{now}_matrix.csv"
        csv_file = UserFile.objects.create(
            user=self.user,
            name=filename,
            file=ContentFile(encoded_csv_data, filename),
        )
        return csv_file

    def _calc_percent(self, agreements: int, total_apps: int):
        if total_apps == 0:
            return 0.0
        return (agreements / total_apps) * 100

    def _get_cleaned_apps(self):
        cleaned_apps: list[list[set[str]]] = []
        for app in self.corpus_instance.get_all_apps():
            # only include apps that have more than one Rdg object whose rtype is not in ignore_these_rdg_types
            valid_agreements: list[set[str]] = []
            # get all Rdg objects that are not connected to any Arc objects
            for rdg in app.rdgs.filter(arcs_from__isnull=True, arcs_to__isnull=True):
                if rdg.rtype in self.ignore_rdg_types:
                    continue
                elif self.ignore_singular_readings and rdg.wit.count() == 1:
                    continue
                valid_agreements.append(
                    set(rdg.wit.all().values_list("siglum", flat=True)),  # type: ignore
                )

            # now collapse rdgs in the app
            # first, iterate over arcs whose rdg_to.rtype is in collapse_these_rdg_types
            arc: Arc
            for arc in app.arcs.filter(rdg_to__rtype__in=self.collapse_rdg_types):  # type: ignore
                # combine the witness sigla from both rdg_from and rdg_to
                combined_witnesses = set(
                    arc.rdg_from.wit.all().values_list("siglum", flat=True)  # type: ignore
                ) | set(
                    arc.rdg_to.wit.all().values_list("siglum", flat=True)  # type: ignore
                )  # type: ignore
                valid_agreements.append(combined_witnesses)
            # second, iterate over arcs that apparently contain two valid agreements—treat them separately
            for arc in app.arcs.exclude(rdg_to__rtype__in=self.collapse_rdg_types):  # type: ignore
                valid_agreements.append(
                    set(arc.rdg_from.wit.all().values_list("siglum", flat=True)),  # type: ignore
                )
                valid_agreements.append(
                    set(arc.rdg_to.wit.all().values_list("siglum", flat=True)),  # type: ignore
                )
            # check if the app is valid
            if len(valid_agreements) > 1:
                cleaned_apps.append(valid_agreements)
        return cleaned_apps

    def _create_matrix(self, cleaned_apps):
        matrix: dict[str, dict[str, dict[str, int | float]]] = {}
        if self.witnesses:
            all_witnesses = self.witnesses
        else:
            all_witnesses = (
                self.corpus_instance.get_all_witnesses()
                .annotate(rdg_count=Count("rdgs"))
                .filter(rdg_count__gte=self.witness_threshold)
                .distinct()
                .values_list("siglum", flat=True)
            )
        for first in all_witnesses:
            for second in all_witnesses:
                if first not in matrix:
                    matrix[first] = {}
                if second not in matrix[first]:
                    matrix[first][second] = {
                        "agreements": 0,
                        "total_apps": 0,
                    }
                if first == second:
                    continue
                first_in_app = False
                second_in_app = False
                for app in cleaned_apps:
                    for rdg in app:
                        if first in rdg and second in rdg:
                            matrix[first][second]["agreements"] += 1
                            matrix[first][second]["total_apps"] += 1
                            break
                        if first in rdg:
                            first_in_app = True
                        if second in rdg:
                            second_in_app = True
                    if first_in_app and second_in_app:
                        matrix[first][second]["total_apps"] += 1
                        first_in_app = False
                        second_in_app = False
        return matrix


class CollationComparison(WitnessComparisonBase):
    corpus_instance = models.ForeignKey(
        Collation, on_delete=models.CASCADE, related_name="comparisons"
    )


class SectionComparison(WitnessComparisonBase):
    corpus_instance = models.ForeignKey(
        Section, on_delete=models.CASCADE, related_name="comparisons"
    )


class AbComparison(WitnessComparisonBase):
    corpus_instance = models.ForeignKey(
        Ab, on_delete=models.CASCADE, related_name="comparisons"
    )
