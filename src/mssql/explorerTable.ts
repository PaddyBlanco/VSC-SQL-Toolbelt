import { ToolkitError } from "./connection";

interface ExplorerNode {
    nodeType?: string;
    metadata?: { metadataTypeName?: string; schema?: string; name?: string };
    connectionProfile?: { id?: string };
    parentNode?: ExplorerNode;
}

// MSSQL 1.48 classic Object Explorer. Read only the profile ID, never persist the node.
export function explorerTable(table?: ExplorerNode) {
    const schema = table?.metadata?.schema;
    const name = table?.metadata?.name;
    if (table?.nodeType !== "Table" || !schema || !name) {
        throw new ToolkitError("Im SQL-Server-Explorer eine Tabelle auswählen.");
    }
    let profile: string | undefined;
    let database: string | undefined;
    const seen = new Set<ExplorerNode>();
    for (let node: ExplorerNode | undefined = table; node && !seen.has(node); node = node.parentNode) {
        seen.add(node);
        profile ||= node.connectionProfile?.id;
        if (node.metadata?.metadataTypeName === "Database") database = node.metadata.name;
        if (database && profile) {
            return { kind: "mssqlTable" as const, db: { profile, name: database }, label: name, object: { schema, name } };
        }
    }
    throw new ToolkitError("Die Tabelle konnte keiner Datenbank und keinem gespeicherten MSSQL-Profil zugeordnet werden.");
}
