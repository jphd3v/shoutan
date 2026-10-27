#!/usr/bin/env node
// Prints the install-or-upgrade SQL for the hosted schema: `node scripts/schema-sql.mjs go`.
// `npm run infra` applies the same SQL itself; see scripts/lib/schema.mjs.
import { schemaSql } from './lib/schema.mjs';

console.log(schemaSql(process.argv[2]));
