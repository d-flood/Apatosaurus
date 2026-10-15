#!/bin/sh
set -eu

EMSDK_IMAGE=emscripten/emsdk:4.0.10
PACKAGE_DIR=$(cd "$(dirname "$0")/.." && pwd)

docker run --rm -u "$(id -u):$(id -g)" -v "$PACKAGE_DIR:/package" -w /package "$EMSDK_IMAGE" sh -euc '
UPSTREAM=vendor/open-cbgm-standalone
CORE=$UPSTREAM/lib/open-cbgm
ROARING=$CORE/lib/roaring
OBJ=/tmp/obj
mkdir -p $OBJ dist

emcc -O3 -DNDEBUG -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION=1 \
	-c $UPSTREAM/lib/sqlite3/sqlite3.c -o $OBJ/sqlite3.o

for src in $(cd $ROARING/src && find . -name "*.c" | sort); do
	emcc -std=c11 -O3 -DNDEBUG -I$ROARING/include \
		-c $ROARING/src/$src -o $OBJ/roaring_$(echo $src | tr / _ | sed "s/^\._//").o
done

CXXFLAGS="-O3 -fwasm-exceptions -I$CORE/include -I$CORE/lib/pugixml/src -I$ROARING/include -I$ROARING/cpp"
em++ -std=c++11 $CXXFLAGS -c $CORE/lib/pugixml/src/pugixml.cpp -o $OBJ/pugixml.o
for src in $(cd $CORE/src && ls *.cpp | sort); do
	em++ -std=c++11 $CXXFLAGS -c $CORE/src/$src -o $OBJ/core_${src%.cpp}.o
done
em++ -std=c++17 $CXXFLAGS -I$UPSTREAM/lib/sqlite3 -c binding/engine.cpp -o $OBJ/engine.o

em++ -O3 -fwasm-exceptions -lembind $(ls $OBJ/*.o | sort) \
	-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createOpenCbgmModule \
	-sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=1MB \
	--emit-tsd open-cbgm.d.ts -o dist/open-cbgm.js
'
