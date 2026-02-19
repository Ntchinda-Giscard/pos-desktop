import sys
import os
# Add the current directory to sys.path
sys.path.append(os.getcwd())
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from fastapi.testclient import TestClient
from api import app

client = TestClient(app)

try:
    response = client.get("/livraison/all")
    print(f"Status code: {response.status_code}")
    data = response.json()
    if data:
        print("First item in results:")
        print(data[0])
except Exception as e:
    print(f"Error: {e}")
