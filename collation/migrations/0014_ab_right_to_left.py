# Generated by Django 4.1.7 on 2023-11-20 17:12

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('collation', '0013_app_slugname'),
    ]

    operations = [
        migrations.AddField(
            model_name='ab',
            name='right_to_left',
            field=models.BooleanField(default=False),
        ),
    ]
