from django.core.management.base import BaseCommand

from collation.models import Rdg




class Command(BaseCommand):
    help = 'A one time command to change any rtypes whose value is 0 to "-"'

    def handle(self, *args, **options):

        for rdg in (rdgs := Rdg.objects.filter(rtype=0)):
            rdg.rtype = '-'
            rdg.save()

        self.stdout.write(self.style.SUCCESS(f'Set value for {rdgs.count()} rtypes to "-".'))