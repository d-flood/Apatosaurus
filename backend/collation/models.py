from django.db import models
from django.utils import timezone

from djazzkit.models import SyncModel
from djazzkit.sync_meta import ConflictMode, SyncScope, SyncStrategy


class Collation(SyncModel):
    title = models.CharField(max_length=255)
    verse_identifier = models.CharField(max_length=128, db_index=True)
    notes = models.TextField(blank=True, default="")
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.SET_NULL,
        to_field="_djazzkit_id",
        null=True,
        blank=True,
        related_name="collations",
    )
    group_path = models.CharField(max_length=255, db_index=True, blank=True, default="")
    sort_key = models.IntegerField(default=0, db_index=True)
    status = models.CharField(max_length=32, blank=True, default="draft")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class CollationWitness(SyncModel):
    collation = models.ForeignKey(
        Collation,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
    )
    witness_id = models.CharField(max_length=64)
    transcription = models.ForeignKey(
        "transcription.Transcription",
        on_delete=models.SET_NULL,
        to_field="_djazzkit_id",
        null=True,
        blank=True,
    )
    source_version = models.CharField(max_length=64, blank=True, default="")
    content = models.TextField(blank=True, default="")
    position = models.IntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["collation", "witness_id"],
                name="uniq_collation_witness",
            )
        ]

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class CollationToken(SyncModel):
    collation = models.ForeignKey(
        Collation,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
    )
    witness_id = models.CharField(max_length=64, db_index=True)
    token_index = models.IntegerField()
    token_text = models.CharField(max_length=255)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["collation", "witness_id", "token_index"],
                name="uniq_collation_token_position",
            )
        ]

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class CollationVariationUnit(SyncModel):
    collation = models.ForeignKey(
        Collation,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
    )
    start_index = models.IntegerField()
    end_index = models.IntegerField()
    unit_type = models.CharField(max_length=32)
    base_text = models.TextField(blank=True, default="")

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class CollationReading(SyncModel):
    variation_unit = models.ForeignKey(
        CollationVariationUnit,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
    )
    reading_order = models.IntegerField(default=0)
    reading_text = models.TextField(blank=True, default="")
    is_omission = models.BooleanField(default=False)
    is_lacuna = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["variation_unit", "reading_order"],
                name="uniq_reading_per_variation_order",
            )
        ]

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class CollationReadingWitness(SyncModel):
    reading = models.ForeignKey(
        CollationReading,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
    )
    witness_id = models.CharField(max_length=64, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["reading", "witness_id"],
                name="uniq_reading_witness_assignment",
            )
        ]

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class CollationArtifact(SyncModel):
    collation = models.ForeignKey(
        Collation,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
    )
    artifact_type = models.CharField(max_length=32)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True
