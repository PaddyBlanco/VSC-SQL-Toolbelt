import { identifier, type Relation } from "../mssql/columns";
import { ToolkitError } from "../mssql/connection";
import { columnType, keyType, valueFor } from "./values";

export type Dml = "select" | "insert" | "update" | "delete";

export function dml(relation: Relation, operation: Dml, indent = "    ", eol = "\n") {
    if (!relation.table) throw new ToolkitError("Eine Tabelle auswählen.");
    const table = identifier(relation.schema) + "." + identifier(relation.name);
    if (operation === "select") {
        const names = relation.columns.filter(c => !c.hidden).map(c => identifier(c.name));
        if (!names.length) throw new ToolkitError("Keine sichtbaren Spalten gefunden.");
        return ["SELECT", indent + names.join("," + eol + indent), "FROM " + table + ";"].join(eol);
    }
    const writable = relation.columns.filter(c => c.writable);
    if (operation === "insert") {
        const columns = writable.filter(c => !c.hasDefault);
        if (!columns.length) return `INSERT INTO ${table} DEFAULT VALUES;`;
        const names = columns.map(c => indent + identifier(c.name)).join("," + eol);
        const values = columns.map((c, i) => {
            const comma = i < columns.length - 1 ? "," : "";
            const comment = `${identifier(c.name)} ${identifier(columnType(c))}`.replace(/[\r\n\u0085\u2028\u2029]+/g, " ");
            return `${indent}${valueFor(c)}${comma} -- ${comment} -- ${c.nullable ? "NULL" : "NOT NULL"}`;
        });
        return [`INSERT INTO ${table}`, "(", names, ")", "VALUES", "(", ...values, ");"].join(eol);
    }
    const keys = relation.columns.filter(c => c.key > 0).sort((a, b) => a.key - b.key);
    if (operation === "delete" && !keys.length) return `DELETE FROM ${table}${eol}WHERE 1 = 0; -- Filter vor Ausführung anpassen.`;
    if (!keys.length || keys.some((c, i) => c.key !== i + 1)) throw new ToolkitError(operation.toUpperCase() + " erfordert einen vollständigen Primärschlüssel.");
    const declarations = keys.map(c => `DECLARE @pk${c.key} ${keyType(c)} = NULL;`);
    const where = "WHERE " + keys.map(c => identifier(c.name) + " = @pk" + c.key).join(eol + "  AND ") + ";";
    if (operation === "delete") return [...declarations, "", "DELETE FROM " + table, where].join(eol);
    const changes = writable.filter(c => !c.key);
    if (!changes.length) throw new ToolkitError("Die Tabelle enthält keine beschreibbare Nichtschlüsselspalte.");
    return [...declarations, "", "UPDATE " + table, "SET " + changes.map(c => identifier(c.name) + " = " + valueFor(c)).join("," + eol + indent),
        where].join(eol);
}
