from lxml import etree as et


def version_rdgs(elem: et._Element, regularized: dict):
    if elem.get('n') in regularized:
        regularized[elem.get('n')] += 1
    else:
        regularized[elem.get('n')] = 1
    unique_name = f'{elem.get("n")}{regularized[elem.get("n")]}'
    elem.attrib['n'] = unique_name
    return regularized, unique_name

def differentiate_subreading_ids(xml: et._Element):
    ns = '{http://www.tei-c.org/ns/1.0}'
    for ab in xml:
        for app in ab:
            regularized = {}
            for elem in app:
                if elem.tag == f'{ns}rdg' and 'r' in elem.get('n', ''):
                    regularized, _ = version_rdgs(elem, regularized)
                elif elem.tag == f'{ns}note': # this is a <note> element
                    for child in elem: # this is a <note> child
                        if child.tag == f'{ns}graph':
                            regularized = {}
                            for node in child:
                                if node.tag == f'{ns}node':
                                    if 'r' in node.get('n', ''):
                                        regularized, distinct_attrib = version_rdgs(node, regularized)
                                        arc = et.Element('arc')
                                        arc.attrib['from'] = distinct_attrib[0]
                                        arc.attrib['to'] = distinct_attrib
                                        if (parent := node.getparent()):
                                            parent.append(arc)
    return xml
