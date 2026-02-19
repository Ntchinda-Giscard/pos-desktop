import sqlite3
import os

db_path = r"C:\poswaza\temp\db\pos_local.db"

if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
else:
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(pop_config)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'address_vente' not in columns:
            print("Adding column address_vente...")
            cursor.execute("ALTER TABLE pop_config ADD COLUMN address_vente TEXT")
        else:
            print("Column address_vente already exists.")
            
        if 'site_livraison' not in columns:
            print("Adding column site_livraison...")
            cursor.execute("ALTER TABLE pop_config ADD COLUMN site_livraison TEXT")
        else:
            print("Column site_livraison already exists.")
            
        conn.commit()
        conn.close()
        print("Migration completed successfully.")
    except Exception as e:
        print(f"Migration failed: {e}")
