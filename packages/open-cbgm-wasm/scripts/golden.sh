#!/bin/sh
set -eu

EMSDK_IMAGE=emscripten/emsdk:4.0.10
PACKAGE_DIR=$(cd "$(dirname "$0")/.." && pwd)

docker run --rm -u "$(id -u):$(id -g)" -v "$PACKAGE_DIR:/package" -w /package "$EMSDK_IMAGE" sh -euc '
cp -r vendor/open-cbgm-standalone /tmp/upstream
cmake -S /tmp/upstream -B /tmp/build -DCMAKE_BUILD_TYPE=Release > /dev/null
cmake --build /tmp/build -j "$(nproc)" --target populate_db compare_witnesses find_relatives \
	optimize_substemmata print_textual_flow print_global_stemma > /dev/null
BIN=/tmp/build/bin
INPUT=/tmp/upstream/lib/open-cbgm/examples/3_john_collation.xml
CACHE=/tmp/cache.db
FLOW_UNITS="B25K1V1U2 B25K1V5U22 B25K1V12U34-42"

flow() {
	rm -rf /tmp/flow
	mkdir /tmp/flow
	NAME=$1
	shift
	(cd /tmp/flow && $BIN/print_textual_flow "$@" $CACHE $FLOW_UNITS > /dev/null)
	python3 scripts/collect_flow.py $CACHE /tmp/flow $OUT/textual-flow-$NAME.json $FLOW_UNITS
}

stemma() {
	rm -rf /tmp/stemma
	mkdir /tmp/stemma
	NAME=$1
	shift
	(cd /tmp/stemma && $BIN/print_global_stemma "$@" $CACHE > /dev/null)
	cp /tmp/stemma/global/global-stemma.dot $OUT/global-stemma-$NAME.dot
}

golden() {
	OUT=tests/fixtures/$1
	shift
	mkdir -p $OUT
	rm -f $CACHE
	$BIN/populate_db "$@" $INPUT $CACHE > /dev/null
	python3 scripts/dump_cache.py $CACHE $OUT/tables.json.gz
	# populate_db writes comparisons in thread completion order, and the query programs break ties in that order.
	python3 scripts/order_comparisons.py $CACHE
	$BIN/compare_witnesses -f json -o $OUT/compare-all.json $CACHE 5 > /dev/null
	$BIN/compare_witnesses -f json -o $OUT/compare-list.json $CACHE 5 A 01 03 623 > /dev/null
	$BIN/find_relatives -f json -o $OUT/relatives-all.json $CACHE 5 B25K1V4U22-26 > /dev/null
	$BIN/find_relatives -f json -o $OUT/relatives-one.json $CACHE 5 B25K1V4U22-26 b > /dev/null
	$BIN/find_relatives -f json -o $OUT/relatives-two.json $CACHE 5 B25K1V4U22-26 a d > /dev/null
	for WIT in 025 5 A 03; do
		$BIN/optimize_substemmata -f json $CACHE $WIT | tail -n 1 > $OUT/substemmata-$WIT.txt
		$BIN/optimize_substemmata -f json -b 5 $CACHE $WIT | tail -n 1 > $OUT/substemmata-$WIT-b5.txt
	done
	flow plain
	flow strengths --strengths
	flow k3 -k 3
	stemma plain
	stemma lengths --lengths
	stemma strengths --strengths
	stemma lengths-strengths --lengths --strengths
}

golden default
node --experimental-strip-types --no-warnings scripts/add_substemmata.ts $CACHE /tmp/substemmata.db
python3 -c "import sqlite3, sys; assert sqlite3.connect(sys.argv[1]).execute(\"SELECT COUNT(*) FROM APATOSAURUS_SUBSTEMMATA\").fetchone()[0] > 0" /tmp/substemmata.db
$BIN/compare_witnesses -f json -o tests/fixtures/default/compare-all-with-substemmata.json /tmp/substemmata.db 5 > /dev/null
golden classic --classic
golden dropped-ambiguous-merge-splits -Z ambiguous --merge-splits
'
