import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from app.__main__ import main  # pyright: ignore[reportMissingImports]

if __name__ == "__main__":
    main()
