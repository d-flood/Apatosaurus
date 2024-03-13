# Generated by Django 4.1.7 on 2024-02-20 18:54

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('collation', '0016_collationconfig'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='collationconfig',
            options={'ordering': ['-updated']},
        ),
        migrations.RemoveField(
            model_name='collationconfig',
            name='transcription_names',
        ),
        migrations.AddField(
            model_name='collationconfig',
            name='transcription_name',
            field=models.CharField(max_length=32, null=True),
        ),
        migrations.AddField(
            model_name='collationconfig',
            name='updated',
            field=models.DateTimeField(auto_now=True),
        ),
    ]