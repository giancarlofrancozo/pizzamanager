// Leitor do dump MySQL do EiChefe (INSERT INTO `tabela` VALUES (...),(...);)
const fs = require('fs');
const readline = require('readline');

// Converte a parte "(...),(...)" em arrays de valores
function parseTuples(s) {
  const rows = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && s[i] !== '(') i++;
    if (i >= n) break;
    i++; // (
    const row = [];
    while (i < n) {
      while (s[i] === ' ') i++;
      let v;
      if (s[i] === "'") {
        i++;
        let out = '';
        while (i < n) {
          const c = s[i];
          if (c === '\\') {
            const d = s[i + 1];
            out += d === 'n' ? '\n' : d === 'r' ? '\r' : d === 't' ? '\t' : d === '0' ? '\0' : d;
            i += 2;
          } else if (c === "'") {
            if (s[i + 1] === "'") { out += "'"; i += 2; } else { i++; break; }
          } else { out += c; i++; }
        }
        v = out;
      } else {
        let j = i;
        while (j < n && s[j] !== ',' && s[j] !== ')') j++;
        const tok = s.slice(i, j).trim();
        v = tok === 'NULL' ? null : (tok !== '' && !isNaN(tok) ? Number(tok) : tok);
        i = j;
      }
      row.push(v);
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ')') { i++; break; }
    }
    rows.push(row);
    if (s[i] === ',') i++;
    else if (s[i] === ';') break;
  }
  return rows;
}

// Colunas de cada tabela, na ordem do CREATE TABLE
async function readDump(file, wanted) {
  const cols = {};
  const data = {};
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let cur = null;
  for await (const line of rl) {
    let m = line.match(/^CREATE TABLE `([^`]+)`/);
    if (m) { cur = wanted.includes(m[1]) ? m[1] : null; if (cur) cols[cur] = []; continue; }
    if (cur) {
      m = line.match(/^\s+`([^`]+)`\s/);
      if (m) cols[cur].push(m[1]);
      if (line.startsWith(')')) cur = null;
      continue;
    }
    m = line.match(/^INSERT INTO `([^`]+)` VALUES /);
    if (m && wanted.includes(m[1])) {
      const rows = parseTuples(line.slice(m[0].length));
      (data[m[1]] ||= []).push(...rows);
    }
  }
  const out = {};
  for (const t of wanted) {
    out[t] = (data[t] || []).map(r => Object.fromEntries((cols[t] || []).map((c, i) => [c, r[i]])));
  }
  return out;
}

module.exports = { readDump, parseTuples };

