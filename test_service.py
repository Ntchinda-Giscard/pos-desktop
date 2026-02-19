import sys
import os
# Add the current directory to sys.path
sys.path.append(os.getcwd())
sys.path.append(os.path.join(os.getcwd(), 'backend'))

import sqlite3
from database.sync_data import get_db_file
from sqlalchemy.orm import Session
from src.livraison.service import get_livraison
from src.livraison.model import LivraisonHeader

# Mock a session if needed, but get_db_file just needs an object
class MockSession:
    pass

try:
    results = get_livraison(MockSession())
    print("Serialization test:")
    for item in results[:3]:
        print(item.model_dump())
except Exception as e:
    print(f"Error: {e}")
