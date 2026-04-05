from django.db import models
from django.utils import timezone

from djazzkit.models import SyncModel
from djazzkit.sync_meta import ConflictMode, SyncScope, SyncStrategy


class Transcription(SyncModel):
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

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class TranscriptionVerseIndex(SyncModel):
    transcription = models.ForeignKey(
        Transcription,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
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

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class TranscriptionCheckpoint(SyncModel):
    transcription = models.ForeignKey(
        Transcription,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
    )
    format = models.CharField(max_length=32, default="normalized_ast_v1")
    payload = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True
