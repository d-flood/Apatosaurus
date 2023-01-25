from pathlib import Path 
from shutil import rmtree

def main():
    db_path = Path('db/')
    if db_path.exists():
        rmtree(db_path)
        print('Database cleared!')