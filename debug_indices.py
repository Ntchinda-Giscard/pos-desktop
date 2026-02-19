import sqlite3
db_path = r"E:\DB\local_data.db"
try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT SDHNUM_0, SHIDAT_0, DLVDAT_0, BPDNAM_0, SOHNUM_0, STOFCY_0, SDHTYP_0, INVFLG_0 FROM SDELIVERY LIMIT 5")
    rows = cursor.fetchall()
    print("Query results:")
    for row in rows:
        print(row)
    conn.close()
except Exception as e:
    print(f"Error: {e}")
