import { batchEnd, databaseContext } from "./databaseContext";
import { sourceAt } from "./sources";
import { keyword, symbol, tokens } from "./tokens";

export function hoverTarget(text: string, offset: number) {
    if (text.length > 131072) return;
    const all = tokens(text);
    const hit = all.findIndex(t => t.start <= offset && offset < t.end);
    if (hit < 0 || all[hit].kind === "other") return;
    const context = databaseContext(text, all, offset);
    if (!context) return;
    const start = symbol(all[hit - 1], ".") ? hit - 2 : hit;
    if (start < 0 || symbol(all[start - 1], ".") || symbol(all[start - 1], "@") || symbol(all[start - 1], "#")) return;
    const target = sourceAt(all, start, false);
    if (!target || symbol(all[target.index], ".") || hit >= target.index || /^[#@]/.test(target.source.name)) return;
    const word = keyword(all[start - 1]);
    const call = target.source.schema && symbol(all[target.index], "(");
    if (!call && !["FROM", "JOIN", "UPDATE", "INTO", "EXEC", "EXECUTE"].includes(word)) return;
    if (!target.source.schema) {
        // A CTE or UPDATE alias can shadow a catalog object with the same name.
        let first = start;
        while (first && !symbol(all[first - 1], ";") && !batchEnd(text, all[first - 1])) first--;
        if (word === "UPDATE" || all.slice(first, start).some(t => keyword(t) === "WITH")) return;
    }
    return { database: context.database, source: target.source, start: all[start].start, end: all[target.index - 1].end };
}
