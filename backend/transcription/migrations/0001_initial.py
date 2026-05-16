import uuid

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Transcription",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=255)),
                ("siglum", models.CharField(max_length=64)),
                ("description", models.TextField(blank=True, default="")),
                ("content_json", models.JSONField(default=dict)),
                ("format", models.CharField(default="normalized_ast_v1", max_length=32)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("owner", models.CharField(blank=True, max_length=255, null=True)),
                ("is_public", models.BooleanField(default=False)),
                ("tags", models.JSONField(default=list)),
                ("transcriber", models.CharField(blank=True, default="", max_length=255)),
                ("repository", models.CharField(blank=True, default="", max_length=255)),
                ("settlement", models.CharField(blank=True, default="", max_length=255)),
                ("language", models.CharField(blank=True, default="", max_length=64)),
            ],
            options={"ordering": ["-updated_at"]},
        ),
        migrations.CreateModel(
            name="TranscriptionCheckpoint",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("format", models.CharField(default="normalized_ast_v1", max_length=32)),
                ("payload", models.TextField()),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("transcription", models.ForeignKey(on_delete=models.CASCADE, to="transcription.transcription")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="TranscriptionVerseIndex",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("verse_identifier", models.CharField(db_index=True, max_length=128)),
                ("book", models.CharField(blank=True, default="", max_length=64)),
                ("chapter", models.CharField(blank=True, default="", max_length=32)),
                ("verse", models.CharField(blank=True, default="", max_length=32)),
                ("last_indexed_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("transcription", models.ForeignKey(on_delete=models.CASCADE, to="transcription.transcription")),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("transcription", "verse_identifier"), name="uniq_transcription_verse_presence")
                ]
            },
        ),
    ]
