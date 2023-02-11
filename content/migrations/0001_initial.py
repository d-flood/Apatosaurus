# Generated by Django 4.1.5 on 2023-02-01 19:36

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='AboutPage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=30)),
                ('slug', models.SlugField(unique=True)),
                ('markdown', models.TextField()),
                ('order', models.SmallIntegerField(default=0)),
                ('html', models.TextField(blank=True)),
            ],
            options={
                'ordering': ('order',),
            },
        ),
        migrations.CreateModel(
            name='ImageBlock',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('image', models.ImageField(upload_to='content/about/images/')),
                ('markdown', models.TextField()),
                ('html', models.TextField(blank=True)),
                ('order', models.SmallIntegerField(default=0)),
                ('about_page', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='blocks', to='content.aboutpage')),
            ],
            options={
                'ordering': ('order',),
            },
        ),
    ]