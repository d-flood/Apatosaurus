# Generated by Django 4.1.5 on 2023-02-19 04:39

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('collation', '0002_alter_rdg_rtype'),
    ]

    operations = [
        migrations.AlterField(
            model_name='rdg',
            name='name',
            field=models.CharField(max_length=64),
        ),
        migrations.AlterField(
            model_name='rdg',
            name='rtype',
            field=models.CharField(choices=[('0', '-'), ('orth', 'Orthographic'), ('subr', 'Subreading'), ('def', 'Defective'), ('lac', 'Lacuna'), ('ns', 'Nomen Sacrum'), ('emm', 'Emendation'), ('ilc', 'Lectionary Adaptation'), ('insi', 'Insignificant'), ('err', 'Error'), ('om', 'Omission'), ('amb', 'Ambiguous')], default='0', max_length=64, verbose_name='Reading Type'),
        ),
    ]
