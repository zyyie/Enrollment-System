"""
Geranova EMS — Admin Portal Server
Run: python main.py
Port: 8001 (default)
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

# Open admin login after server starts
os.environ.setdefault("EMS_OPEN_URL", "/login.html")

if __name__ == "__main__":
    from server import main

    main()
