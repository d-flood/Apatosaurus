from django.core.management.base import BaseCommand, CommandError

from cbgm.tasks import import_tei_task


class Command(BaseCommand):
    help = "Creates and populates a new CBGM database"

    def add_arguments(self, parser):
        parser.add_argument("user_pk", nargs=1, type=int)
        parser.add_argument("section_pk", nargs=1, type=int)
        parser.add_argument("db_pk", nargs=1, type=int)
        parser.add_argument("corpus_type", nargs=1, type=int)
        parser.add_argument("ignore_rdg_types", nargs="*", type=str)

    def handle(self, *args, **options):
        user_pk = options["user_pk"][0]
        section_pk = options["section_pk"][0]
        db_pk = options["db_pk"][0]
        corpus_type = options["corpus_type"][0]
        ignore_rdg_types = options["ignore_rdg_types"]

        import_tei_task(user_pk, section_pk, db_pk, corpus_type, ignore_rdg_types)

        self.stdout.write(
            self.style.SUCCESS(
                f"Successfully populated CBGM database for user {user_pk}"
            )
        )
