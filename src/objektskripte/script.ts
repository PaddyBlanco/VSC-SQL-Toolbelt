import { catalogRows, sqlId } from "../mssql/catalog";
import type { SqlObject } from "../mssql/catalog";
import { identifier, objectNameValue } from "../mssql/columns";
import type { Database, SharedConnections } from "../mssql/connection";
import { ToolkitError, withConnection } from "../mssql/connection";

export type Ddl = "create" | "drop" | "dropAndCreate";

export async function ddlScript(api: SharedConnections, token: string, db: Database,
    object: SqlObject & { id?: number }, operation: Ddl) {
    return withConnection(api, token, db, async uri => {
        // Explorer tables are identified by name. Our own tree carries the catalog ID as well.
        const predicate = object.id === undefined
            ? `type = 'U' AND object_id = OBJECT_ID(${objectNameValue(object)})`
            : `object_id = ${sqlId(object.id)}`;
        const rows = await catalogRows(api, token, uri, `SELECT DB_NAME(), SCHEMA_NAME(schema_id), name
FROM sys.objects WHERE ${predicate}`);
        const [database, schema, name] = rows[0] ?? [];
        if (database !== db.name || schema !== object.schema || name !== object.name) {
            throw new ToolkitError("Objektkontext hat sich geändert. Datenbank erneut übernehmen.");
        }
        const target = { type: object.type, schema, name };
        const parts = ["USE " + identifier(db.name) + ";", "GO"];
        if (operation !== "create") {
            const drop = await api.scriptObject(token, uri, 4, target);
            if (!drop?.trim()) throw new ToolkitError("MSSQL hat kein DROP-Skript geliefert.");
            parts.push(drop.trimEnd());
            if (operation === "dropAndCreate" && !/(?:^|\n)[ \t]*GO$/i.test(drop.trimEnd())) parts.push("GO");
        }
        if (operation !== "drop") {
            const create = await api.scriptObject(token, uri, 1, target);
            if (!create?.trim()) throw new ToolkitError("MSSQL hat kein CREATE-Skript geliefert.");
            parts.push(create);
        }
        return parts.join("\n");
    });
}
