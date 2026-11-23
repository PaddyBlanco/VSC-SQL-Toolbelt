import { fromSources, sourceAt, type SqlSource } from "./sources";
import { keyword, symbol, tokens } from "./tokens";

export interface Candidate {
    kind: "select" | "insert"; start: number; end: number; sources: SqlSource[]; qualify: boolean; only?: string;
}

export function candidate(text: string, cursor: number, database?: string): Candidate | undefined {
    if (text.length > 131072) return;
    const all = tokens(text);
    // An earlier USE must name the bound database. Never look up columns in a guessed database.
    if (all.some((t, i) => t.start < cursor && (symbol(t, "$") || symbol(t, ":") ||
        (keyword(t) === "USE" && (all[i + 1]?.kind === "other" || !database || all[i + 1]?.text !== database))))) return;
    function boundary(t: typeof all[number]) {
        if (symbol(t, ";")) return true;
        if (keyword(t) !== "GO") return false;
        const nextLine = text.indexOf("\n", t.end);
        const line = text.slice(text.lastIndexOf("\n", t.start - 1) + 1, nextLine < 0 ? text.length : nextLine);
        return /^\s*go\s*$/i.test(line);
    }
    let start = 0;
    let end = all.length;
    for (let i = 0; i < all.length; i++) {
        if (!boundary(all[i])) continue;
        if (all[i].end <= cursor) start = i + 1;
        else { end = i; break; }
    }
    const ts = all.slice(start, end);
    // T-SQL allows a preceding statement without a semicolon. Anchor INSERT at the cursor's target.
    let insert = ts.length - 1;
    while (insert >= 0 && (ts[insert].end > cursor || keyword(ts[insert]) !== "INSERT")) insert--;
    if (insert >= 0 && keyword(ts[insert + 1]) === "INTO" &&
        (insert === 0 || /[\r\n]/.test(text.slice(ts[insert - 1].end, ts[insert].start)))) {
        const item = sourceAt(ts, insert + 2, false);
        const targetEnd = item && ts[item.index - 1].end;
        if (item && targetEnd !== undefined && targetEnd <= cursor && /^[ \t]*$/.test(text.slice(targetEnd, cursor))
            && item.index === ts.length) {
            const semi = all[end];
            const replaceEnd = symbol(semi, ";") && /^[ \t]*$/.test(text.slice(cursor, semi.start)) ? semi.end : cursor;
            return { kind: "insert", start: targetEnd, end: replaceEnd, sources: [item.source], qualify: false };
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
    return { kind: "select", start: ts[head].start, end: ts[star].end, sources, qualify: qualified || sources.length > 1,
        only: qualified ? ts[head].text : undefined };
}
