# Generated by Django 4.1.7 on 2023-11-15 22:48

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0002_aboutpage_published'),
    ]

    operations = [
        migrations.AddField(
            model_name='aboutpage',
            name='page_type',
            field=models.CharField(choices=[('normal', 'Normal'), ('presentation', 'Presentation')], default='normal', max_length=20),
        ),
    ]
