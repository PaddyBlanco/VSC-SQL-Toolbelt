import { type Source } from "../mssql/columns";
import { keyword, symbol, type Token } from "./tokens";

export interface SqlSource extends Source { alias?: string }
const stop = new Set("AS ON JOIN INNER LEFT RIGHT FULL CROSS OUTER WHERE GROUP HAVING ORDER UNION EXCEPT INTERSECT OFFSET FETCH OPTION WITH APPLY PIVOT UNPIVOT FOR SELECT INSERT DELETE UPDATE MERGE INTO".split(" "));
function name(t?: Token) { return t?.kind === "name" || (t?.kind === "word" && !stop.has(keyword(t))); }

export function sourceAt(ts: Token[], index: number, aliases: boolean) {
    if (!name(ts[index])) return;
    let object = ts[index++].text;
    let schema: string | undefined;
    if (symbol(ts[index], ".")) {
        if (!name(ts[index + 1])) return;
        schema = object;
        object = ts[index + 1].text;
        index += 2;
    }
    let alias: string | undefined;
    if (aliases) {
        if (keyword(ts[index]) === "AS") {
            index++;
            if (!name(ts[index])) return;
        }
        if (name(ts[index])) alias = ts[index++].text;
    }
    return { source: { name: object, schema, alias }, index };
}

export function fromSources(ts: Token[]): SqlSource[] | undefined {
    const sources: SqlSource[] = [];
    let index = 0;
    while (index < ts.length) {
        const item = sourceAt(ts, index, true);
        if (!item) return;
        sources.push(item.source);
        index = item.index;
        if (keyword(ts[index]) === "ON") {
            index++;
            const start = index;
            while (index < ts.length && !stop.has(keyword(ts[index])) && !symbol(ts[index], ",")) index++;
            if (index === start) return;
        }
        if (index === ts.length || ["WHERE", "GROUP", "ORDER", "HAVING"].includes(keyword(ts[index]))) return sources;
        if (symbol(ts[index], ",")) { index++; continue; }
        if (["INNER", "LEFT", "RIGHT", "FULL", "CROSS"].includes(keyword(ts[index]))) index++;
        if (keyword(ts[index]) === "OUTER") index++;
        if (keyword(ts[index++]) !== "JOIN") return;
    }
}
