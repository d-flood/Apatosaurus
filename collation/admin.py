from django.contrib import admin

from collation import models

admin.site.register((
    models.Collation,
    models.Section,
    models.Ab,
    models.App,
    models.Witness,
    models.Rdg,
    models.Arc,
    models.RdgHistory,
))
