// Prints a summary of each file in a patch. Usage: node packages/shared/scripts/parse-patch.ts <file>
import { readFileSync } from 'node:fs';
import { DiffParseError, parsePatch } from '../src/diff/parse-patch.ts';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node packages/shared/scripts/parse-patch.ts <file.patch>');
  process.exit(2);
}

try {
  const { files } = parsePatch(readFileSync(path, 'utf8'));
  for (const file of files) {
    const name =
      file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath
        ? `${file.oldPath} → ${file.newPath}`
        : (file.newPath ?? file.oldPath);
    const counts = file.isBinary ? 'binary' : `+${file.additions} -${file.deletions}`;
    const hunks = `${file.hunks.length} hunk${file.hunks.length === 1 ? '' : 's'}`;
    console.log(`${name}  ${file.changeType}  ${counts}  ${hunks}`);
  }
} catch (error) {
  if (!(error instanceof DiffParseError)) throw error;
  console.error(`${error.code}: ${error.message}`);
  process.exit(1);
}
