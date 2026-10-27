#!/usr/bin/env node
// Prints the notes for a release about to be made from HEAD: `node scripts/release-notes.mjs dev|prod "<first line>"`.
// The release workflows pass the result to `gh release create --notes-file`.
import { releaseNotes, TAG } from './lib/releases.mjs';

const [channel, intro] = process.argv.slice(2);
if (!TAG[channel] || !intro) throw new Error('Usage: release-notes.mjs dev|prod "<first line>"');
console.log(`${intro}\n\n${releaseNotes(channel)}`);
