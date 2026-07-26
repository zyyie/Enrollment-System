"""
Geranova EMS — Student Portal Server
Run: python main.py
Port: 8000 (default)
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

os.environ.setdefault("EMS_OPEN_URL", "/login.html")

if __name__ == "__main__":
    from server import main

    main()
