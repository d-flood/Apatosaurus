import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("project", "0001_initial"),
        ("transcription", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Collation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=255)),
                ("verse_identifier", models.CharField(db_index=True, max_length=128)),
                ("notes", models.TextField(blank=True, default="")),
                ("group_path", models.CharField(blank=True, db_index=True, default="", max_length=255)),
                ("sort_key", models.IntegerField(db_index=True, default=0)),
                ("status", models.CharField(blank=True, default="draft", max_length=32)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("project", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="collations", to="project.project")),
            ],
            options={"ordering": ["-updated_at"]},
        ),
        migrations.CreateModel(
            name="CollationArtifact",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("artifact_type", models.CharField(max_length=32)),
                ("payload", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("collation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="collation.collation")),
            ],
        ),
        migrations.CreateModel(
            name="CollationVariationUnit",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("start_index", models.IntegerField()),
                ("end_index", models.IntegerField()),
                ("unit_type", models.CharField(max_length=32)),
                ("base_text", models.TextField(blank=True, default="")),
                ("collation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="collation.collation")),
            ],
        ),
        migrations.CreateModel(
            name="CollationReading",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("reading_order", models.IntegerField(default=0)),
                ("reading_text", models.TextField(blank=True, default="")),
                ("is_omission", models.BooleanField(default=False)),
                ("is_lacuna", models.BooleanField(default=False)),
                ("variation_unit", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="collation.collationvariationunit")),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=("variation_unit", "reading_order"), name="uniq_reading_per_variation_order")]
            },
        ),
        migrations.CreateModel(
            name="CollationReadingWitness",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("witness_id", models.CharField(db_index=True, max_length=64)),
                ("reading", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="collation.collationreading")),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=("reading", "witness_id"), name="uniq_reading_witness_assignment")]
            },
        ),
        migrations.CreateModel(
            name="CollationToken",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("witness_id", models.CharField(db_index=True, max_length=64)),
                ("token_index", models.IntegerField()),
                ("token_text", models.CharField(max_length=255)),
                ("collation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="collation.collation")),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=("collation", "witness_id", "token_index"), name="uniq_collation_token_position")]
            },
        ),
        migrations.CreateModel(
            name="CollationWitness",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("witness_id", models.CharField(max_length=64)),
                ("source_version", models.CharField(blank=True, default="", max_length=64)),
                ("content", models.TextField(blank=True, default="")),
                ("position", models.IntegerField(default=0)),
                ("collation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="collation.collation")),
                ("transcription", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="transcription.transcription")),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=("collation", "witness_id"), name="uniq_collation_witness")]
            },
        ),
    ]
