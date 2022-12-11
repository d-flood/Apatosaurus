import contextlib
from django.db import models
from django.db.models.query import QuerySet
from django.contrib.auth import get_user_model

from lxml import etree as et


XML_NS = '{http://www.w3.org/XML/1998/namespace}'
TEI_NS = '{http://www.tei-c.org/ns/1.0}'
XML_NS_STR = 'http://www.w3.org/XML/1998/namespace'
TEI_NS_STR = 'http://www.tei-c.org/ns/1.0'


class Witness(models.Model):
    siglum = models.CharField(max_length=32)
    description = models.CharField(max_length=255, null=True, blank=True)
    default = models.BooleanField(default=False)
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE, related_name='witnesses', null=True, blank=True)

    def __str__(self):
        return self.siglum

    class Meta:
        unique_together = ('siglum', 'user')
        indexes = [models.Index(fields=['siglum'])]


class Collation(models.Model):
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE, related_name='collations')
    name = models.CharField(max_length=64)
    description = models.TextField(null=True, blank=True)

    def as_tei(self):
        tei_root = et.Element('TEI', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        for section in self.sections.all(): #type: ignore
            for ab in section.ab_elements():
                tei_root.append(ab)
        add_tei_header(tei_root)
        return et.tostring(tei_root, encoding='unicode', pretty_print=True)


class Section(models.Model):
    collation = models.ForeignKey(Collation, on_delete=models.CASCADE, related_name='sections')
    name = models.CharField(max_length=32, null=True, blank=True)
    number = models.SmallIntegerField()

    def ab_elements(self):
        self.abs: QuerySet[Ab]
        return [ab.as_element() for ab in self.abs.all()]

    def as_tei(self):
        tei_root = et.Element('TEI', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        for ab in self.ab_elements():
            tei_root.append(ab)
        add_tei_header(tei_root)
        return et.tostring(tei_root, encoding='unicode', pretty_print=True)

    def __str__(self):
        return f'{self.collation.name} - {self.name}'
    class Meta:
        ordering = ['number']


class Ab(models.Model):
    section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name='abs')
    name = models.CharField(max_length=10, verbose_name='ID')
    basetext_label = models.CharField(max_length=32, verbose_name='Basetext Label')
    basetext = models.TextField()
    number = models.SmallIntegerField()
    indexed_basetext = models.JSONField(null=True, blank=True, default=list)

    def as_element(self):
        ab = et.Element('ab')
        ab.set(f'{XML_NS}id', self.name)
        ab.text = self.basetext
        for app in self.apps.all():
            ab.append(app.as_element())
        return ab

    def as_tei(self):
        tei_root = et.Element('TEI', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        tei_root.append(self.as_element())
        add_tei_header(tei_root)
        return et.tostring(tei_root, encoding='unicode', pretty_print=True)

    def set_indexed_basetext(self):
        self.apps: QuerySet[App]
        indexed_basetext = []
        if self.apps.count() > 0:
            for i, word in enumerate(self.basetext.split(), start=1):
                index = i*2
                for app in self.apps.all():
                    if app.index_from % 2 != 0 and index-1 == app.index_from:
                        indexed_basetext.append({'word': '-', 'index': index-1, 'is_variant': True, 'app_pk': app.pk})
                    elif app.index_from <= index <= app.index_to:
                        indexed_basetext.append({'word': word, 'index': index, 'is_variant': True, 'app_pk': app.pk})
                        break
                else:
                    indexed_basetext.append({'word': word, 'index': index, 'is_variant': False, 'app_pk': None})
        else:
            indexed_basetext = [{'word': word, 'index': i*2, 'is_variant': False, 'app_pk': None} for i, word in enumerate(self.basetext.split(), start=1)]
        self.indexed_basetext = indexed_basetext
        
    def save(self, *args, **kwargs):
        index_basetext_again = False
        with contextlib.suppress(ValueError):
            self.set_indexed_basetext()
        super().save(*args, **kwargs)
        

    def __str__(self):
        return f'{self.name} ({self.section.collation.user})'
    
    class Meta:
        ordering = ['number']
        # ordering = ['name']


class App(models.Model):
    ab = models.ForeignKey(Ab, on_delete=models.CASCADE, related_name='apps')
    atype = models.CharField(max_length=9, default='main')
    index_from = models.SmallIntegerField()
    index_to = models.SmallIntegerField()
    connectivity = models.SmallIntegerField(default=10)

    class Meta:
        ordering = ['index_from']

    def __str__(self) -> str:
        return f'{self.ab.name}: {self.index_from}-{self.index_to}'

    def as_element(self) -> et._Element:
        self.rdgs: QuerySet[Rdg]
        app = et.Element(
            'app', 
            {
                'type': self.atype, 
                'from': str(self.index_from), 
                'to': str(self.index_to)
            }, 
            nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        graph = et.Element('graph', {'type': 'directed'}, nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        for rdg in self.rdgs.all():
            app.append(rdg.as_element())
            graph.append(et.Element('node', {'n': rdg.name}))
        note = et.Element('note', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        fs = et.Element('fs', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        f = et.Element('f', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        numeric = et.Element('numeric', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        numeric.set('value', str(self.connectivity))
        f.append(numeric)
        fs.append(f)
        note.append(fs)
        note.append(graph)
        app.append(note)
        for arc in self.arcs.all(): #type: ignore
            graph.append(
                et.Element('arc', {'from': arc.rdg_from.name, 'to': arc.rdg_to.name}, nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
                )
        return app


class Rdg(models.Model):
    RDG_CHOICES = [
        ('0', '-'),
        ('orth', 'Orthographic'),
        ('subr', 'Subreading'),
        ('def', 'Defective'),
        ('lac', 'Lacuna'),
        ('ns', 'Nomen Sacrum'),
        ('emm', 'Emendation'),
        ('ilc', 'Lectionary Adaptation'),
        ('insi', 'Insignificant'),
        ('err', 'Error'),
        ('om', 'Omission'),
    ]
    app = models.ForeignKey(App, on_delete=models.CASCADE, related_name='rdgs')
    name = models.CharField(max_length=5)
    varSeq = models.SmallIntegerField(default=1)
    rtype = models.CharField(max_length=5, choices=RDG_CHOICES, default='0', verbose_name='Reading Type')
    text = models.TextField(null=True, blank=True)
    wit = models.ManyToManyField(Witness, related_name='rdgs', blank=True, verbose_name='Witnesses')

    active = models.BooleanField(default=True)
    modified = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f'{self.name}'

    def as_element(self) -> et._Element:
        rdg = et.Element('rdg', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        witnesses = ' '.join([w.siglum for w in self.wit.all()]) 
        rdg.set('wit', witnesses)
        rdg.set('varSeq', str(self.varSeq))
        rdg.set('n', self.name)
        if self.rtype:
            rdg.set('type', self.rtype)
        rdg.text = self.text
        return rdg

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['app', 'name'], name='unique_name'),
        ]


class Arc(models.Model):
    app = models.ForeignKey(App, on_delete=models.CASCADE, related_name='arcs')
    rdg_from = models.ForeignKey(Rdg, on_delete=models.CASCADE, related_name='arcs_from')
    rdg_to = models.ForeignKey(Rdg, on_delete=models.CASCADE, related_name='arcs_to')

    def __str__(self) -> str:
        return f'{self.app.ab.name}U{self.app.index_from}-{self.app.index_to} {self.rdg_from.name} -> {self.rdg_to.name}'

    class Meta:
        unique_together = ('app', 'rdg_from', 'rdg_to')


def add_tei_header(xml: et._Element):
    XML_NS_STR = 'http://www.w3.org/XML/1998/namespace'
    TEI_NS_STR = 'http://www.tei-c.org/ns/1.0'
    def get_wits(xml):
        wits = []
        distinct_wits = set()
        for rdg in xml.xpath('//rdg'):
            for wit in rdg.get('wit').split():
                if wit not in distinct_wits:
                    distinct_wits.add(wit)
                    wits.append(wit)
        return wits
    TEI = xml.getroottree().getroot()
    wits = get_wits(TEI)
    teiHeader = et.Element('teiHeader', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
    TEI.insert(0, teiHeader)                                                   #type: ignore
    fileDesc = et.Element('fileDesc', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
    teiHeader.append(fileDesc)
    titleStmt = et.Element('titleStmt', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
    fileDesc.append(titleStmt)
    titleStmt_p = et.Element('p', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
    # TODO: Replace these 'temporary' statements with user-supplied statements
    titleStmt_p.text = 'Temporary titleStmt for validation'
    titleStmt.append(titleStmt_p)
    publicationStmt= et.Element('titleStmt', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
    fileDesc.append(publicationStmt)
    publicationStmt_p = et.Element('p', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
    publicationStmt_p.text = 'Temporary publicationStmt for validation'
    publicationStmt.append(publicationStmt_p )
    sourceDesc = et.Element('sourceDesc', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
    fileDesc.append(sourceDesc) 
    listWit = et.Element('listWit', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
    sourceDesc.append(listWit)
    for wit in wits:
        witness = et.Element('witness', nsmap={None: TEI_NS_STR, 'xml': XML_NS_STR}) #type: ignore
        witness.set('n', wit)
        listWit.append(witness)
    return
