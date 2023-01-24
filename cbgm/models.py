from django.db import models
from django.contrib.auth import get_user_model

from natsort import natsorted

from witnesses.py.sort_ga_witnesses import sort_ga_witnesses



def user_directory_path(instance, filename):
    return f'cbgm/databases/{instance.user.username}/{filename}'

class Cbgm_Db(models.Model):
    AMOUNT_CHOICES = (
        (0, 'Verse'),
        (1, 'Section'),
        (2, 'Full'),
    )
    active = models.BooleanField(default=False)
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE)
    db_name = models.CharField(max_length=64)
    db_file = models.FileField(upload_to=user_directory_path)
    amount = models.SmallIntegerField(choices=AMOUNT_CHOICES, default=0)
    # open-cbgm options
    threshold = models.SmallIntegerField(default=1, help_text='Minimum number of readings for a witness to be included.')
    trivial_types = models.CharField(max_length=255, null=True, blank=True, help_text='List of reading types to treat as agreeing with their parent. E.g., "subr err"')
    ignore_types = models.CharField(max_length=255, null=True, blank=True, help_text='List of reading types to ignore. E.g., "lac defi"')
    ignore_suffixes = models.CharField(max_length=255, null=True, blank=True, help_text='List of witness suffixes to strip away. E.g., "* T V"')
    merge_splits = models.BooleanField(default=False)
    use_classic_rules = models.BooleanField(default=False)
    witnesses = models.JSONField(null=True, default=list)
    app_labels = models.JSONField(null=True, default=list)

    def sorted_app_labels(self):
        return natsorted(self.app_labels) if self.app_labels else ['']

    def __str__(self):
        return f'{self.user}: {self.db_name}'

    def delete(self, *args, **kwargs):
        self.db_file.delete()
        super().delete(*args, **kwargs)

    class Meta:
        unique_together = ('user', 'db_name')
