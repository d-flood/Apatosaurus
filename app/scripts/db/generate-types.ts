import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDatabaseTypes } from './render-types';

writeFileSync(join(process.cwd(), 'src/lib/db/types.generated.ts'), renderDatabaseTypes());
