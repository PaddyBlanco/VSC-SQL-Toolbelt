import { identifier, type Relation } from "../mssql/columns";
import { ToolkitError } from "../mssql/connection";
import { dml } from "../objektskripte/dml";
import type { RelationCandidate } from "./candidate";

export function replacement(text: string, match: RelationCandidate, relations: Relation[], indent: string, eol: string) {
    const line = text.slice(text.lastIndexOf("\n", match.start - 1) + 1, match.start);
    const base = line.match(/^\s*/)?.[0] ?? "";
    if (match.kind === "insert") {
        const statement = dml(relations[0], "insert", indent, eol);
        const prefix = "INSERT INTO " + identifier(relations[0].schema) + "." + identifier(relations[0].name);
        return { start: match.start, end: match.end, value: statement.slice(prefix.length).split(eol).join(eol + base) };
    }
    const names = relations.flatMap((r, i) => {
        const alias = match.sources[i].alias ?? match.sources[i].name;
        if (match.only !== undefined && alias !== match.only) return [];
        const prefix = match.qualify ? identifier(alias) + "." : "";
        return r.columns.filter(c => !c.hidden).map(c => prefix + identifier(c.name));
    });
    if (!names.length) throw new ToolkitError("Keine sichtbaren Spalten gefunden.");
    const trailing = /\bSELECT(?:\s+(?:DISTINCT|ALL))?([ \t]*)$/i.exec(line);
    const padding = trailing ? base + indent : base;
    const value = (trailing ? eol + padding : "") + names.join("," + eol + padding);
    return { start: match.start - (trailing?.[1].length ?? 0), end: match.end, value };
}
