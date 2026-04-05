from __future__ import annotations

import argparse
import sys
from pathlib import Path

from lxml import etree


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Validate TEI XML against an XSD schema using lxml."
	)
	parser.add_argument("--schema", required=True, help="Path to the XSD schema file.")
	parser.add_argument(
		"--xml",
		help="Path to the XML file to validate. If omitted, XML is read from stdin.",
	)
	return parser.parse_args()


def load_schema(schema_path: Path) -> etree.XMLSchema:
	schema_doc = etree.parse(str(schema_path))
	return etree.XMLSchema(schema_doc)


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


def main() -> int:
	args = parse_args()
	schema_path = Path(args.schema).resolve()
	xml_path = Path(args.xml).resolve() if args.xml else None

	try:
		schema = load_schema(schema_path)
		document = load_xml(xml_path)
	except (OSError, etree.XMLSyntaxError, etree.XMLSchemaParseError) as exc:
		print(f"Failed to load validation inputs: {exc}", file=sys.stderr)
		return 2

	if schema.validate(document):
		target = str(xml_path) if xml_path else "<stdin>"
		print(f"OK {target}")
		return 0

	print("XSD validation failed:", file=sys.stderr)
	for error in schema.error_log:
		print(
			f"  line {error.line}, column {error.column}: {error.message}",
			file=sys.stderr,
		)
	return 1


if __name__ == "__main__":
	raise SystemExit(main())
