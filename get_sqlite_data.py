import sqlite3

def get_all_witness_siglums(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = lambda cursor, row: row[0]
    c = conn.cursor()
    c.execute("SELECT WITNESS FROM WITNESSES")
    witnesses = c.fetchall()
    conn.close()
    return witnesses
