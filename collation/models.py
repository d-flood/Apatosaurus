from django.db import models
from django.db.models.query import QuerySet
from django.contrib.auth import get_user_model

from lxml import etree as et


XML_NS = '{http://www.w3.org/XML/1998/namespace}'
TEI_NS = '{http://www.tei-c.org/ns/1.0}'


class Witness(models.Model):
    siglum = models.CharField(max_length=32)
    description = models.CharField(max_length=255, null=True, blank=True)


class Collation(models.Model):
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE, related_name='books')
    name = models.CharField(max_length=16)
    number = models.SmallIntegerField()
    description = models.TextField(null=True, blank=True)


class Chapter(models.Model):
    book = models.ForeignKey(Collation, on_delete=models.CASCADE, related_name='chapters')
    name = models.CharField(max_length=32, null=True, blank=True)
    number = models.SmallIntegerField()

    def ab_elements(self):
        self.abs: QuerySet[Ab]
        return [ab.as_element() for ab in self.abs.all()]


class Ab(models.Model):
    chapter = models.ForeignKey(Chapter, on_delete=models.CASCADE, related_name='abs')
    ab_id = models.CharField(max_length=10)
    basetext = models.TextField()
    number = models.SmallIntegerField()

    def as_element(self):
        self.apps: QuerySet[App]
        ab = et.Element(f'{XML_NS}ab')
        ab.set('id', self.ab_id)
        ab.text = self.basetext
        for app in self.apps.all():
            ab.append(app.as_element())


class App(models.Model):
    ab = models.ForeignKey(Ab, on_delete=models.CASCADE, related_name='apps')
    atype = models.CharField(max_length=9, default='main')
    index_from = models.SmallIntegerField()
    index_to = models.SmallIntegerField()
    connectivity = models.SmallIntegerField(default=10)

    def __str__(self) -> str:
        return f'{self.ab.ab_id}: {self.index_from}-{self.index_to}'

    def as_element(self) -> et._Element:
        self.rdgs: QuerySet[Rdg]
        app = et.Element(f'{TEI_NS}app', {'type': self.atype, 'from': str(self.index_from), 'to': str(self.index_to)})
        graph = et.Element(f'{TEI_NS}graph', {'type': 'directed'})
        for rdg in self.rdgs.all():
            app.append(rdg.as_element())
            graph.append(et.Element(f'{TEI_NS}node', {'n': rdg.name}))
        note = et.Element(f'{TEI_NS}note')
        fs = et.Element(f'{TEI_NS}fs')
        f = et.Element(f'{TEI_NS}f')
        numeric = et.Element(f'{TEI_NS}numeric')
        numeric.set('value', str(self.connectivity))
        f.append(numeric)
        fs.append(f)
        note.append(fs)
        note.append(graph)
        app.append(note)
        return app


class Rdg(models.Model):
    app = models.ForeignKey(App, on_delete=models.CASCADE, related_name='rdgs')
    name = models.CharField(max_length=5)
    varSeq = models.SmallIntegerField()
    rtype = models.CharField(max_length=16, null=True, blank=True)
    wit = models.ManyToManyField(Witness, related_name='rdgs')
    text = models.TextField(null=True, blank=True)

    active = models.BooleanField(default=True)
    modified = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f'{self.app.ab.ab_id}U{self.app.index_from}-{self.app.index_to} {self.name}'

    def as_element(self) -> et._Element:
        rdg = et.Element(f'{TEI_NS}rdg')
        witnesses = ' '.join([w.siglum for w in self.wit.all()]) 
        rdg.set('wit', witnesses)
        rdg.set('varSeq', str(self.varSeq))
        if self.rtype:
            rdg.set('type', self.rtype)
        rdg.text = self.text
        return rdg

    class Meta:
        ordering = ['varSeq']
        constraints = [
            models.UniqueConstraint(fields=['app', 'varSeq'], name='unique_varSeq'),
            models.UniqueConstraint(fields=['app', 'name'], name='unique_name'),
        ]


class Arc(models.Model):
    app = models.ForeignKey(App, on_delete=models.CASCADE, related_name='arcs')
    rdg_from = models.ForeignKey(Rdg, on_delete=models.CASCADE, related_name='arcs_from')
    rdg_to = models.ForeignKey(Rdg, on_delete=models.CASCADE, related_name='arcs_to')

    def __str__(self) -> str:
        return f'{self.app.ab.ab_id}U{self.app.index_from}-{self.app.index_to} {self.rdg_from.name} -> {self.rdg_to.name}'
