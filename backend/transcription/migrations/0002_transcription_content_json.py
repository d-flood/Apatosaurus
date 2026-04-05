from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("transcription", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="transcription",
            name="content_json",
            field=models.JSONField(default=dict),
        ),
    ]
