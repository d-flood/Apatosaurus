from django.contrib import admin

from transcriptions import models


class TranscriptionAdmin(admin.ModelAdmin):
    search_fields = (
        "name",
        "witness__siglum",
    )
    list_filter = ("user",)


admin.site.register(models.Transcription, TranscriptionAdmin)
