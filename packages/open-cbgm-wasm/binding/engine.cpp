#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <list>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <roaring/roaring.hh>

#include "apparatus.h"
#include "compare_witnesses_table.h"
#include "local_stemma.h"
#include "pugixml.hpp"
#include "sqlite3.h"
#include "variation_unit.h"
#include "witness.h"

using namespace std;
using namespace emscripten;
using roaring::Roaring;

namespace {

const char * ASSEMBLE_PATH = "/assemble.db";
const char * CACHE_PATH = "/cache.db";

apparatus app;
bool classic = false;
bool prepared = false;
sqlite3 * cache_db = nullptr;
set<string> filter_excluded_wit_ids;

class database {
public:
	sqlite3 * db = nullptr;
	database(const char * path, int flags) {
		if (sqlite3_open_v2(path, &db, flags, nullptr) != SQLITE_OK) {
			string message = sqlite3_errmsg(db);
			sqlite3_close(db);
			throw runtime_error("Error opening database: " + message);
		}
	}
	~database() {
		sqlite3_close(db);
	}
};

class statement {
public:
	sqlite3_stmt * stmt = nullptr;
	statement(sqlite3 * db, const char * sql) {
		if (sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr) != SQLITE_OK) {
			throw runtime_error(string("Error preparing statement: ") + sqlite3_errmsg(db));
		}
	}
	~statement() {
		sqlite3_finalize(stmt);
	}
	bool next_row() {
		int rc = sqlite3_step(stmt);
		if (rc == SQLITE_ROW) {
			return true;
		}
		if (rc != SQLITE_DONE) {
			throw runtime_error(string("Error reading database: ") + sqlite3_errmsg(sqlite3_db_handle(stmt)));
		}
		return false;
	}
	void insert() {
		if (sqlite3_step(stmt) != SQLITE_DONE) {
			throw runtime_error(string("Error executing prepared statement: ") + sqlite3_errmsg(sqlite3_db_handle(stmt)));
		}
		sqlite3_reset(stmt);
	}
	string text(int column) {
		const unsigned char * value = sqlite3_column_text(stmt, column);
		return value ? string(reinterpret_cast<const char *>(value)) : string();
	}
	Roaring bitmap(int column) {
		int bytes = sqlite3_column_bytes(stmt, column);
		const char * buf = reinterpret_cast<const char *>(sqlite3_column_blob(stmt, column));
		return Roaring::readSafe(buf, bytes);
	}
};

void exec(sqlite3 * db, const string & sql) {
	char * error_msg = nullptr;
	if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &error_msg) != SQLITE_OK) {
		string message = error_msg ? error_msg : sqlite3_errmsg(db);
		sqlite3_free(error_msg);
		throw runtime_error(message);
	}
}

val to_uint8_array(const string & bytes) {
	return val::global("Uint8Array").new_(typed_memory_view(bytes.size(), reinterpret_cast<const uint8_t *>(bytes.data())));
}

string from_uint8_array(const val & array) {
	vector<uint8_t> bytes = convertJSArrayToNumberVector<uint8_t>(array);
	return string(bytes.begin(), bytes.end());
}

void write_file(const char * path, const string & bytes) {
	ofstream file(path, ios::binary | ios::trunc);
	file.write(bytes.data(), bytes.size());
	if (!file) {
		throw runtime_error(string("Error writing ") + path);
	}
}

string read_file(const char * path) {
	ifstream file(path, ios::binary);
	return string(istreambuf_iterator<char>(file), istreambuf_iterator<char>());
}

void require_prepared() {
	if (!prepared) {
		throw runtime_error("prepare() must be called first.");
	}
}

void require_open() {
	if (!cache_db) {
		throw runtime_error("open() must be called first.");
	}
}

void put_u32(string & out, uint32_t value) {
	for (int i = 0; i < 4; i++) {
		out.push_back(char((value >> (8 * i)) & 0xff));
	}
}

void put_bytes(string & out, const string & bytes) {
	put_u32(out, bytes.size());
	out += bytes;
}

void put_bitmap(string & out, Roaring bitmap) {
	string buf(bitmap.getSizeInBytes(), '\0');
	bitmap.write(&buf[0]);
	put_bytes(out, buf);
}

class row_reader {
	const string & bytes;
	size_t pos = 0;
public:
	explicit row_reader(const string & _bytes) : bytes(_bytes) {}
	bool done() const {
		return pos == bytes.size();
	}
	uint32_t u32() {
		if (bytes.size() - pos < 4) {
			throw runtime_error("Witness rows are truncated.");
		}
		uint32_t value = 0;
		for (int i = 0; i < 4; i++) {
			value |= uint32_t(uint8_t(bytes[pos + i])) << (8 * i);
		}
		pos += 4;
		return value;
	}
	string chunk() {
		uint32_t size = u32();
		if (bytes.size() - pos < size) {
			throw runtime_error("Witness rows are truncated.");
		}
		string value = bytes.substr(pos, size);
		pos += size;
		return value;
	}
	float f32() {
		uint32_t bits = u32();
		float value;
		memcpy(&value, &bits, sizeof value);
		return value;
	}
};

void populate_readings_table(sqlite3 * db) {
	exec(db, "DROP TABLE IF EXISTS READINGS;"
			"CREATE TABLE READINGS ("
			"ROW_ID INT NOT NULL, "
			"VARIATION_UNIT TEXT NOT NULL, "
			"READING TEXT NOT NULL);");
	exec(db, "DROP INDEX IF EXISTS READINGS_IDX;"
			"CREATE INDEX READINGS_IDX ON READINGS (VARIATION_UNIT, READING);");
	exec(db, "BEGIN TRANSACTION");
	statement insert(db, "INSERT INTO READINGS VALUES (?,?,?)");
	int row_id = 0;
	for (const variation_unit & vu : app.get_variation_units()) {
		string vu_id = vu.get_id();
		for (const string & rdg : vu.get_readings()) {
			sqlite3_bind_int(insert.stmt, 1, row_id);
			sqlite3_bind_text(insert.stmt, 2, vu_id.c_str(), -1, SQLITE_STATIC);
			sqlite3_bind_text(insert.stmt, 3, rdg.c_str(), -1, SQLITE_STATIC);
			insert.insert();
			row_id++;
		}
	}
	exec(db, "END TRANSACTION");
}

void populate_reading_relations_table(sqlite3 * db) {
	exec(db, "DROP TABLE IF EXISTS READING_RELATIONS;"
			"CREATE TABLE READING_RELATIONS ("
			"ROW_ID INT NOT NULL, "
			"VARIATION_UNIT TEXT NOT NULL, "
			"PRIOR TEXT NOT NULL, "
			"POSTERIOR TEXT NOT NULL, "
			"WEIGHT REAL NOT NULL);");
	exec(db, "DROP INDEX IF EXISTS READING_RELATIONS_IDX;"
			"CREATE INDEX READING_RELATIONS_IDX ON READING_RELATIONS (VARIATION_UNIT, PRIOR, POSTERIOR);");
	exec(db, "BEGIN TRANSACTION");
	statement insert(db, "INSERT INTO READING_RELATIONS VALUES (?,?,?,?,?)");
	int row_id = 0;
	for (const variation_unit & vu : app.get_variation_units()) {
		string vu_id = vu.get_id();
		for (const local_stemma_edge & e : vu.get_local_stemma().get_edges()) {
			sqlite3_bind_int(insert.stmt, 1, row_id);
			sqlite3_bind_text(insert.stmt, 2, vu_id.c_str(), -1, SQLITE_STATIC);
			sqlite3_bind_text(insert.stmt, 3, e.prior.c_str(), -1, SQLITE_STATIC);
			sqlite3_bind_text(insert.stmt, 4, e.posterior.c_str(), -1, SQLITE_STATIC);
			sqlite3_bind_double(insert.stmt, 5, e.weight);
			insert.insert();
			row_id++;
		}
	}
	exec(db, "END TRANSACTION");
}

void populate_reading_support_table(sqlite3 * db) {
	exec(db, "DROP TABLE IF EXISTS READING_SUPPORT;"
			"CREATE TABLE READING_SUPPORT ("
			"ROW_ID INT NOT NULL, "
			"VARIATION_UNIT TEXT NOT NULL, "
			"WITNESS TEXT NOT NULL, "
			"READING TEXT NOT NULL);");
	exec(db, "DROP INDEX IF EXISTS READING_SUPPORT_IDX;"
			"CREATE INDEX READING_SUPPORT_IDX ON READING_SUPPORT (VARIATION_UNIT, WITNESS, READING);");
	exec(db, "BEGIN TRANSACTION");
	statement insert(db, "INSERT INTO READING_SUPPORT VALUES (?,?,?,?)");
	int row_id = 0;
	list<string> list_wit = app.get_list_wit();
	for (const variation_unit & vu : app.get_variation_units()) {
		string vu_id = vu.get_id();
		unordered_map<string, string> reading_support = vu.get_reading_support();
		for (const string & wit_id : list_wit) {
			auto support = reading_support.find(wit_id);
			if (support == reading_support.end()) {
				continue;
			}
			sqlite3_bind_int(insert.stmt, 1, row_id);
			sqlite3_bind_text(insert.stmt, 2, vu_id.c_str(), -1, SQLITE_STATIC);
			sqlite3_bind_text(insert.stmt, 3, wit_id.c_str(), -1, SQLITE_STATIC);
			sqlite3_bind_text(insert.stmt, 4, support->second.c_str(), -1, SQLITE_STATIC);
			insert.insert();
			row_id++;
		}
	}
	exec(db, "END TRANSACTION");
}

void populate_variation_units_table(sqlite3 * db) {
	exec(db, "DROP TABLE IF EXISTS VARIATION_UNITS;"
			"CREATE TABLE VARIATION_UNITS ("
			"ROW_ID INT NOT NULL, "
			"VARIATION_UNIT TEXT NOT NULL, "
			"LABEL TEXT, "
			"CONNECTIVITY INT NOT NULL);");
	exec(db, "DROP INDEX IF EXISTS VARIATION_UNITS_IDX;"
			"CREATE INDEX VARIATION_UNITS_IDX ON VARIATION_UNITS (VARIATION_UNIT);");
	exec(db, "BEGIN TRANSACTION");
	statement insert(db, "INSERT INTO VARIATION_UNITS VALUES (?,?,?,?)");
	int row_id = 0;
	for (const variation_unit & vu : app.get_variation_units()) {
		string id = vu.get_id();
		string label = vu.get_label();
		sqlite3_bind_int(insert.stmt, 1, row_id);
		sqlite3_bind_text(insert.stmt, 2, id.c_str(), -1, SQLITE_STATIC);
		sqlite3_bind_text(insert.stmt, 3, label.c_str(), -1, SQLITE_STATIC);
		sqlite3_bind_int(insert.stmt, 4, vu.get_connectivity());
		insert.insert();
		row_id++;
	}
	exec(db, "END TRANSACTION");
}

void populate_genealogical_comparisons_table(sqlite3 * db, const val & rows_by_siglum) {
	exec(db, "DROP TABLE IF EXISTS GENEALOGICAL_COMPARISONS;"
			"CREATE TABLE GENEALOGICAL_COMPARISONS ("
			"ROW_ID INT NOT NULL, "
			"PRIMARY_WIT TEXT NOT NULL, "
			"SECONDARY_WIT TEXT NOT NULL, "
			"EXTANT BLOB NOT NULL, "
			"AGREEMENTS BLOB NOT NULL, "
			"PRIOR BLOB NOT NULL, "
			"POSTERIOR BLOB NOT NULL, "
			"NOREL BLOB NOT NULL, "
			"UNCLEAR BLOB NOT NULL, "
			"EXPLAINED BLOB NOT NULL, "
			"COST REAL NOT NULL);");
	exec(db, "DROP INDEX IF EXISTS GENEALOGICAL_COMPARISONS_IDX;"
			"CREATE INDEX GENEALOGICAL_COMPARISONS_IDX ON GENEALOGICAL_COMPARISONS (PRIMARY_WIT, SECONDARY_WIT);");
	exec(db, "BEGIN TRANSACTION");
	statement insert(db, "INSERT INTO GENEALOGICAL_COMPARISONS VALUES (?,?,?,?,?,?,?,?,?,?,?)");
	int row_id = 0;
	list<string> list_wit = app.get_list_wit();
	for (const string & primary_wit_id : list_wit) {
		val rows = rows_by_siglum.call<val>("get", primary_wit_id);
		if (rows.isUndefined()) {
			throw runtime_error("No rows were given for witness " + primary_wit_id + ".");
		}
		string bytes = from_uint8_array(rows);
		row_reader reader(bytes);
		for (const string & secondary_wit_id : list_wit) {
			if (reader.done() || reader.chunk() != secondary_wit_id) {
				throw runtime_error("The rows for witness " + primary_wit_id + " do not match the prepared witnesses.");
			}
			vector<string> blobs;
			for (int i = 0; i < 7; i++) {
				blobs.push_back(reader.chunk());
			}
			float cost = reader.f32();
			sqlite3_bind_int(insert.stmt, 1, row_id);
			sqlite3_bind_text(insert.stmt, 2, primary_wit_id.c_str(), -1, SQLITE_STATIC);
			sqlite3_bind_text(insert.stmt, 3, secondary_wit_id.c_str(), -1, SQLITE_STATIC);
			for (int i = 0; i < 7; i++) {
				sqlite3_bind_blob(insert.stmt, 4 + i, blobs[i].data(), blobs[i].size(), SQLITE_STATIC);
			}
			sqlite3_bind_double(insert.stmt, 11, cost);
			insert.insert();
			row_id++;
		}
		if (!reader.done()) {
			throw runtime_error("The rows for witness " + primary_wit_id + " do not match the prepared witnesses.");
		}
	}
	exec(db, "END TRANSACTION");
}

void populate_witnesses_table(sqlite3 * db) {
	exec(db, "DROP TABLE IF EXISTS WITNESSES;"
			"CREATE TABLE WITNESSES ("
			"ROW_ID INT NOT NULL, "
			"WITNESS TEXT NOT NULL);");
	exec(db, "DROP INDEX IF EXISTS WITNESSES_IDX;"
			"CREATE INDEX WITNESSES_IDX ON WITNESSES (WITNESS);");
	exec(db, "BEGIN TRANSACTION");
	statement insert(db, "INSERT INTO WITNESSES VALUES (?,?)");
	int row_id = 0;
	for (const string & wit_id : app.get_list_wit()) {
		sqlite3_bind_int(insert.stmt, 1, row_id);
		sqlite3_bind_text(insert.stmt, 2, wit_id.c_str(), -1, SQLITE_STATIC);
		insert.insert();
		row_id++;
	}
	exec(db, "END TRANSACTION");
}

int count_variation_units(sqlite3 * db) {
	statement select(db, "SELECT COUNT(*) FROM VARIATION_UNITS");
	select.next_row();
	return sqlite3_column_int(select.stmt, 0);
}

list<string> get_list_wit(sqlite3 * db, const set<string> & excluded_wit_ids) {
	list<string> list_wit;
	statement select(db, "SELECT WITNESS FROM WITNESSES ORDER BY ROW_ID");
	while (select.next_row()) {
		string wit_id = select.text(0);
		if (excluded_wit_ids.find(wit_id) == excluded_wit_ids.end()) {
			list_wit.push_back(wit_id);
		}
	}
	return list_wit;
}

bool witness_exists(sqlite3 * db, const string & wit_id) {
	statement select(db, "SELECT * FROM GENEALOGICAL_COMPARISONS WHERE PRIMARY_WIT=? ORDER BY ROW_ID");
	sqlite3_bind_text(select.stmt, 1, wit_id.c_str(), -1, SQLITE_STATIC);
	return select.next_row();
}

void add_fragmentary_witnesses_to_excluded_set(sqlite3 * db, const int min_extant, set<string> & excluded_wit_ids) {
	statement select(db, "SELECT * FROM GENEALOGICAL_COMPARISONS WHERE PRIMARY_WIT=SECONDARY_WIT ORDER BY ROW_ID");
	while (select.next_row()) {
		if (select.bitmap(3).cardinality() < (uint64_t) min_extant) {
			excluded_wit_ids.insert(select.text(1));
		}
	}
}

witness get_witness(sqlite3 * db, const string & wit_id, const set<string> & excluded_wit_ids) {
	list<genealogical_comparison> comps;
	statement select(db, "SELECT * FROM GENEALOGICAL_COMPARISONS WHERE PRIMARY_WIT=? ORDER BY ROW_ID");
	sqlite3_bind_text(select.stmt, 1, wit_id.c_str(), -1, SQLITE_STATIC);
	while (select.next_row()) {
		genealogical_comparison comp;
		comp.primary_wit = select.text(1);
		comp.secondary_wit = select.text(2);
		if (excluded_wit_ids.find(comp.secondary_wit) != excluded_wit_ids.end()) {
			continue;
		}
		comp.extant = select.bitmap(3);
		comp.agreements = select.bitmap(4);
		comp.prior = select.bitmap(5);
		comp.posterior = select.bitmap(6);
		comp.norel = select.bitmap(7);
		comp.unclear = select.bitmap(8);
		comp.explained = select.bitmap(9);
		comp.cost = float(sqlite3_column_double(select.stmt, 10));
		comps.push_back(comp);
	}
	return witness(wit_id, comps);
}

void close_cache() {
	if (cache_db) {
		sqlite3_close(cache_db);
		cache_db = nullptr;
	}
	remove(CACHE_PATH);
}

template <typename F>
val guarded(F body) {
	try {
		return body();
	} catch (const exception & e) {
		return val::global("Error").new_(string(e.what()));
	}
}

val prepare(const string & input_tei, int threshold, const val & dropped, bool merge_splits, bool classic_rules) {
	return guarded([&] {
		prepared = false;
		pugi::xml_document doc;
		pugi::xml_parse_result pr = doc.load_buffer(input_tei.data(), input_tei.size());
		if (!pr) {
			throw runtime_error(string("An error occurred while loading the input TEI: ") + pr.description());
		}
		pugi::xml_node tei_node = doc.child("TEI");
		if (!tei_node) {
			throw runtime_error("The input TEI does not have a <TEI> element as its root element.");
		}
		vector<string> dropped_types = vecFromJSArray<string>(dropped);
		set<string> dropped_reading_types(dropped_types.begin(), dropped_types.end());
		app = apparatus(tei_node, merge_splits, set<string>(), dropped_reading_types, list<string>());
		if (threshold > 0) {
			list<string> list_wit = app.get_list_wit();
			list_wit.remove_if([&](const string & wit_id) {
				return app.get_extant_passages_for_witness(wit_id) < threshold;
			});
			app.set_list_wit(list_wit);
		}
		classic = classic_rules;
		prepared = true;
		val witnesses = val::array();
		for (const string & wit_id : app.get_list_wit()) {
			witnesses.call<void>("push", wit_id);
		}
		val units = val::array();
		for (const variation_unit & vu : app.get_variation_units()) {
			units.call<void>("push", vu.get_id());
		}
		val result = val::object();
		result.set("witnesses", witnesses);
		result.set("units", units);
		return result;
	});
}

val compute_witness(const string & siglum) {
	return guarded([&] {
		require_prepared();
		list<string> list_wit = app.get_list_wit();
		if (find(list_wit.begin(), list_wit.end(), siglum) == list_wit.end()) {
			throw runtime_error("Witness " + siglum + " is not among the prepared witnesses.");
		}
		witness wit(siglum, app, classic);
		string out;
		for (const string & secondary_wit_id : list_wit) {
			genealogical_comparison comp = wit.get_genealogical_comparison_for_witness(secondary_wit_id);
			put_bytes(out, secondary_wit_id);
			put_bitmap(out, comp.extant);
			put_bitmap(out, comp.agreements);
			put_bitmap(out, comp.prior);
			put_bitmap(out, comp.posterior);
			put_bitmap(out, comp.norel);
			put_bitmap(out, comp.unclear);
			put_bitmap(out, comp.explained);
			uint32_t cost_bits;
			memcpy(&cost_bits, &comp.cost, sizeof cost_bits);
			put_u32(out, cost_bits);
		}
		return to_uint8_array(out);
	});
}

val assemble(const val & rows_by_siglum) {
	return guarded([&] {
		require_prepared();
		remove(ASSEMBLE_PATH);
		try {
			database out(ASSEMBLE_PATH, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
			populate_readings_table(out.db);
			populate_reading_relations_table(out.db);
			populate_reading_support_table(out.db);
			populate_variation_units_table(out.db);
			populate_genealogical_comparisons_table(out.db, rows_by_siglum);
			populate_witnesses_table(out.db);
		} catch (...) {
			remove(ASSEMBLE_PATH);
			throw;
		}
		string bytes = read_file(ASSEMBLE_PATH);
		remove(ASSEMBLE_PATH);
		return to_uint8_array(bytes);
	});
}

val open_cache(const val & cache, const val & excluded, float proportion_extant) {
	return guarded([&] {
		close_cache();
		filter_excluded_wit_ids.clear();
		if (proportion_extant < 0.0 || proportion_extant > 1.0) {
			throw runtime_error("The proportion of extant variation units " + to_string(proportion_extant) + " is not between 0 and 1.");
		}
		write_file(CACHE_PATH, from_uint8_array(cache));
		if (sqlite3_open_v2(CACHE_PATH, &cache_db, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
			string message = sqlite3_errmsg(cache_db);
			close_cache();
			throw runtime_error("Error opening database: " + message);
		}
		try {
			set<string> excluded_wit_ids;
			for (const string & wit_id : vecFromJSArray<string>(excluded)) {
				excluded_wit_ids.insert(wit_id);
			}
			if (proportion_extant > 0.0) {
				int min_extant = (int) ceil(proportion_extant * count_variation_units(cache_db));
				add_fragmentary_witnesses_to_excluded_set(cache_db, min_extant, excluded_wit_ids);
			}
			filter_excluded_wit_ids = excluded_wit_ids;
		} catch (...) {
			close_cache();
			throw;
		}
		return val::undefined();
	});
}

val compare_witnesses(const string & primary_wit_id, const val & secondary) {
	return guarded([&] {
		require_open();
		vector<string> secondary_wits = vecFromJSArray<string>(secondary);
		set<string> secondary_wit_ids(secondary_wits.begin(), secondary_wits.end());
		set<string> excluded_wit_ids = secondary_wit_ids.empty() ? filter_excluded_wit_ids : set<string>();
		list<string> list_wit = get_list_wit(cache_db, excluded_wit_ids);
		if (!witness_exists(cache_db, primary_wit_id)) {
			throw runtime_error("There are no rows in the GENEALOGICAL_COMPARISONS table for witness " + primary_wit_id + ".");
		}
		witness wit = get_witness(cache_db, primary_wit_id, excluded_wit_ids);
		for (const string & secondary_wit_id : secondary_wit_ids) {
			if (secondary_wit_id == primary_wit_id) {
				throw runtime_error("The primary witness ID should not be included in the list of secondary witnesses.");
			}
			if (!witness_exists(cache_db, secondary_wit_id)) {
				throw runtime_error("There are no rows in the GENEALOGICAL_COMPARISONS table for witness " + secondary_wit_id + ".");
			}
		}
		compare_witnesses_table table(wit, list_wit, secondary_wit_ids);
		stringstream out;
		table.to_json(out);
		return val(out.str());
	});
}

}

EMSCRIPTEN_BINDINGS(open_cbgm) {
	emscripten::function("prepare", &prepare);
	emscripten::function("computeWitness", &compute_witness);
	emscripten::function("assemble", &assemble);
	emscripten::function("open", &open_cache);
	emscripten::function("compareWitnesses", &compare_witnesses);
}
