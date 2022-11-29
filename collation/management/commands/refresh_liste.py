from django.core.management.base import BaseCommand, CommandError

from collation.models import Witness

import json

class Command(BaseCommand):
    help = 'Refreshes the List of Witnesses from the INTF Liste'

    def add_arguments(self, parser):
        parser.add_argument('file', nargs=1, type=str)

    def handle(self, *args, **options):
        json_file = options['file'][0]
        
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        liste = data['data']['manuscripts']['manuscript']
        for m in liste:
            if m['docID'] > 49999:
                break
            elif m['docID'] < 20000:
                if m['gaNum'] in ['', None]:
                    continue
                siglum = m['gaNum']
            elif m['docID'] < 30000:
                siglum = f"0{m['gaNum']}"
            elif m['docID'] < 40000:
                siglum = f"{m['gaNum']}"
            else:
                siglum = f"{m['gaNum']}"
            
            try:
                Witness.objects.get(siglum=siglum)
            except Witness.DoesNotExist:
                Witness.objects.create(siglum=siglum, description=m.get('orig'))
           
        self.stdout.write(self.style.SUCCESS('Successfully refreshed liste'))