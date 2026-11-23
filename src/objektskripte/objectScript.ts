import { identifier, readRelation } from "../mssql/columns";
import { ToolkitError, withConnection, type Database, type SharedConnections } from "../mssql/connection";
import type { SqlObject } from "../mssql/catalog";
import { dml, type Dml } from "./dml";
import { ddlScript, type Ddl } from "./script";

export function objectScript(api: SharedConnections, token: string, db: Database,
    object: SqlObject & { id?: number }, operation: Ddl | Dml) {
    if (operation === "create" || operation === "drop" || operation === "dropAndCreate") {
        return ddlScript(api, token, db, object, operation);
    }
    return withConnection(api, token, db, async uri => {
        const relation = await readRelation(api, token, uri, db, object);
        if (object.id !== undefined && relation.id !== object.id) throw new ToolkitError("Objekt geändert. Datenbank erneut übernehmen.");
        return "USE " + identifier(db.name) + ";\nGO\n" + dml(relation, operation);
    });
}
