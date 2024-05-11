import json
from argparse import ArgumentParser
from typing import Any

from django.core.management.base import BaseCommand
from django.db.models import Count

# from accounts.models import JobStatus
from collation import models


class Command(BaseCommand):
    help = "Calculates the pregenealogical coherence of a given Collation, Section, or Ab object."

    def add_arguments(self, parser: ArgumentParser):
        parser.add_argument("object_model", nargs=1, type=str)
        parser.add_argument("object_pk", nargs=1, type=int)
        parser.add_argument("collapse_these_rdg_types", nargs=1, type=str)
        parser.add_argument("ignore_these_rdg_types", nargs=1, type=str)
        parser.add_argument("witness_threshold", nargs=1, type=int)
        parser.add_argument("witnesses", nargs=1, type=str)

    def handle(self, *args: Any, **options: Any):
        """
        Rdg objects connected by an Arc object and whose rdg_to object has an rtype in collapse_these_rdg_typeswill be collapsed into a single node.
        Rdg objects whose rtype is in ignore_these_rdg_types will be treated as if the witness does not exist at that place.
        App objects who have only one Rdg object with an rtype not in do_not_count_these_rdg_types will be skipped.
        """
        object_model = options["object_model"][0]
        object_pk = options["object_pk"][0]
        collapse_these_rdg_types = options["collapse_these_rdg_types"][0].split(",")
        ignore_these_rdg_types = options["ignore_these_rdg_types"][0].split(",")
        witness_threshold = options["witness_threshold"][0]
        witnesses = options["witnesses"][0].split(",")

        # job_pk = JobStatus.objects.create(
        #     name="Pre-Gen Matrix",
        #     progress=0,
        #     in_progress=True,
        #     message="starting..."
        # )

        if object_model == "collation":
            object = models.Collation.objects.get(pk=object_pk)
        elif object_model == "section":
            object = models.Section.objects.get(pk=object_pk)
        elif object_model == "ab":
            object = models.Ab.objects.get(pk=object_pk)
        else:
            # JobStatus.objects.filter(pk=job_pk).update(
            #     progress=0,
            #     name="Pre-Gen Matrix",
            #     message="Error: invalid object_model input",
            #     failed=True,
            #     in_progress=False,
            # )
            raise ValueError("Invalid object model.")

        # JobStatus.objects.filter(pk=job_pk).update(
        #     progress=0,
        #     name=f"{object.name} Pre-Gen Matrix",
        #     message="Starting matrix Calculation...",
        #     in_progress=True,
        # )

        cleaned_apps: list[list[set[str]]] = []
        for app in object.get_all_apps():
            # only include apps that have more than one Rdg object whose rtype is not in ignore_these_rdg_types
            valid_agreements: list[set[str]] = []
            # get all Rdg objects that are not connected to any Arc objects
            for rdg in app.rdgs.filter(arcs_from__isnull=True, arcs_to__isnull=True):
                if rdg.rtype not in ignore_these_rdg_types:
                    valid_agreements.append(
                        set(rdg.wit.all().values_list("siglum", flat=True)),  # type: ignore
                    )
            # now collapse rdgs in the app
            # first, iterate over arcs whose rdg_to.rtype is in collapse_these_rdg_types
            arc: models.Arc
            for arc in app.arcs.filter(rdg_to__rtype__in=collapse_these_rdg_types):  # type: ignore
                # combine the witness sigla from both rdg_from and rdg_to
                combined_witnesses = set(
                    arc.rdg_from.wit.all().values_list("siglum", flat=True)  # type: ignore
                ) | set(
                    arc.rdg_to.wit.all().values_list("siglum", flat=True)  # type: ignore
                )  # type: ignore
                valid_agreements.append(combined_witnesses)
            # second, iterate over arcs that apparently contain two valid agreements—treat them separately
            for arc in app.arcs.exclude(rdg_to__rtype__in=collapse_these_rdg_types):  # type: ignore
                valid_agreements.append(
                    set(arc.rdg_from.wit.all().values_list("siglum", flat=True)),  # type: ignore
                )
                valid_agreements.append(
                    set(arc.rdg_to.wit.all().values_list("siglum", flat=True)),  # type: ignore
                )
            # check if the app is valid
            if len(valid_agreements) > 1:
                cleaned_apps.append(valid_agreements)

        agreement_percentages: dict[str, dict[str, dict[str, int | float]]] = {}
        all_witnesses = (
            object.get_all_witnesses()
            .annotate(rdg_count=Count("rdgs"))
            .filter(rdg_count__gte=witness_threshold)
            .distinct()
            .values_list("siglum", flat=True)
        )
        # witnesses_count = all_witnesses.count()
        for first in all_witnesses:
            for second in all_witnesses:
                if first not in agreement_percentages:
                    agreement_percentages[first] = {}
                if second not in agreement_percentages[first]:
                    agreement_percentages[first][second] = {
                        "agreements": 0,
                        "total_apps": 0,
                    }
                if first == second:
                    continue
                first_in_app = False
                second_in_app = False
                for app in cleaned_apps:
                    for rdg in app:
                        if first in rdg and second in rdg:
                            agreement_percentages[first][second]["agreements"] += 1
                            agreement_percentages[first][second]["total_apps"] += 1
                            break
                        if first in rdg:
                            first_in_app = True
                        if second in rdg:
                            second_in_app = True
                    if first_in_app and second_in_app:
                        agreement_percentages[first][second]["total_apps"] += 1
                        first_in_app = False
                        second_in_app = False
        # # print the results
        # for first in agreement_percentages:
        #     for second in agreement_percentages[first]:
        #         agreements = agreement_percentages[first][second]["agreements"]
        #         agreements = agreements if agreements > 0 else 1
        #         total = agreement_percentages[first][second]["total_apps"]
        #         total = total if total > 0 else 1
        #         print(
        #             f"{first} / {second}: {(agreements / total) * 100}% (agreements {agreement_percentages[first][second]['agreements']} / {agreement_percentages[first][second]['total_apps']})"
        #         )
        print(f"total apps {len(cleaned_apps)}")
        with open("coherence.json", "w", encoding="utf-8") as f:
            json.dump(agreement_percentages, f, indent=4)

        self.stdout.write(
            self.style.SUCCESS("Generated pregenealogical coherence report.")
        )
