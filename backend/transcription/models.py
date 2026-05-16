import uuid

from django.db import models
from django.utils import timezone


class Transcription(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    siglum = models.CharField(max_length=64)
    description = models.TextField(blank=True, default="")
    content_json = models.JSONField(default=dict)
    format = models.CharField(max_length=32, default="normalized_ast_v1")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)
    owner = models.CharField(max_length=255, null=True, blank=True)
    is_public = models.BooleanField(default=False)
    tags = models.JSONField(default=list)
    transcriber = models.CharField(max_length=255, blank=True, default="")
    repository = models.CharField(max_length=255, blank=True, default="")
    settlement = models.CharField(max_length=255, blank=True, default="")
    language = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["-updated_at"]


class TranscriptionVerseIndex(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transcription = models.ForeignKey(
        Transcription,
        on_delete=models.CASCADE,
    )
    verse_identifier = models.CharField(max_length=128, db_index=True)
    book = models.CharField(max_length=64, blank=True, default="")
    chapter = models.CharField(max_length=32, blank=True, default="")
    verse = models.CharField(max_length=32, blank=True, default="")
    last_indexed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["transcription", "verse_identifier"],
                name="uniq_transcription_verse_presence",
            )
        ]


class TranscriptionCheckpoint(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transcription = models.ForeignKey(
        Transcription,
        on_delete=models.CASCADE,
    )
    format = models.CharField(max_length=32, default="normalized_ast_v1")
    payload = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
