import { catalogRows } from "./catalog";
import { ToolkitError } from "./connection";
import type { Database, SharedConnections } from "./connection";

export interface Source { schema?: string; name: string }
export interface Column {
    name: string; type: string; declaredType: string; bytes: number; precision: number; scale: number;
    nullable: boolean; writable: boolean; hidden: boolean; hasDefault: boolean; key: number;
}
export interface Relation {
    id: number; schema: string; name: string; table: boolean; columns: Column[];
}

export function identifier(name: string) { return "[" + name.replaceAll("]", "]]") + "]"; }

// Encode names as UTF-16LE binary constants. Editor text cannot introduce SQL tokens.
function nameValue(name: string) {
    if (!name.length || name.length > 128) throw new ToolkitError("Ungültige Länge des SQL-Bezeichners.");
    let hex = "";
    for (let i = 0; i < name.length; i++) {
        const unit = name.charCodeAt(i);
        hex += (unit & 255).toString(16).padStart(2, "0") + (unit >> 8).toString(16).padStart(2, "0");
    }
    return "QUOTENAME(CONVERT(nvarchar(128), 0x" + hex + "))";
}

export function objectNameValue(source: Source) {
    return [source.schema, source.name].filter((s): s is string => s !== undefined).map(nameValue).join(" + N'.' + ");
}

export async function readRelation(api: SharedConnections, token: string, uri: string, db: Database, source: Source): Promise<Relation> {
    const qualified = objectNameValue(source);
    const rows = await catalogRows(api, token, uri, `SELECT DB_NAME(), o.object_id, SCHEMA_NAME(o.schema_id), o.name, RTRIM(o.type),
c.name, TYPE_NAME(c.system_type_id), c.max_length, c.precision, c.scale,
CONVERT(int,c.is_nullable), CONVERT(int,c.is_hidden),
CASE WHEN c.is_identity=1 OR c.is_computed=1 OR c.is_hidden=1 OR c.generated_always_type<>0 OR c.system_type_id=189 OR c.is_column_set=1 THEN 0 ELSE 1 END,
CASE WHEN c.default_object_id<>0 THEN 1 ELSE 0 END, ISNULL(pk.key_ordinal,0), ISNULL(pk.key_count,0), TYPE_NAME(c.user_type_id)
FROM sys.objects o JOIN sys.columns c ON c.object_id=o.object_id
LEFT JOIN (SELECT ic.object_id,ic.column_id,ic.key_ordinal, COUNT(*) OVER (PARTITION BY ic.object_id) AS key_count FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
WHERE i.is_primary_key=1 AND ic.key_ordinal>0) pk ON pk.object_id=c.object_id AND pk.column_id=c.column_id
WHERE o.object_id=OBJECT_ID(${qualified}) AND o.type IN ('U','V') ORDER BY c.column_id`);
    if (!rows.length || rows[0][0] !== db.name) throw new ToolkitError("Tabelle oder View in der gewählten Datenbank nicht auflösbar.");
    const [, id, schema, name, kind] = rows[0];
    const columns = rows.map(([, , , , , name, type, bytes, precision, scale, nullable, hidden, writable, def, key, , declaredType]) => ({
        name, type, declaredType, bytes: Number(bytes), precision: Number(precision), scale: Number(scale),
        nullable: nullable === "1", hidden: hidden === "1", writable: writable === "1", hasDefault: def === "1", key: Number(key)
    }));
    if (columns.filter(c => c.key > 0).length !== Math.max(...rows.map(row => Number(row[15])))) {
        throw new ToolkitError("Primärschlüssel-Metadaten sind unvollständig.");
    }
    return { id: Number(id), schema, name, table: kind === "U", columns };
}
