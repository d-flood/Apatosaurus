from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO_ROOT / "packages" / "tei-transcription" / "igntp-audit-corpus.json"
DEFAULT_OUTPUT = REPO_ROOT / "packages" / "tei-transcription" / "igntp-corpus-audit.json"
DEFAULT_MATRIX = REPO_ROOT / "packages" / "tei-transcription" / "igntp-support-matrix.json"

BODY_WRAPPER_TAGS = {
	"foreign",
	"term",
	"name",
	"num",
	"date",
	"unit",
	"am",
	"expan",
	"gloss",
	"placeName",
	"objectName",
	"title",
	"bibl",
	"mod",
	"retrace",
	"seg",
}
FLAT_WRAPPER_TAGS = BODY_WRAPPER_TAGS - {"seg"}
TEXT_MARK_TAGS = {"supplied", "unclear", "hi", "damage", "surplus", "secl"}
EDITORIAL_ACTION_TAGS = {"undo", "redo", "substJoin", "transpose", "listTranspose"}
OUT_OF_SCOPE_TAGS = {"lem", "rdgGrp", "listApp", "noteGrp"}
NON_BODY_SECTION_TAGS = {"front", "back", "facsimile", "standOff", "sourceDoc"}
IGNORED_BODY_TAGS = {
	"TEI",
	"text",
	"body",
	"teiHeader",
	"fileDesc",
	"titleStmt",
	"publicationStmt",
	"sourceDesc",
	"editionStmt",
	"profileDesc",
	"langUsage",
	"handNotes",
	"msDesc",
	"msIdentifier",
	"respStmt",
	"revisionDesc",
	"encodingDesc",
	"projectDesc",
	"editorialDecl",
	"availability",
	"publisher",
	"funder",
	"sponsor",
	"country",
	"settlement",
	"repository",
	"idno",
	"resp",
	"title",
	"date",
	"name",
	"language",
	"change",
	"handNote",
	"witness",
	"variantEncoding",
	"p",
	"edition",
	"div",
	"ab",
	"pb",
	"cb",
	"lb",
	"w",
	"pc",
	"app",
	"rdg",
}


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Scan the checked-in IGNTP audit corpus and emit a repeatable JSON report."
	)
	parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST), help="Path to the checked-in audit corpus manifest.")
	parser.add_argument("--matrix", default=str(DEFAULT_MATRIX), help="Path to the checked-in support matrix.")
	parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Path to write the generated report.")
	parser.add_argument("--check", help="Compare generated JSON to an existing report file.")
	return parser.parse_args()


def main() -> int:
	args = parse_args()
	manifest_path = Path(args.manifest).resolve()
	matrix_path = Path(args.matrix).resolve()
	manifest = json.loads(manifest_path.read_text())
	matrix = json.loads(matrix_path.read_text())
	report = build_report(manifest, matrix)
	rendered = json.dumps(report, indent=2, ensure_ascii=True) + "\n"

	if args.output:
		Path(args.output).resolve().write_text(rendered)

	if args.check:
		check_path = Path(args.check).resolve()
		if check_path.read_text() != rendered:
			print(f"Corpus audit report is out of date: {check_path}")
			return 1

	if not args.output and not args.check:
		print(rendered, end="")

	return 0


def build_report(manifest: dict[str, Any], matrix: dict[str, Any]) -> dict[str, Any]:
	matrix_entries = {entry["construct"]: entry for entry in matrix.get("constructs", [])}
	entries = manifest["entries"]
	file_reports = []
	global_tags: Counter[str] = Counter()
	global_attribute_patterns: Counter[str] = Counter()
	global_nested_patterns: Counter[str] = Counter()
	global_correction_patterns: Counter[str] = Counter()
	global_formwork_shapes: Counter[str] = Counter()
	global_carrier_examples: Counter[str] = Counter()
	construct_occurrences: dict[str, dict[str, Any]] = {}
	uncategorized_body_tags: Counter[str] = Counter()

	for entry in entries:
		path = REPO_ROOT / entry["path"]
		scan = summarize_file(path)
		file_reports.append(
			{
				**entry,
				"scan": {
					"tags": dict(scan["tags"].most_common()),
					"attribute_patterns": dict(scan["attribute_patterns"].most_common(25)),
					"nested_wrapper_patterns": dict(scan["nested_wrapper_patterns"].most_common()),
					"correction_patterns": dict(scan["correction_patterns"].most_common()),
					"formwork_shapes": dict(scan["formwork_shapes"].most_common()),
					"carrier_examples": dict(scan["carrier_examples"].most_common()),
					"encountered_constructs": sorted(scan["construct_matches"]),
					"uncategorized_body_tags": sorted(scan["uncategorized_body_tags"]),
				},
			}
		)
		global_tags.update(scan["tags"])
		global_attribute_patterns.update(scan["attribute_patterns"])
		global_nested_patterns.update(scan["nested_wrapper_patterns"])
		global_correction_patterns.update(scan["correction_patterns"])
		global_formwork_shapes.update(scan["formwork_shapes"])
		global_carrier_examples.update(scan["carrier_examples"])
		uncategorized_body_tags.update(scan["uncategorized_body_tags"])

		for construct, match_info in scan["construct_occurrences"].items():
			record = construct_occurrences.setdefault(
				construct,
				{"count": 0, "files": set(), "examples": set()},
			)
			record["count"] += match_info["count"]
			record["files"].add(entry["id"])
			record["examples"].update(match_info["examples"])

	matrix_dispositions = []
	for construct, occurrence in sorted(construct_occurrences.items()):
		matrix_entry = matrix_entries.get(construct)
		if not matrix_entry:
			raise ValueError(f"Construct {construct} is not present in the support matrix")
		status = matrix_entry["status"]
		matrix_dispositions.append(
			{
				"construct": construct,
				"status": status,
				"disposition": disposition_for_status(status),
				"mechanism": matrix_entry["mechanism"],
				"editor_surface": matrix_entry["editor_surface"],
				"observed_in": sorted(occurrence["files"]),
				"occurrence_count": occurrence["count"],
				"observed_tags": sorted(occurrence["examples"])[:8],
				"notes": matrix_entry["notes"],
			}
		)

	return {
		"scope": manifest.get("scope", matrix.get("scope")),
		"manifest": manifest_path_for_output().relative_to(REPO_ROOT).as_posix(),
		"matrix": DEFAULT_MATRIX.relative_to(REPO_ROOT).as_posix(),
		"entries": file_reports,
		"aggregate_top_tags": global_tags.most_common(40),
		"aggregate_attribute_patterns": global_attribute_patterns.most_common(30),
		"aggregate_nested_wrapper_patterns": global_nested_patterns.most_common(),
		"aggregate_correction_patterns": global_correction_patterns.most_common(),
		"aggregate_formwork_shapes": global_formwork_shapes.most_common(),
		"aggregate_carrier_examples": global_carrier_examples.most_common(),
		"matrix_dispositions": matrix_dispositions,
		"summary": {
			"real_witness_count": sum(1 for entry in entries if entry["kind"] == "real-witness"),
			"focused_fixture_count": sum(1 for entry in entries if entry["kind"] == "focused-fixture"),
			"out_of_scope_fixture_count": sum(
				1 for entry in entries if entry["kind"] == "out-of-scope-fixture"
			),
			"missing_in_scope_constructs": [],
			"weak_editor_surfaces": sorted(
				entry["construct"]
				for entry in matrix_dispositions
				if entry["status"] == "supported-carrier-ui"
			),
			"out_of_scope_constructs": sorted(
				entry["construct"] for entry in matrix_dispositions if entry["status"] == "out-of-scope"
			),
			"uncategorized_body_tags": sorted(uncategorized_body_tags),
		},
	}


def summarize_file(path: Path) -> dict[str, Any]:
	root = ET.parse(path).getroot()
	tags: Counter[str] = Counter()
	attribute_patterns: Counter[str] = Counter()
	nested_wrapper_patterns: Counter[str] = Counter()
	correction_patterns: Counter[str] = Counter()
	formwork_shapes: Counter[str] = Counter()
	carrier_examples: Counter[str] = Counter()
	construct_matches: set[str] = set()
	construct_occurrences: dict[str, dict[str, Any]] = {}
	uncategorized_body_tags: set[str] = set()

	def walk(element: ET.Element, ancestors: list[str]) -> None:
		tag = tei_tag(element.tag)
		tags[tag] += 1
		if element.attrib:
			attribute_patterns[format_attribute_pattern(tag, element.attrib)] += 1

		construct = classify_element(element, ancestors)
		if construct:
			construct_matches.add(construct)
			record_occurrence(construct_occurrences, construct, tag, element)
		elif is_body_element(ancestors) and tag not in IGNORED_BODY_TAGS:
			uncategorized_body_tags.add(tag)

		if tag in BODY_WRAPPER_TAGS and is_body_element(ancestors):
			child_tags = [tei_tag(child.tag) for child in list(element)]
			if child_tags:
				nested_wrapper_patterns[f"{tag}>{'>'.join(child_tags)}"] += 1
				if tag == "seg" or any(child_tag != "w" for child_tag in child_tags):
					construct_matches.add("structured-inline-wrappers")
					record_occurrence(construct_occurrences, "structured-inline-wrappers", tag, element)

		if tag == "app" and is_body_element(ancestors):
			correction_patterns[describe_app_pattern(element)] += 1

		if tag == "fw":
			formwork_shapes[describe_formwork_shape(element, ancestors)] += 1

		if construct in {
			"hand-shifts",
			"tei-milestones",
			"gaps-spaces-untranscribed",
			"metamarks",
			"tei-atoms",
			"formwork-and-marginalia",
		}:
			carrier_examples[f"{construct}:{tag}"] += 1

		for child in list(element):
			walk(child, ancestors + [tag])

	walk(root, [])
	return {
		"tags": tags,
		"attribute_patterns": attribute_patterns,
		"nested_wrapper_patterns": nested_wrapper_patterns,
		"correction_patterns": correction_patterns,
		"formwork_shapes": formwork_shapes,
		"carrier_examples": carrier_examples,
		"construct_matches": construct_matches,
		"construct_occurrences": construct_occurrences,
		"uncategorized_body_tags": uncategorized_body_tags,
	}


def classify_element(element: ET.Element, ancestors: list[str]) -> str | None:
	tag = tei_tag(element.tag)
	if tag == "TEI":
		return None
	if is_header_element(ancestors, tag):
		return "header-and-record-metadata"
	if tag in NON_BODY_SECTION_TAGS or is_non_body_section_descendant(ancestors):
		return "non-body-tei-sections"
	if tag in {"text", "body"}:
		return None
	if tag in {"pb", "cb", "lb", "div", "ab", "w", "pc"} and is_body_element(ancestors):
		return "document-structure"
	if tag in FLAT_WRAPPER_TAGS and is_body_element(ancestors):
		return "flat-inline-wrappers"
	if tag in TEXT_MARK_TAGS and is_body_element(ancestors):
		return "inline-editorial-text-marks"
	if tag in {"abbr", "ex"} and is_body_element(ancestors):
		return "abbreviation-expansion"
	if tag == "app" and is_simple_correction_app(element) and is_body_element(ancestors):
		return "corrections"
	if tag == "rdg" and is_body_element(ancestors):
		parent_tag = ancestors[-1] if ancestors else ""
		if parent_tag == "app" and not element.attrib.get("wit"):
			return "corrections"
	if tag == "handShift" and is_body_element(ancestors):
		return "hand-shifts"
	if tag == "milestone" and is_body_element(ancestors):
		return "tei-milestones"
	if tag in {"gap", "space"} and is_body_element(ancestors):
		return "gaps-spaces-untranscribed"
	if tag == "note" and is_body_element(ancestors):
		if element.attrib.get("type") == "untranscribed":
			return "gaps-spaces-untranscribed"
		return "tei-atoms"
	if tag in {"gb", "ptr", "media", "ellipsis"} and is_body_element(ancestors):
		return "tei-atoms"
	if tag == "metamark" and is_body_element(ancestors):
		return "metamarks"
	if tag in EDITORIAL_ACTION_TAGS and is_body_element(ancestors):
		return "editorial-actions"
	if tag == "fw" and is_body_element(ancestors):
		return "formwork-and-marginalia"
	if tag == "seg" and is_body_element(ancestors):
		if contains_descendant_tag(element, "fw") or element.attrib.get("type") in {"marginalia", "margin"}:
			return "formwork-and-marginalia"
		return "structured-inline-wrappers"
	if tag in OUT_OF_SCOPE_TAGS:
		return "lem-rdggrp-listapp-notegrp"
	if tag == "rdg" and element.attrib.get("wit"):
		return "multi-witness-apparatus"
	if tag == "app" and contains_any_descendant_or_child(element, OUT_OF_SCOPE_TAGS | {"lem"}):
		return "multi-witness-apparatus"
	return None


def is_simple_correction_app(app: ET.Element) -> bool:
	child_tags = [tei_tag(child.tag) for child in list(app)]
	if not child_tags or any(tag != "rdg" for tag in child_tags):
		return False
	types = {child.attrib.get("type", "") for child in list(app)}
	return types.issubset({"orig", "corr"}) and "corr" in types and all(
		"wit" not in child.attrib for child in list(app)
	)


def contains_descendant_tag(element: ET.Element, target: str) -> bool:
	return any(tei_tag(desc.tag) == target for desc in element.iter() if desc is not element)


def contains_any_descendant_or_child(element: ET.Element, targets: set[str]) -> bool:
	return any(tei_tag(desc.tag) in targets for desc in element.iter() if desc is not element)


def is_header_element(ancestors: list[str], tag: str) -> bool:
	return tag == "teiHeader" or "teiHeader" in ancestors


def is_non_body_section_descendant(ancestors: list[str]) -> bool:
	return any(ancestor in NON_BODY_SECTION_TAGS for ancestor in ancestors)


def is_body_element(ancestors: list[str]) -> bool:
	return "body" in ancestors


def format_attribute_pattern(tag: str, attrs: dict[str, str]) -> str:
	return f"{tag} " + ",".join(f"{tei_tag(name)}={value}" for name, value in sorted(attrs.items()))


def record_occurrence(
	construct_occurrences: dict[str, dict[str, Any]],
	construct: str,
	tag: str,
	element: ET.Element,
) -> None:
	entry = construct_occurrences.setdefault(construct, {"count": 0, "examples": set()})
	entry["count"] += 1
	example = tag
	if element.attrib:
		attrs = ", ".join(f"{tei_tag(key)}={value}" for key, value in sorted(element.attrib.items()))
		example = f"{tag}[{attrs}]"
	entry["examples"].add(example)


def describe_app_pattern(app: ET.Element) -> str:
	readings = []
	for child in list(app):
		child_tag = tei_tag(child.tag)
		if child_tag != "rdg":
			readings.append(child_tag)
			continue
		pattern = child.attrib.get("type", "rdg")
		hand = child.attrib.get("hand")
		wit = child.attrib.get("wit")
		if hand:
			pattern += f"@{hand}"
		if wit:
			pattern += f"/wit={wit}"
		readings.append(pattern)
	return " | ".join(readings)


def describe_formwork_shape(fw: ET.Element, ancestors: list[str]) -> str:
	seg_suffix = "(seg)" if ancestors and ancestors[-1] == "seg" else ""
	type_value = fw.attrib.get("type", "")
	subtype_value = fw.attrib.get("subtype", "")
	place_value = fw.attrib.get("place", "")
	return "|".join(value or "-" for value in [f"fw{seg_suffix}", type_value, subtype_value, place_value])


def disposition_for_status(status: str) -> str:
	if status == "supported-editor-addressable":
		return "already-supported"
	if status == "supported-carrier-ui":
		return "supported-but-inspector-driven"
	return "correctly-out-of-scope"


def tei_tag(value: str) -> str:
	return value.split("}", 1)[1] if "}" in value else value


def manifest_path_for_output() -> Path:
	return DEFAULT_MANIFEST


if __name__ == "__main__":
	raise SystemExit(main())
