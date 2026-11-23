import { batchEnd, databaseContext } from "./databaseContext";
import { fromSources, sourceAt, type SqlSource } from "./sources";
import { keyword, symbol, tokens, type Token } from "./tokens";

export interface RelationCandidate {
    kind: "select" | "insert"; start: number; end: number; sources: SqlSource[]; qualify: boolean; only?: string;
}

export interface ExecCandidate {
    kind: "exec"; start: number; end: number; targetEnd: number; source: SqlSource;
}

type Candidate = (RelationCandidate | ExecCandidate) & { database?: string };

const statementStarts = new Set(["SELECT", "DECLARE", "SET", "USE", "PRINT", "EXEC", "EXECUTE", "INSERT", "UPDATE", "DELETE", "END"]);

function standaloneExec(before: Token[]) {
    if (!before.length || keyword(before.at(-1)) === "BEGIN") return true;
    // DECLARE before an INSERT ... EXEC or a single-statement IF/WHILE would change its meaning.
    return statementStarts.has(keyword(before[0])) &&
        !before.some(t => ["INSERT", "IF", "ELSE", "WHILE", "UNION"].includes(keyword(t)));
}

export function candidate(text: string, cursor: number): Candidate | undefined {
    if (text.length > 131072) return;
    const all = tokens(text);
    const context = databaseContext(text, all, cursor);
    if (!context) return;
    const { database } = context;
    let start = context.afterUse;
    let end = all.length;
    for (let i = start; i < all.length; i++) {
        if (all[i].start > cursor && keyword(all[i]) === "USE") { end = i; break; }
        if (!symbol(all[i], ";") && !batchEnd(text, all[i])) continue;
        if (all[i].end <= cursor) start = i + 1;
        else { end = i; break; }
    }
    const ts = all.slice(start, end);
    // Anchor bare INSERT/EXEC targets at the cursor, including after an unterminated statement.
    let command = ts.length - 1;
    while (command >= 0 && (ts[command].end > cursor || !["INSERT", "EXEC", "EXECUTE"].includes(keyword(ts[command])))) command--;
    if (command >= 0 && (command === 0 || /[\r\n]/.test(text.slice(ts[command - 1].end, ts[command].start)))) {
        const insert = keyword(ts[command]) === "INSERT";
        const item = sourceAt(ts, command + (insert ? 2 : 1), false);
        const targetEnd = item && ts[item.index - 1].end;
        if (item && targetEnd !== undefined && targetEnd <= cursor && /^[ \t]*$/.test(text.slice(targetEnd, cursor))) {
            const semi = all[end];
            const replaceEnd = symbol(semi, ";") && /^[ \t]*$/.test(text.slice(cursor, semi.start)) ? semi.end : cursor;
            if (insert && keyword(ts[command + 1]) === "INTO" && item.index === ts.length) {
                return { kind: "insert", database, start: targetEnd, end: replaceEnd, sources: [item.source], qualify: false };
            }
            if (!insert && keyword(ts[command + 1]) !== "AS" && standaloneExec(ts.slice(0, command))) {
                const next = ts[item.index];
                const numbered = symbol(semi, ";") && !next && /^\d/.test(all[end + 1]?.text ?? "");
                if (!numbered && (!next || (/[\r\n]/.test(text.slice(cursor, next.start)) && statementStarts.has(keyword(next))))) {
                    return { kind: "exec", database, start: ts[command].start, end: replaceEnd, targetEnd, source: item.source };
                }
            }
        }
    }
    if (keyword(ts[0]) !== "SELECT" || ts.slice(1).some(t => ["SELECT","WITH","INTO","INSERT","UPDATE","DELETE","MERGE","UNION","EXCEPT","INTERSECT"].includes(keyword(t)))) return;
    const star = ts.findIndex(t => symbol(t, "*") && (t.end === cursor || t.start === cursor));
    const from = ts.findIndex(t => keyword(t) === "FROM");
    if (star < 1 || from <= star || (star + 1 !== from && !symbol(ts[star + 1], ","))) return;
    const qualified = symbol(ts[star - 1], ".");
    const head = qualified ? star - 2 : star;
    if (head < 1 || (head !== 1 && !symbol(ts[head - 1], ",") && !(head === 2 && ["ALL","DISTINCT"].includes(keyword(ts[1]))))) return;
    if (qualified && ts[head].kind === "other") return;
    const sources = fromSources(ts.slice(from + 1));
    if (!sources?.length) return;
    const names = sources.map(s => s.alias ?? s.name);
    if (new Set(names).size !== names.length) return;
    const matches = qualified ? sources.filter((_, i) => names[i] === ts[head].text) : sources;
    if (!matches.length) return;
    return { kind: "select", database, start: ts[head].start, end: ts[star].end, sources, qualify: qualified || sources.length > 1,
        only: qualified ? ts[head].text : undefined };
}
