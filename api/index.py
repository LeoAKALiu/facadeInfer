import os
import sys

# Add root dir to path (since this file is in api/)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.main import app
