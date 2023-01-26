from pathlib import Path 
from shutil import rmtree

def main():
    db_path = Path('/django/db')
    if db_path.exists():
        for f in db_path.iterdir():
            if f.is_file():
                f.unlink()
            elif f.is_dir():
                rmtree(f)
        print('Database cleared!')
    else:
        print('db/ not found')

if __name__ == '__main__':
    main()