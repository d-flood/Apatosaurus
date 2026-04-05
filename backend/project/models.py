from django.conf import settings
from django.db import models
from django.utils import timezone

from djazzkit.models import SyncModel
from djazzkit.sync_meta import ConflictMode, SyncScope, SyncStrategy


class Project(SyncModel):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    charter = models.TextField(blank=True, default="")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_projects",
        to_field="id",
    )
    collation_settings = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class ProjectMembership(SyncModel):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
        related_name="memberships",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_memberships",
    )
    role = models.CharField(max_length=32, default="member")
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "user"], name="uniq_project_membership"
            )
        ]

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class ProjectObjectPermission(SyncModel):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
        related_name="object_permissions",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_object_permissions",
    )
    object_uid = models.UUIDField(db_index=True)
    object_type = models.CharField(max_length=32)
    permission = models.CharField(max_length=32, default="write")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "user", "object_uid"],
                name="uniq_project_object_perm",
            )
        ]

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True


class ProjectTranscription(SyncModel):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
        related_name="transcription_links",
    )
    transcription = models.ForeignKey(
        "transcription.Transcription",
        on_delete=models.CASCADE,
        to_field="_djazzkit_id",
        related_name="project_links",
    )
    added_at = models.DateTimeField(default=timezone.now)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "transcription"],
                name="uniq_project_transcription",
            )
        ]

    class SyncMeta:
        scope = SyncScope.SHARED
        strategy = SyncStrategy.EAGER
        conflict_mode = ConflictMode.LWW
        sync_filter = staticmethod(lambda _user: models.Q())
        allow_sensitive_fields = True
