import sqlite3


def get_all_witness_siglums(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = lambda cursor, row: row[0]
    c = conn.cursor()
    c.execute("SELECT WITNESS FROM WITNESSES")
    witnesses = c.fetchall()
    conn.close()
    return witnesses


def get_all_apps(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = lambda cursor, row: row[0]
    c = conn.cursor()
    c.execute("SELECT VARIATION_UNIT FROM VARIATION_UNITS")
    apps = c.fetchall()
    conn.close()
    return apps


def get_all_witnesses_and_apps(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = lambda cursor, row: row[0]
    c = conn.cursor()
    c.execute("SELECT WITNESS FROM WITNESSES")
    witnesses = c.fetchall()
    c.execute("SELECT VARIATION_UNIT FROM VARIATION_UNITS")
    apps = c.fetchall()
    conn.close()
    return witnesses, apps


def get_readings_for_variation_unit(db_path: str, variation_unit: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = lambda cursor, row: row[0]
    c = conn.cursor()
    c.execute("SELECT READING FROM READINGS WHERE VARIATION_UNIT=?", (variation_unit,))
    readings = c.fetchall()
    conn.close()
    return readings
