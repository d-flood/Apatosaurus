# Generated by Django 4.1.7 on 2023-11-16 04:55

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0003_aboutpage_page_type'),
    ]

    operations = [
        migrations.AlterField(
            model_name='imageblock',
            name='image',
            field=models.ImageField(blank=True, null=True, upload_to='content/about/images/'),
        ),
    ]