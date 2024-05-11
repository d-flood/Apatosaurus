# Generated by Django 4.2.11 on 2024-05-10 21:35

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0007_customuser_has_unread_announcements'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('collation', '0018_appindex_rdgindex'),
    ]

    operations = [
        migrations.CreateModel(
            name='SectionComparison',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=64)),
                ('collapse_rdg_types', models.JSONField(blank=True, default=list, null=True)),
                ('ignore_rdg_types', models.JSONField(blank=True, default=list, null=True)),
                ('witness_threshold', models.SmallIntegerField(default=0)),
                ('witnesses', models.JSONField(blank=True, default=list, null=True)),
                ('created', models.DateTimeField(auto_now_add=True)),
                ('updated', models.DateTimeField(auto_now=True)),
                ('corpus_instance', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comparisons', to='collation.section')),
                ('matrix_file', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='accounts.userfile')),
                ('user', models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'abstract': False,
            },
        ),
        migrations.CreateModel(
            name='CollationComparison',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=64)),
                ('collapse_rdg_types', models.JSONField(blank=True, default=list, null=True)),
                ('ignore_rdg_types', models.JSONField(blank=True, default=list, null=True)),
                ('witness_threshold', models.SmallIntegerField(default=0)),
                ('witnesses', models.JSONField(blank=True, default=list, null=True)),
                ('created', models.DateTimeField(auto_now_add=True)),
                ('updated', models.DateTimeField(auto_now=True)),
                ('corpus_instance', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comparisons', to='collation.collation')),
                ('matrix_file', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='accounts.userfile')),
                ('user', models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'abstract': False,
            },
        ),
        migrations.CreateModel(
            name='AbComparison',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=64)),
                ('collapse_rdg_types', models.JSONField(blank=True, default=list, null=True)),
                ('ignore_rdg_types', models.JSONField(blank=True, default=list, null=True)),
                ('witness_threshold', models.SmallIntegerField(default=0)),
                ('witnesses', models.JSONField(blank=True, default=list, null=True)),
                ('created', models.DateTimeField(auto_now_add=True)),
                ('updated', models.DateTimeField(auto_now=True)),
                ('corpus_instance', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comparisons', to='collation.ab')),
                ('matrix_file', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='accounts.userfile')),
                ('user', models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'abstract': False,
            },
        ),
    ]