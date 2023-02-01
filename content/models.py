from django.db import models

from markdown import markdown


class AboutPage(models.Model):
    title = models.CharField(max_length=30)
    slug = models.SlugField(unique=True)
    markdown = models.TextField(blank=False)
    order = models.SmallIntegerField(default=0)
    html = models.TextField(blank=True)

    def __str__(self):
        return self.title

    def get_absolute_url(self):
        return f'/{self.slug}/'

    def save(self, *args, **kwargs):
        self.html = markdown(self.markdown)
        super().save(*args, **kwargs)

    class Meta:
        ordering = ('order',)

class ImageBlock(models.Model):
    image = models.ImageField(upload_to='content/about/images/', blank=False)
    markdown = models.TextField(blank=False)
    html = models.TextField(blank=True)
    order = models.SmallIntegerField(default=0)
    about_page = models.ForeignKey(AboutPage, on_delete=models.CASCADE, related_name='blocks')

    def __str__(self):
        return f'{self.about_page.title} > {self.markdown[:20]}'

    def save(self, *args, **kwargs):
        self.html = markdown(self.markdown)
        super().save(*args, **kwargs)

    class Meta:
        ordering = ('order',)
