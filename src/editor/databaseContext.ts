import { keyword, symbol, type Token } from "./tokens";

export function batchEnd(text: string, t: Token) {
    if (keyword(t) !== "GO") return false;
    const end = text.indexOf("\n", t.end);
    return /^\s*go\s*$/i.test(text.slice(text.lastIndexOf("\n", t.start - 1) + 1, end < 0 ? text.length : end));
}

export function matchesDatabase(text: string, all: Token[], cursor: number, database?: string) {
    if (text.slice(0, cursor).includes("$(")) return false;
    let current = database;
    let conditional = false;
    let uncertain = false;
    for (let i = 0; i < all.length && all[i].start < cursor; i++) {
        const t = all[i];
        if (symbol(t, "$") || symbol(t, ":") || symbol(t, "!")) return false;
        if (batchEnd(text, t)) { conditional = false; continue; }
        const word = keyword(t);
        if (["IF", "ELSE", "WHILE", "GOTO", "TRY", "CATCH", "RETURN", "THROW", "RAISERROR"].includes(word)) conditional = true;
        if (word !== "USE") continue;
        const name = all[i + 1];
        if (!name || name.kind === "other" || name.end > cursor || symbol(all[i + 2], ".")) return false;
        uncertain = conditional;
        current = name.text;
    }
    return !uncertain && current === database;
}