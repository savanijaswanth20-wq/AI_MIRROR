// Official Ruff WebAssembly API, used when native executables are unavailable.
const fs = require('node:fs');
const path = require('node:path');
const { Workspace, PositionEncoding } = require('@astral-sh/ruff-wasm-nodejs');
const root = path.resolve(__dirname, '..');
const workspace = new Workspace({ 'line-length': 110, 'target-version': 'py312', lint: { select: ['E', 'F', 'I', 'UP', 'B'], isort: { 'known-first-party': ['app'] } } }, PositionEncoding.Utf16);
function files(dir) {
 return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (['.venv', '.tmp', 'node_modules', 'test-output', 'test-output-verified', '__pycache__', '.pytest_cache'].includes(entry.name)) return [];
  const filename = path.join(dir, entry.name);
  return entry.isDirectory() ? files(filename) : filename.endsWith('.py') ? [filename] : [];
 });
}
let failures = 0;
for (const filename of [...files(path.join(root, 'app')), ...files(path.join(root, 'tests')), path.join(root, 'seed_catalog.py')]) {
 let source = fs.readFileSync(filename, 'utf8');
 if (process.argv.includes('--fix')) {
  const lines = source.split('\n');
  const offset = location => lines.slice(0, location.row - 1).reduce((total, line) => total + line.length + 1, 0) + location.column - 1;
  const edits = workspace.check(source).flatMap(diagnostic => diagnostic.fix ? diagnostic.fix.edits : []).map(edit => ({start: offset(edit.location), end: offset(edit.end_location), content: edit.content || ''})).sort((a, b) => b.start - a.start);
  for (const edit of edits) source = source.slice(0, edit.start) + edit.content + source.slice(edit.end);
  fs.writeFileSync(filename, source);
 }
 if (process.argv.includes('--format')) { source = workspace.format(source); fs.writeFileSync(filename, source); }
 const diagnostics = workspace.check(source);
 for (const diagnostic of diagnostics) {
  failures++;
  console.log(`${path.relative(root, filename)}:${diagnostic.start_location.row}:${diagnostic.start_location.column} ${diagnostic.code} ${diagnostic.message}`);
 }
}
console.log(`Ruff WASM ${Workspace.version()}: ${failures} diagnostics`);
process.exitCode = failures ? 1 : 0;
