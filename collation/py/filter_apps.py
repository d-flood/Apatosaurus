from django.db.models import Count, QuerySet, Subquery, OuterRef
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


def filter_apps_by_rtype(ignore_rtypes: list[str], variants: QuerySet[models.App]):
    """Filters out App objects if they contain only a single reading that is not in the ignore list.
    It does the equivalent of this (probably) less efficient query:
    ```
    for app in variants:
        rdgs = app.rdgs.exclude(rtype__in=ignore_rtypes)
        if rdgs.count() < 2:
            variants = variants.exclude(pk=app.pk)
    return variants
    ```
    """
    
    rdgs_count = models.Rdg.objects.filter(app=OuterRef('pk')).exclude(rtype__in=ignore_rtypes).values('app').annotate(cnt=Count('pk')).values('cnt')
    variants = variants.annotate(relevant_rdg_count=Subquery(rdgs_count))
    variants = variants.filter(relevant_rdg_count__gte=2)

    return variants


def filter_variants_by_witnesses(request: HttpRequest, collation_slug: str):
    data = request.GET
    all_of = data.getlist('all-of')
    any_of = data.getlist('any-of')
    none_of = data.getlist('none-of')
    only_these = data.get('only-these')
    ignore_rtypes = data.getlist('ignore-rtypes')

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

    variants = models.App.objects.filter(rdgs__in=rdgs)
    if ignore_rtypes and ignore_rtypes != ['']:
        variants = filter_apps_by_rtype(ignore_rtypes, variants)

    variants = variants.order_by('ab__number', 'index_from')

    return variants, variants.count()
