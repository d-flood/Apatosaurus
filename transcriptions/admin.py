from django.contrib import admin

from transcriptions import models

admin.site.register(
    models.Transcription,
)
