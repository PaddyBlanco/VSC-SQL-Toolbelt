import * as vscode from "vscode";
import { catalogRows, objectsQuery, schemasQuery } from "../mssql/catalog";
import type { CatalogObject } from "../mssql/catalog";
import { report, session } from "../mssql/session";
import type { Database, SharedConnections } from "../mssql/connection";
import { ToolkitError, withConnection } from "../mssql/connection";

export type Entry = { db: Database; label: string } & (
    { kind: "schema"; id: number } | { kind: "object"; object: CatalogObject }
);

export function registerObjectView(context: vscode.ExtensionContext, onBind: (db: Database, api: SharedConnections) => void) {
    let bound: Database | undefined;
    let bindAttempt = 0;
    const changed = new vscode.EventEmitter<void>();
    const view = vscode.window.createTreeView<Entry>("sqlToolbelt.objects", {
        treeDataProvider: {
            onDidChangeTreeData: changed.event,
            getTreeItem(entry) {
                const item = new vscode.TreeItem(entry.label, entry.kind === "schema"
                    ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
                item.contextValue = entry.kind === "object" && entry.object.type === "Table" ? "sqlToolbelt.table" : "sqlToolbelt." + entry.kind;
                if (entry.kind === "object") item.description = entry.object.type;
                return item;
            },
            async getChildren(parent): Promise<Entry[]> {
                const db = bound;
                if (!db || (parent && parent.db !== db) || parent?.kind === "object") return [];
                try {
                    const { api, token } = await session();
                    const query = parent ? objectsQuery(parent.id) : schemasQuery;
                    const rows = await withConnection(api, token, db, uri => catalogRows(api, token, uri, query));
                    if (bound !== db) return [];
                    if (!parent) return rows.map(([id, label]) => ({ kind: "schema", id: Number(id), label, db }));
                    return rows.map(([id, schema, name, type]) => ({
                        kind: "object", label: name, db, object: { id: Number(id), schema, name, type }
                    }));
                } catch (error) {
                    if (bound === db) report(error);
                    return [];
                }
            }
        }
    });

    const bind = vscode.commands.registerCommand("sqlToolbelt.bind", async () => {
        const attempt = ++bindAttempt;
        const editor = vscode.window.activeTextEditor;
        try {
            if (editor?.document.languageId !== "sql") throw new ToolkitError("Einen verbundenen SQL-Editor öffnen.");
            const { api, token } = await session();
            let switched = false;
            const listener = api.onDidChangeActiveEditorConnection(() => { switched = true; });
            try {
                const [profile, name] = await Promise.all([api.getActiveEditorConnectionId(token), api.getActiveDatabase(token)]);
                if (attempt !== bindAttempt) return;
                if (switched || vscode.window.activeTextEditor !== editor) throw new ToolkitError("Editor gewechselt. Datenbank erneut übernehmen.");
                if (!profile || !name) throw new ToolkitError("Im SQL-Editor eine gespeicherte MSSQL-Verbindung auswählen.");
                bound = { profile, name };
                onBind(bound, api);
                view.description = name;
                changed.fire();
                return true;
            } finally {
                listener.dispose();
            }
        } catch (error) { report(error); }
    });

    context.subscriptions.push(view, changed, bind);
    return (entry: Entry) => entry.db === bound;
}
