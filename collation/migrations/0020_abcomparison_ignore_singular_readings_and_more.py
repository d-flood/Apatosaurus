# Generated by Django 4.1.7 on 2024-05-11 16:07

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('collation', '0019_sectioncomparison_collationcomparison_abcomparison'),
    ]

    operations = [
        migrations.AddField(
            model_name='abcomparison',
            name='ignore_singular_readings',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='collationcomparison',
            name='ignore_singular_readings',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='sectioncomparison',
            name='ignore_singular_readings',
            field=models.BooleanField(default=False),
        ),
    ]
