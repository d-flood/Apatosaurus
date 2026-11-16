from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from lxml import etree


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Validate TEI XML against an XSD or Relax NG schema using lxml."
	)
	parser.add_argument("--schema", required=True, help="Path to the schema file.")
	parser.add_argument(
		"--schema-kind",
		choices=("xsd", "relaxng"),
		default="xsd",
		help="Schema language (default: xsd).",
	)
	parser.add_argument(
		"--xml",
		help="Path to the XML file to validate. If omitted, XML is read from stdin.",
	)
	parser.add_argument(
		"--serve",
		action="store_true",
		help="Compile the schema once, print 'ready', then validate one XML path per stdin line, "
		"answering each with one JSON line.",
	)
	return parser.parse_args()


def load_schema(schema_path: Path, schema_kind: str) -> etree._Validator:
	schema_doc = etree.parse(str(schema_path))
	return etree.RelaxNG(schema_doc) if schema_kind == "relaxng" else etree.XMLSchema(schema_doc)


def load_xml(xml_path: Path | None) -> etree._ElementTree:
	parser = etree.XMLParser(
		resolve_entities=False,
		no_network=True,
		remove_blank_text=False,
		huge_tree=True,
	)
	if xml_path is not None:
		return etree.parse(str(xml_path), parser)

	xml_bytes = sys.stdin.buffer.read()
	root = etree.fromstring(xml_bytes, parser)
	return etree.ElementTree(root)


def serve(schema: etree._Validator) -> int:
	print("ready", flush=True)
	for line in sys.stdin:
		try:
			document = load_xml(Path(line.strip()))
		except (OSError, etree.XMLSyntaxError) as exc:
			print(json.dumps({"ok": False, "errors": [f"Failed to load XML: {exc}"]}), flush=True)
			continue
		ok = schema.validate(document)
		errors = (
			[]
			if ok
			else [f"line {error.line}, column {error.column}: {error.message}" for error in schema.error_log]
		)
		print(json.dumps({"ok": ok, "errors": errors}), flush=True)
	return 0


def main() -> int:
	args = parse_args()
	schema_path = Path(args.schema).resolve()
	if args.serve:
		try:
			schema = load_schema(schema_path, args.schema_kind)
		except (OSError, etree.XMLSyntaxError, etree.XMLSchemaParseError, etree.RelaxNGParseError) as exc:
			print(f"Failed to load validation inputs: {exc}", file=sys.stderr)
			return 2
		return serve(schema)
	xml_path = Path(args.xml).resolve() if args.xml else None

	try:
		schema = load_schema(schema_path, args.schema_kind)
		document = load_xml(xml_path)
	except (
		OSError,
		etree.XMLSyntaxError,
		etree.XMLSchemaParseError,
		etree.RelaxNGParseError,
	) as exc:
		print(f"Failed to load validation inputs: {exc}", file=sys.stderr)
		return 2

	if schema.validate(document):
		target = str(xml_path) if xml_path else "<stdin>"
		print(f"OK {target}")
		return 0

	print(f"{args.schema_kind.upper()} validation failed:", file=sys.stderr)
	for error in schema.error_log:
		print(
			f"  line {error.line}, column {error.column}: {error.message}",
			file=sys.stderr,
		)
	return 1


if __name__ == "__main__":
	raise SystemExit(main())
