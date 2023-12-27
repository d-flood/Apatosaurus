from django.contrib.auth import get_user_model
from django.db import models

from collation.models import Ab, Witness


class Transcription(models.Model):
    """
    Transcription of one verse in one witness.
    """

    name = models.CharField(
        max_length=255, help_text="Normally a single verse reference."
    )
    user = models.ForeignKey(get_user_model(), on_delete=models.CASCADE)
    witness = models.ForeignKey(Witness, on_delete=models.CASCADE)
    tokens = models.JSONField(default=list)
    date_created = models.DateTimeField(auto_now_add=True)
    date_modified = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date_created"]

    def __str__(self) -> str:
        return f"{self.user} {self.witness} {self.name}"
