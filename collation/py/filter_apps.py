from django.db.models import Count, OuterRef, QuerySet, Subquery
from django.http import HttpRequest
from natsort import natsorted

from collation import models
from collation.models import filter_apps_by_rtype


def apply_all_of(all_of: list[str], rdgs: QuerySet[models.RdgIndex], only_these, user):
    witnesses = [models.Witness.get_by_siglum(wit, user) for wit in all_of]
    number_of_witnesses = len(witnesses)
    for w in witnesses:
        rdgs = rdgs.filter(witnesses=w)
    if only_these:
        objects_to_exclude = models.RdgIndex.objects.annotate(
            num_related_objects=Count("witnesses")
        ).filter(num_related_objects__gt=number_of_witnesses)
        rdgs = rdgs.exclude(pk__in=objects_to_exclude.values_list("pk", flat=True))

    return rdgs


def apply_any_of(any_of: list[str], rdgs: QuerySet, user):
    witnesses = [models.Witness.get_by_siglum(wit, user) for wit in any_of]
    rdgs = rdgs.filter(witnesses__in=witnesses)
    return rdgs


def apply_none_of(none_of: list[str], rdgs: QuerySet, user):
    witnesses = [models.Witness.get_by_siglum(wit, user) for wit in none_of]
    excluded_rdgs = rdgs.exclude(witnesses__in=witnesses)
    return excluded_rdgs


def filter_variants_by_witnesses(request: HttpRequest, collation_pk: int):
    data = request.GET
    all_of = data.getlist("all-of")
    any_of = data.getlist("any-of")
    none_of = data.getlist("none-of")
    only_these = data.get("only-these")
    ignore_rtypes = data.getlist("ignore-rtypes")

    collation = models.Collation.objects.filter(user=request.user).get(pk=collation_pk)
    rdgs = models.RdgIndex.objects.filter(app_index__collation=collation)

    if all_of:
        rdgs = apply_all_of(all_of, rdgs, only_these, request.user)
        if only_these:
            variants = models.AppIndex.objects.filter(rdg_indexes__in=rdgs).distinct()
            return variants, variants.count()
    if any_of:
        rdgs = apply_any_of(any_of, rdgs, request.user)
    if none_of:
        rdgs = apply_none_of(none_of, rdgs, request.user)

    variants = models.AppIndex.objects.filter(rdg_indexes__in=rdgs)
    if ignore_rtypes and ignore_rtypes != [""]:
        variants = filter_apps_by_rtype(ignore_rtypes, variants)

    variants = variants.order_by("name")

    return variants, variants.count()
