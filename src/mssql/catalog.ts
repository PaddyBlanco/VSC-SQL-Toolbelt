import type { SharedConnections } from "./connection";
import { ToolkitError } from "./connection";

export interface SqlObject {
    type: string;
    schema: string;
    name: string;
}

export interface CatalogObject extends SqlObject {
    id: number;
}

const supportedTypes = "('U', 'V', 'P', 'FN', 'IF', 'TF')";
export const schemasQuery = `SELECT s.schema_id, s.name FROM sys.schemas AS s
WHERE EXISTS (SELECT 1 FROM sys.objects AS o WHERE o.schema_id = s.schema_id
AND o.is_ms_shipped = 0 AND o.type IN ${supportedTypes}) ORDER BY s.name`;

export function sqlId(id: number): number {
    if (!Number.isSafeInteger(id)) throw new ToolkitError("Ungültige Katalog-ID.");
    return id;
}

export function objectsQuery(schemaId: number): string {
    return `SELECT o.object_id, s.name, o.name,
CASE o.type WHEN 'U' THEN 'Table' WHEN 'V' THEN 'View' WHEN 'P' THEN 'StoredProcedure'
ELSE 'UserDefinedFunction' END
FROM sys.objects AS o JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE o.schema_id = ${sqlId(schemaId)} AND o.is_ms_shipped = 0 AND o.type IN ${supportedTypes}
ORDER BY o.name`;
}

export async function catalogRows(api: SharedConnections, token: string, uri: string, query: string) {
    const result = await api.executeSimpleQuery(token, uri, query);
    if (result.messages?.some(message => message.isError)) throw new ToolkitError("Katalogabfrage fehlgeschlagen.");
    return result.rows.map(row => row.map(cell => cell.displayValue));
}
