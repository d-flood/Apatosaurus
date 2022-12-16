import re

import natsort


def sort_ga_witnesses(witnesses: list[str]):
    papyri = []
    majuscules = []
    minuscules = []
    lectionaries = []
    editions = []
    for wit in witnesses:
        if wit.lower().startswith('p'):
            papyri.append(wit)
        elif wit.startswith('0'):
            majuscules.append(wit)
        elif wit.lower().startswith("l"):
            lectionaries.append(wit)
        elif re.match(r'^[1-9]', wit):
            minuscules.append(wit)
        else:
            editions.append(wit)
    papyri = natsort.natsorted(papyri)
    majuscules = natsort.natsorted(majuscules)
    minuscules = natsort.natsorted(minuscules)
    lectionaries = natsort.natsorted(lectionaries)
    editions = natsort.natsorted(editions)
    return papyri + majuscules + minuscules + lectionaries + editions
    