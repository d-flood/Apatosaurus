from multiprocessing.managers import BaseManager
from pyexpat import model
from django.db.models import Count, QuerySet
from django.http import HttpRequest

from collation import models


def apply_all_of(all_of: list[str], rdgs: QuerySet, only_these):
    witnesses = [models.Witness.objects.get(siglum=wit) for wit in all_of]
    number_of_witnesses = len(witnesses)
    for w in witnesses:
        rdgs = rdgs.filter(wit=w)
    if only_these:
        objects_to_exclude = models.Rdg.objects.annotate(num_related_objects=Count('wit')).filter(num_related_objects__gt=number_of_witnesses)
        rdgs = rdgs.exclude(pk__in=objects_to_exclude.values_list('pk', flat=True))
    
    return rdgs


def apply_any_of(any_of: list[str], rdgs: QuerySet):
    witnesses = [models.Witness.objects.get(siglum=wit) for wit in any_of]
    rdgs = rdgs.filter(wit__in=witnesses)
    return rdgs


def apply_none_of(none_of: list[str], rdgs: QuerySet):
    witnesses = [models.Witness.objects.get(siglum=wit) for wit in none_of]
    excluded_rdgs = rdgs.exclude(wit__in=witnesses)
    return excluded_rdgs


def filter_variants_by_witnesses(request: HttpRequest, collation_slug: str):
    data = request.GET
    all_of = data.getlist('all-of')
    any_of = data.getlist('any-of')
    none_of = data.getlist('none-of')
    only_these = data.get('only-these')

    collation = models.Collation.objects.filter(user=request.user).get(slug=collation_slug)
    rdgs = models.Rdg.objects.filter(app__ab__section__collation=collation)

    if all_of:
        rdgs = apply_all_of(all_of, rdgs, only_these)
        if only_these:
            variants = models.App.objects.filter(rdgs__in=rdgs).distinct()
            return variants, variants.count()
    if any_of:
        rdgs = apply_any_of(any_of, rdgs)
    if none_of:
        rdgs = apply_none_of(none_of, rdgs)

    variants = models.App.objects.filter(rdgs__in=rdgs).distinct()

    return variants, variants.count()
    # TODO: Also have option to exclude Rdgs by type



