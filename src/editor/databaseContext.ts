import { keyword, symbol, type Token } from "./tokens";

export function batchEnd(text: string, t: Token) {
    if (keyword(t) !== "GO") return false;
    const end = text.indexOf("\n", t.end);
    return /^\s*go\s*(?:--[^\n]*)?$/i.test(text.slice(text.lastIndexOf("\n", t.start - 1) + 1, end < 0 ? text.length : end));
}

const statementStarts = new Set("USE SELECT INSERT EXEC EXECUTE UPDATE DELETE DECLARE SET PRINT WITH BEGIN IF WHILE ALTER CREATE DROP MERGE RETURN".split(" "));

export function databaseContext(text: string, all: Token[], cursor: number) {
    if (text.slice(0, cursor).includes("$(")) return;
    let database: string | undefined;
    let afterUse = 0;
    let conditional = false;
    let uncertain = false;
    for (let i = 0; i < all.length && all[i].start < cursor; i++) {
        const t = all[i];
        if ((symbol(t, ":") || (symbol(t, "!") && symbol(all[i + 1], "!"))) &&
            /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", t.start - 1) + 1, t.start))) return;
        if (batchEnd(text, t)) { conditional = false; continue; }
        const word = keyword(t);
        if (["IF", "ELSE", "WHILE", "GOTO", "TRY", "CATCH", "RETURN", "THROW", "RAISERROR"].includes(word)) conditional = true;
        if (word !== "USE" || (all[i - 1]?.end === t.start && symbol(all[i - 1], "@"))) continue;
        const name = all[i + 1];
        if (!name || name.kind === "other" || !name.text.length || name.text.length > 128 || name.end > cursor) return;
        const next = all[i + 2];
        if (next && !symbol(next, ";") && !batchEnd(text, next) && !statementStarts.has(keyword(next))) return;
        uncertain = conditional;
        database = name.text;
        afterUse = i + 2;
        i++;
    }
    if (!uncertain) return { database, afterUse };
}
