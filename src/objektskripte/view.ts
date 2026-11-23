import * as vscode from "vscode";
import { catalogRows, objectsQuery, schemasQuery } from "../mssql/catalog";
import type { CatalogObject } from "../mssql/catalog";
import { report, session, sharedConnections } from "../mssql/session";
import type { Database, EditorBinding, SharedConnections } from "../mssql/connection";
import { ToolkitError, withConnection } from "../mssql/connection";

export type Entry = { db: Database; label: string } & (
    { kind: "schema"; id: number } | { kind: "object"; object: CatalogObject }
);

export function registerObjectView(context: vscode.ExtensionContext, onBind: (binding?: EditorBinding) => void) {
    let bound: Database | undefined;
    let pinned = false;
    let bindAttempt = 0;
    let api: SharedConnections | undefined;
    let askedForAccess = false;
    let consent: Promise<vscode.AuthenticationSession> | undefined;
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

    function setTree(db?: Database) {
        if (bound === db) return;
        bound = db;
        view.description = db?.name;
        changed.fire();
    }

    async function refresh(explicit = false) {
        const attempt = ++bindAttempt;
        const editor = vscode.window.activeTextEditor;
        onBind();
        if (!pinned) setTree();
        try {
            if (editor?.document.languageId !== "sql") throw new ToolkitError("Einen verbundenen SQL-Editor öffnen.");
            if (!api) {
                const shared = await sharedConnections();
                if (attempt !== bindAttempt) return;
                api = shared;
                context.subscriptions.push(api.onDidChangeActiveEditorConnection(() => { void refresh(); }));
            }
            // Editor and connection events may arrive while VS Code is showing its consent dialog.
            if (!consent && (!askedForAccess || explicit)) {
                askedForAccess = true;
                consent = Promise.resolve(vscode.authentication.getSession(api.authenticationProviderId, [], { createIfNone: true }))
                    .finally(() => { consent = undefined; });
            }
            const auth = await (consent ?? vscode.authentication.getSession(api.authenticationProviderId, [], { silent: true }));
            if (!auth || attempt !== bindAttempt || vscode.window.activeTextEditor !== editor) return;
            const [profile, name] = await Promise.all([api.getActiveEditorConnectionId(auth.accessToken), api.getActiveDatabase(auth.accessToken)]);
            if (attempt !== bindAttempt || vscode.window.activeTextEditor !== editor) return;
            if (!profile || !name) throw new ToolkitError("Im SQL-Editor eine gespeicherte MSSQL-Verbindung auswählen.");
            const db = { profile, name };
            onBind({ db, api });
            if (explicit) pinned = true;
            if (explicit || !pinned) setTree(db);
            return true;
        } catch (error) { if (explicit && attempt === bindAttempt) report(error); }
    }

    context.subscriptions.push(view, changed,
        vscode.commands.registerCommand("sqlToolbelt.bind", () => refresh(true)),
        vscode.window.onDidChangeActiveTextEditor(() => { void refresh(); }),
        vscode.authentication.onDidChangeSessions(e => {
            if (e.provider.id !== api?.authenticationProviderId) return;
            pinned = false;
            setTree();
            if (!consent) void refresh();
        }),
        { dispose() { bindAttempt++; } }
    );
    void refresh();
    return (entry: Entry) => !!bound && entry.db === bound;
}
