import { catalogRows } from "./catalog";
import { objectNameValue, parameterizedType, type Source } from "./columns";
import { ToolkitError, type Database, type SharedConnections } from "./connection";

export interface Parameter { name: string; declarationType: string; output: boolean }

const variableTypes = new Map([["text", "varchar(max)"], ["ntext", "nvarchar(max)"], ["image", "varbinary(max)"], ["timestamp", "binary(8)"]]);

export async function readParameters(api: SharedConnections, token: string, uri: string, db: Database, source: Source): Promise<Parameter[]> {
    const rows = await catalogRows(api, token, uri, `SELECT DB_NAME(), p.name, ISNULL(t.name, N''), p.max_length, p.precision, p.scale,
CONVERT(int, p.is_output), CONVERT(int, p.is_cursor_ref),
ISNULL(CASE WHEN t.is_user_defined = 1 THEN QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name)
    WHEN p.xml_collection_id <> 0 THEN N'xml(' + CASE WHEN p.is_xml_document = 1 THEN N'DOCUMENT ' ELSE N'CONTENT ' END
        + QUOTENAME(SCHEMA_NAME(x.schema_id)) + N'.' + QUOTENAME(x.name) + N')'
    ELSE N'' END, N'?')
FROM sys.procedures AS o
JOIN sys.parameters AS p ON p.object_id = o.object_id AND p.parameter_id > 0
LEFT JOIN sys.types AS t ON t.user_type_id = p.user_type_id
LEFT JOIN sys.xml_schema_collections AS x ON x.xml_collection_id = p.xml_collection_id
WHERE o.object_id = OBJECT_ID(${objectNameValue(source)}) AND o.type IN ('P', 'PC')
ORDER BY p.parameter_id`);
    if (!rows.length || rows[0][0] !== db.name) throw new ToolkitError("Keine Prozedur mit sichtbaren Parametern in der gewählten Datenbank gefunden.");
    return rows.map(([, name, type, bytes, precision, scale, output, cursor, qualifiedType]) => {
        if (cursor === "1") throw new ToolkitError(`Cursor-Ausgabeparameter ${name} können nicht mit SELECT ausgegeben werden.`);
        if (!type || qualifiedType === "?" || !/^@[\p{L}\p{N}\p{M}_@$#]+$/u.test(name)) throw new ToolkitError("Parametermetadaten nicht auflösbar.");
        const scalarType = parameterizedType({ type, bytes: Number(bytes), precision: Number(precision), scale: Number(scale) });
        return { name, declarationType: qualifiedType || scalarType || variableTypes.get(type) || type, output: output === "1" };
    });
}
