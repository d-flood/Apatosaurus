# Generated by Django 4.1.7 on 2023-11-10 16:37

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('collation', '0006_alter_collation_unique_together_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='rdg',
            name='rtype',
            field=models.CharField(default='-', max_length=64, verbose_name='Reading Type'),
        ),
        migrations.AlterField(
            model_name='rdghistory',
            name='rtype',
            field=models.CharField(default='-', max_length=5, verbose_name='Reading Type'),
        ),
    ]