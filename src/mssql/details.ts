import { catalogRows, sqlId, type CatalogObject } from "./catalog";
import { objectNameValue, type Source } from "./columns";
import { ToolkitError, type Database, type SharedConnections } from "./connection";

export async function resolveObject(api: SharedConnections, token: string, uri: string, db: Database, source: Source): Promise<CatalogObject> {
    const [row] = await catalogRows(api, token, uri, `SELECT DB_NAME(), o.object_id, SCHEMA_NAME(o.schema_id), o.name,
CASE o.type WHEN 'U' THEN 'Table' WHEN 'V' THEN 'View' WHEN 'P' THEN 'StoredProcedure' ELSE 'UserDefinedFunction' END
FROM sys.objects o WHERE o.object_id=OBJECT_ID(${objectNameValue(source)}) AND o.is_ms_shipped=0 AND o.type IN ('U','V','P','FN','IF','TF')`);
    if (!row || row[0] !== db.name) throw new ToolkitError("Objekt im gebundenen Kontext nicht sichtbar.");
    return { id: sqlId(Number(row[1])), schema: row[2], name: row[3], type: row[4] };
}

const properties = `SELECT p.label, p.value FROM sys.objects o
LEFT JOIN sys.tables t ON t.object_id=o.object_id
LEFT JOIN sys.extended_properties ep ON ep.class=1 AND ep.major_id=o.object_id AND ep.minor_id=0 AND ep.name=N'MS_Description'
LEFT JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id IN (0,1)
LEFT JOIN sys.data_spaces ds ON ds.data_space_id=i.data_space_id
CROSS APPLY (VALUES
 (1,N'Name',o.name COLLATE DATABASE_DEFAULT),(2,N'Typ',o.type_desc),(3,N'Schema',SCHEMA_NAME(o.schema_id)),
 (4,N'Datenbank',DB_NAME()),(5,N'Server',CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))),
 (6,N'Beschreibung',TRY_CONVERT(nvarchar(max),ep.value)),
 (7,N'Identity-Spalte',(SELECT c.name FROM sys.identity_columns c WHERE c.object_id=t.object_id)),
 (8,N'Indexierbar',CASE OBJECTPROPERTYEX(o.object_id,'IsIndexable') WHEN 1 THEN N'Ja' WHEN 0 THEN N'Nein' END),
 (9,N'Lock Escalation',t.lock_escalation_desc),
 (10,N'Regular Data Space',ds.name COLLATE DATABASE_DEFAULT + N' (' + ds.type_desc COLLATE DATABASE_DEFAULT + N')')
) p(ord,label,value) WHERE o.object_id=@id AND (p.ord<=6 OR t.object_id IS NOT NULL OR (p.ord=8 AND o.type='V')) ORDER BY p.ord`;

const dependencies = `SELECT DISTINCT direction, kind COLLATE DATABASE_DEFAULT AS kind, target COLLATE DATABASE_DEFAULT AS target FROM (
 SELECT N'Ausgehend' AS direction, N'SQL-Referenz' AS kind,
 CONCAT_WS(N'.',QUOTENAME(d.referenced_server_name),QUOTENAME(d.referenced_database_name),
 QUOTENAME(COALESCE(OBJECT_SCHEMA_NAME(d.referenced_id),d.referenced_schema_name)),QUOTENAME(d.referenced_entity_name)) AS target
 FROM sys.sql_expression_dependencies d WHERE d.referencing_id=@id
 UNION ALL SELECT N'Eingehend',N'SQL-Referenz',QUOTENAME(OBJECT_SCHEMA_NAME(d.referencing_id))+N'.'+QUOTENAME(OBJECT_NAME(d.referencing_id))
 FROM sys.sql_expression_dependencies d WHERE d.referenced_id=@id
 UNION ALL SELECT x.direction,N'Fremdschlüssel · '+fk.name COLLATE DATABASE_DEFAULT,QUOTENAME(OBJECT_SCHEMA_NAME(x.target_id))+N'.'+QUOTENAME(OBJECT_NAME(x.target_id))
 FROM sys.foreign_keys fk CROSS APPLY (VALUES (N'Ausgehend',fk.parent_object_id,fk.referenced_object_id),
 (N'Eingehend',fk.referenced_object_id,fk.parent_object_id)) x(direction,source_id,target_id) WHERE x.source_id=@id
) refs ORDER BY direction,kind,target`;

const indexes = `SELECT typ COLLATE DATABASE_DEFAULT AS typ, name,
 COALESCE(key_column,N''), COALESCE(included_column,N''), COALESCE(ziel,N'') FROM (
 SELECT CASE WHEN i.is_primary_key=1 THEN N'PRIMARY KEY' WHEN i.is_unique_constraint=1 THEN N'UNIQUE Constraint'
 ELSE CONCAT(CASE WHEN i.is_unique=1 THEN N'UNIQUE ' END,i.type_desc) END AS typ,
 CASE WHEN kc.name IS NOT NULL AND kc.name<>i.name THEN kc.name+N' / '+i.name ELSE i.name END AS name,
 CASE WHEN ic.is_included_column=0 THEN QUOTENAME(COL_NAME(i.object_id,ic.column_id))+
 CASE WHEN ic.key_ordinal=0 OR i.type NOT IN (1,2) THEN N'' WHEN ic.is_descending_key=1 THEN N' DESC' ELSE N' ASC' END END AS key_column,
 CASE WHEN ic.is_included_column=1 THEN QUOTENAME(COL_NAME(i.object_id,ic.column_id)) END AS included_column,
 CAST(NULL AS nvarchar(800)) AS ziel, ic.is_included_column AS included, ic.key_ordinal AS ordinal, ic.index_column_id AS pos
 FROM sys.indexes i LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
 LEFT JOIN sys.key_constraints kc ON kc.parent_object_id=i.object_id AND kc.unique_index_id=i.index_id
 WHERE i.object_id=@id AND i.index_id>0 AND i.is_hypothetical=0
 UNION ALL SELECT N'FOREIGN KEY',fk.name,QUOTENAME(COL_NAME(fc.parent_object_id,fc.parent_column_id)),NULL,
 QUOTENAME(OBJECT_SCHEMA_NAME(fc.referenced_object_id))+N'.'+QUOTENAME(OBJECT_NAME(fc.referenced_object_id))+N'.'+QUOTENAME(COL_NAME(fc.referenced_object_id,fc.referenced_column_id)),
 0,fc.constraint_column_id,fc.constraint_column_id FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=fk.object_id WHERE fk.parent_object_id=@id
) entries ORDER BY name,typ,included,ordinal,pos`;

function groupIndexes(rows: string[][]) {
    const groups: { type: string; name: string; keys: string[]; includes: string[]; targets: string[] }[] = [];
    for (const [type, name, key, included, target] of rows) {
        let group = groups.at(-1);
        if (!group || group.type !== type || group.name !== name) {
            group = { type, name, keys: [], includes: [], targets: [] };
            groups.push(group);
        }
        if (key) group.keys.push(key);
        if (included) group.includes.push(included);
        if (target) group.targets.push(target);
    }
    return groups.map(({ type, name, keys, includes, targets }) =>
        [type, name, keys.join(", ") || "—", includes.join(", ") || "—", targets.join(", ") || "—"]);
}

export const tabs = ["dependencies", "create", "indexes", "properties"] as const;
export type Tab = typeof tabs[number];

export async function detailRows(api: SharedConnections, token: string, uri: string, db: Database, object: CatalogObject, tab: Exclude<Tab, "create">) {
    const current = await resolveObject(api, token, uri, db, object);
    if (current.id !== object.id || current.type !== object.type || current.name !== object.name || current.schema !== object.schema) {
        throw new ToolkitError("Objekt hat sich geändert. Details erneut öffnen.");
    }
    const statements = { properties, dependencies, indexes };
    const rows = await catalogRows(api, token, uri, `DECLARE @id int=OBJECT_ID(${objectNameValue(object)});
IF @id IS NULL OR @id<>${sqlId(object.id)} THROW 50000, 'Object changed', 1;
${statements[tab]}`);
    return tab === "indexes" ? groupIndexes(rows) : rows;
}
