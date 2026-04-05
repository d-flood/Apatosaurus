from __future__ import annotations

import argparse
import json
from pathlib import Path

VALID_STATUSES = {
	"supported-editor-addressable",
	"supported-carrier-ui",
	"out-of-scope",
}

CONSTRUCTS = [
	{
		"construct": "document-structure",
		"status": "supported-editor-addressable",
		"mechanism": "canonical-pages-columns-lines",
		"editor_surface": "main-editor",
		"notes": "TEI/text/body attrs, page-column-line flow, book/chapter/verse milestones, and implicit words are modeled directly.",
	},
	{
		"construct": "flat-inline-wrappers",
		"status": "supported-editor-addressable",
		"mechanism": "teiSpan-mark",
		"editor_surface": "main-editor",
		"notes": "foreign, term, name, num, date, unit, am, expan, gloss, placeName, objectName, body title, bibl, mod, and retrace flatten to text marks when structurally safe.",
	},
	{
		"construct": "inline-editorial-text-marks",
		"status": "supported-editor-addressable",
		"mechanism": "inline-text-marks",
		"editor_surface": "main-editor",
		"notes": "supplied, unclear, hi, damage, surplus, and secl remain directly editable inline marks in the main editor flow.",
	},
	{
		"construct": "structured-inline-wrappers",
		"status": "supported-carrier-ui",
		"mechanism": "teiWrapper-carrier",
		"editor_surface": "node-inspector",
		"notes": "Non-flat wrapper cases are preserved as structured carrier nodes with editable attrs and visible previews instead of hard-failing.",
	},
	{
		"construct": "corrections",
		"status": "supported-editor-addressable",
		"mechanism": "correction-mark-and-node",
		"editor_surface": "selection-ui-and-node-inspector",
		"notes": "Single-witness correction-style app/rdg content is modeled semantically in both inline and correction-only forms.",
	},
	{
		"construct": "hand-shifts",
		"status": "supported-carrier-ui",
		"mechanism": "handShift-node",
		"editor_surface": "node-inspector",
		"notes": "handShift is represented as a dedicated carrier node with editable TEI attrs.",
	},
	{
		"construct": "tei-milestones",
		"status": "supported-carrier-ui",
		"mechanism": "teiMilestone-node",
		"editor_surface": "node-inspector",
		"notes": "Generic milestone elements are preserved as explicit carriers while verse/book/chapter milestones also drive editor structure.",
	},
	{
		"construct": "gaps-spaces-untranscribed",
		"status": "supported-carrier-ui",
		"mechanism": "dedicated-carrier-nodes",
		"editor_surface": "node-inspector",
		"notes": "gap, space, and note type=untranscribed are canonical body carriers with deliberate inspector surfaces.",
	},
	{
		"construct": "metamarks",
		"status": "supported-carrier-ui",
		"mechanism": "mark-or-carrier-node",
		"editor_surface": "node-inspector",
		"notes": "Text-bearing metamark stays a flat span when safe; standalone or non-flat cases use explicit carriers.",
	},
	{
		"construct": "tei-atoms",
		"status": "supported-carrier-ui",
		"mechanism": "teiAtom-node",
		"editor_surface": "node-inspector",
		"notes": "gb, ptr, media, note, and ellipsis are carried as dedicated structured nodes rather than opaque XML strings.",
	},
	{
		"construct": "editorial-actions",
		"status": "supported-carrier-ui",
		"mechanism": "editorialAction-node",
		"editor_surface": "node-inspector",
		"notes": "undo, redo, substJoin, transpose, and listTranspose are modeled as structured editorial action carriers.",
	},
	{
		"construct": "abbreviation-expansion",
		"status": "supported-editor-addressable",
		"mechanism": "abbreviation-mark",
		"editor_surface": "selection-ui",
		"notes": "abbr and ex round-trip through the shared abbreviation mark and editor tooling.",
	},
	{
		"construct": "formwork-and-marginalia",
		"status": "supported-carrier-ui",
		"mechanism": "fw-node",
		"editor_surface": "page-ui-and-node-inspector",
		"notes": "fw and marginal seg metadata are preserved canonically with insertion and editing paths in the page editor surface.",
	},
	{
		"construct": "header-and-record-metadata",
		"status": "supported-carrier-ui",
		"mechanism": "typed-header-plus-db-bridge",
		"editor_surface": "metadata-dialog",
		"notes": "Database-backed transcription metadata stays outside TipTap while TEI header and manuscript details are preserved structurally.",
	},
	{
		"construct": "non-body-tei-sections",
		"status": "supported-carrier-ui",
		"mechanism": "structured-tei-tree-preservation",
		"editor_surface": "import-summary-and-export",
		"notes": "teiHeader, front, back, facsimile, standOff, sourceDoc, and other ordered text globals are preserved as TEI trees outside the PM body.",
	},
	{
		"construct": "multi-witness-apparatus",
		"status": "out-of-scope",
		"mechanism": "explicit-import-error",
		"editor_surface": "none",
		"notes": "Broader apparatus documents and witness-based variant encoding stay rejected for the single-witness transcription subset.",
	},
	{
		"construct": "lem-rdggrp-listapp-notegrp",
		"status": "out-of-scope",
		"mechanism": "explicit-import-error",
		"editor_surface": "none",
		"notes": "lem, rdgGrp, listApp, and noteGrp remain outside the transcription editor boundary unless they participate in the simple single-witness correction path.",
	},
]


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Generate the single-witness IGNTP support matrix."
	)
	parser.add_argument("--schema", required=True, help="Path to document.xsd")
	parser.add_argument("--output", help="Write generated JSON to this path.")
	parser.add_argument("--check", help="Compare generated JSON to this existing file.")
	return parser.parse_args()


def main() -> int:
	args = parse_args()
	schema_path = Path(args.schema)
	matrix = build_support_matrix(schema_path.as_posix())
	rendered = json.dumps(matrix, indent=2, ensure_ascii=True) + "\n"

	if args.output:
		output_path = Path(args.output).resolve()
		output_path.write_text(rendered)

	if args.check:
		check_path = Path(args.check).resolve()
		existing = check_path.read_text()
		if existing != rendered:
			print(f"Support matrix is out of date: {check_path}")
			return 1

	if not args.output and not args.check:
		print(rendered, end="")

	return 0


def build_support_matrix(schema_label: str) -> dict[str, object]:
	for entry in CONSTRUCTS:
		if entry["status"] not in VALID_STATUSES:
			raise ValueError(f"Unsupported matrix status: {entry['status']}")

	return {
		"schema": schema_label,
		"scope": "single-witness-transcription",
		"statuses": sorted(VALID_STATUSES),
		"constructs": CONSTRUCTS,
	}


if __name__ == "__main__":
	raise SystemExit(main())
