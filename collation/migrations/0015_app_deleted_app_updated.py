# Generated by Django 4.1.7 on 2023-12-12 00:20

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('collation', '0014_ab_right_to_left'),
    ]

    operations = [
        migrations.AddField(
            model_name='app',
            name='deleted',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='app',
            name='updated',
            field=models.DateTimeField(auto_now=True),
        ),
    ]