import { identifier } from "../mssql/columns";
import type { Parameter } from "../mssql/parameters";
import type { ExecCandidate } from "./candidate";

export function execReplacement(text: string, match: ExecCandidate, parameters: Parameter[], indent: string, eol: string) {
    const base = /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", match.start - 1) + 1, match.start))![0];
    const used = new Set((text.match(/@[\p{L}\p{N}\p{M}_@$#]+/gu) ?? []).map(name => name.toUpperCase()));
    const declarations: string[] = [];
    const args: string[] = [];
    const outputs: string[] = [];
    for (const { name, declarationType, output } of parameters) {
        let variable = name;
        for (let i = 2; used.has(variable.toUpperCase()); i++) {
            const suffix = "_" + i;
            variable = name.slice(0, 128 - suffix.length) + suffix;
        }
        used.add(variable.toUpperCase());
        declarations.push(`DECLARE ${variable} ${declarationType};`);
        args.push(indent + name + " = " + variable + (output ? " OUTPUT" : ""));
        if (output) outputs.push(variable + " AS " + identifier(name.slice(1)));
    }
    const header = text.slice(match.start, match.targetEnd);
    const newline = eol + base;
    const sections = [declarations.join(newline), header + newline + args.join("," + newline) + ";"];
    if (outputs.length) sections.push("SELECT " + outputs.join("," + newline + indent) + ";");
    return { start: match.start, end: match.end, value: sections.join(eol + newline) };
}
