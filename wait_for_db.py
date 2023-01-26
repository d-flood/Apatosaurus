from pathlib import Path
import time

def main():
    db_path = Path('db/apatosaurus.db')
    while not db_path.exists():
        print('Waiting for database...')
        time.sleep(2)
    print('Database found!')

if __name__ == '__main__':
    main()
