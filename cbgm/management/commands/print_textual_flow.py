import json

from django.core.management.base import BaseCommand, CommandError

from cbgm.tasks import textual_flow_task



class Command(BaseCommand):
    help = 'Calls the open-cbgm interface to generate a textual flow diagram'

    def add_arguments(self, parser):
        parser.add_argument('job_pk', nargs=1, type=int)
        parser.add_argument('db_pk', nargs=1, type=int)
        parser.add_argument('data', nargs=1, type=str)

    def handle(self, *args, **options):
        job_pk = options['job_pk'][0]
        db_pk = options['db_pk'][0]
        data = json.loads(options['data'][0])
        
        textual_flow_task(job_pk, db_pk, data)
           
        self.stdout.write(self.style.SUCCESS(f'Successfully generated Textual Flow Diagram'))