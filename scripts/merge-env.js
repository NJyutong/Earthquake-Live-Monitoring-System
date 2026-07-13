const fs = require('fs');
const path = require('path');

if (require.main === module) {
  const [, , currentPath, incomingPath, outputPath] = process.argv;
  if (!currentPath || !incomingPath || !outputPath) {
    console.error('Usage: node scripts/merge-env.js <current.env> <incoming.env> <output.env>');
    process.exit(1);
  }

  const current = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, 'utf8') : '';
  const incoming = fs.readFileSync(incomingPath, 'utf8');
  const merged = mergeEnv(current, incoming);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, merged, { encoding: 'utf8', mode: 0o600 });
}

function mergeEnv(currentText, incomingText) {
  const lineEnding = currentText.includes('\r\n') ? '\r\n' : '\n';
  const lines = currentText ? currentText.replace(/\r\n/g, '\n').split('\n') : [];
  if (lines.at(-1) === '') lines.pop();

  const currentAssignments = assignmentIndexes(lines, false);
  const incomingLines = incomingText.replace(/\r\n/g, '\n').split('\n');
  const incomingAssignments = assignmentIndexes(incomingLines, true);
  const additions = [];
  let changed = false;

  for (const [key, incomingAssignment] of incomingAssignments) {
    const currentAssignment = currentAssignments.get(key);
    if (!currentAssignment) {
      additions.push(`${key}=${incomingAssignment.rawValue}`);
      changed = true;
      continue;
    }
    if (currentAssignment.value !== incomingAssignment.value) {
      lines[currentAssignment.index] = `${key}=${incomingAssignment.rawValue}`;
      changed = true;
    }
  }

  if (!changed) return currentText;

  if (additions.length) {
    if (lines.length && lines.at(-1).trim()) lines.push('');
    lines.push(...additions);
  }

  return `${lines.join(lineEnding).replace(/(?:\r?\n)*$/, '')}${lineEnding}`;
}

function assignmentIndexes(lines, rejectDuplicates) {
  const assignments = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (rejectDuplicates && assignments.has(key)) {
      throw new Error(`Duplicate environment variable in packaged .env: ${key}`);
    }
    if (!assignments.has(key)) {
      assignments.set(key, { index, rawValue, value: unquote(rawValue) });
    }
  }
  return assignments;
}

function unquote(value) {
  const source = String(value || '').trim();
  if (source.length >= 2 && ((source[0] === '"' && source.at(-1) === '"') || (source[0] === "'" && source.at(-1) === "'"))) {
    return source.slice(1, -1);
  }
  return source;
}

module.exports = { mergeEnv };
