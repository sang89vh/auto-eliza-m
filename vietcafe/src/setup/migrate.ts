/** Standalone migration: `npm run migrate`. The server also runs this on startup. */
import { config } from '../lib/config.js';
import { closeDb, migrate, statusCounts } from '../lib/db.js';

console.log(`Migrating ${config.dbPath}`);
migrate();
console.log('Schema is up to date.');
console.log('cafe_status counts:', statusCounts());
closeDb();
