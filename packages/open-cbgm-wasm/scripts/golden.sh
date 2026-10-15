#!/bin/sh
set -eu

EMSDK_IMAGE=emscripten/emsdk:4.0.10
PACKAGE_DIR=$(cd "$(dirname "$0")/.." && pwd)

docker run --rm -u "$(id -u):$(id -g)" -v "$PACKAGE_DIR:/package" -w /package "$EMSDK_IMAGE" sh -euc '
cp -r vendor/open-cbgm-standalone /tmp/upstream
cmake -S /tmp/upstream -B /tmp/build -DCMAKE_BUILD_TYPE=Release > /dev/null
cmake --build /tmp/build --target populate_db compare_witnesses -j "$(nproc)" > /dev/null
BIN=/tmp/build/bin
INPUT=/tmp/upstream/lib/open-cbgm/examples/3_john_collation.xml
CACHE=/tmp/cache.db

golden() {
	OUT=tests/fixtures/$1
	shift
	mkdir -p $OUT
	rm -f $CACHE
	$BIN/populate_db "$@" $INPUT $CACHE > /dev/null
	python3 scripts/dump_cache.py $CACHE $OUT/tables.json.gz
	$BIN/compare_witnesses -f json -o $OUT/compare-all.json $CACHE 5 > /dev/null
	$BIN/compare_witnesses -f json -o $OUT/compare-list.json $CACHE 5 A 01 03 623 > /dev/null
}

golden default
golden classic --classic
golden dropped-ambiguous-merge-splits -Z ambiguous --merge-splits
'
