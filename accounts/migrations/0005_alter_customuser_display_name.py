# Generated by Django 4.1.7 on 2023-11-10 17:43

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0004_alter_customuser_options_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='customuser',
            name='display_name',
            field=models.CharField(default='', help_text='The public name you would like to be displayed with your apparatus if you choose to publish it.', max_length=50),
        ),
    ]
