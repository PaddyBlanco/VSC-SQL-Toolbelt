import * as vscode from "vscode";
import { ToolkitError, type Database } from "../mssql/connection";
import { session } from "../mssql/session";
import { agentJobScript } from "./job";

export const destinations = ["editor", "file", "clipboard", "job"] as const;
export type Destination = typeof destinations[number];

export async function deliver(destination: Destination, sql: string, database: Database, label: string, node?: unknown) {
    switch (destination) {
        case "clipboard":
            await vscode.env.clipboard.writeText(sql);
            return;
        case "file": {
            const uri = await vscode.window.showSaveDialog({ filters: { SQL: ["sql"] }, title: "Save SQL Script" });
            if (uri) await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(sql));
            return;
        }
        case "job": {
            const name = await vscode.window.showInputBox({
                title: "Agent Job ...", prompt: "Jobname für das Einrichtungsskript",
                value: label.replaceAll("%", "_").slice(0, 128),
                validateInput: text => !text.trim() || text.length > 128 || text.includes("%")
                    ? "Einen Jobnamen mit 1–128 Zeichen ohne % eingeben." : undefined
            });
            if (!name) return;
            sql = agentJobScript(name.trim(), database.name, sql);
            break;
        }
    }
    const { api, token } = await session();
    const previous = new Set(vscode.workspace.textDocuments);
    if (node) await vscode.commands.executeCommand("mssql.objectExplorerNewQuery", node);
    let editor = node ? vscode.window.activeTextEditor : undefined;
    if (!editor || previous.has(editor.document) || !editor.document.isUntitled || editor.document.languageId !== "sql" || editor.document.getText()) {
        editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "sql" }), { preview: false });
    }
    const target = editor;
    const version = target.document.version;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, cancellable: true,
        title: "Warte auf MSSQL. Bei Bedarf im neuen Editor das ursprüngliche Profil und die Zieldatenbank auswählen."
    }, async (_, cancel) => {
        let revision = 0;
        let wake = () => {};
        const changed = () => { revision++; wake(); };
        const events = [
            api.onDidChangeActiveEditorConnection(changed), vscode.window.onDidChangeActiveTextEditor(changed),
            vscode.workspace.onDidChangeTextDocument(e => { if (e.document === target.document) changed(); }),
            vscode.workspace.onDidCloseTextDocument(doc => { if (doc === target.document) changed(); }),
            cancel.onCancellationRequested(changed)
        ];
        try {
            while (!cancel.isCancellationRequested) {
                const attempt = revision;
                const active = vscode.window.activeTextEditor;
                if (target.document.isClosed || target.document.version !== version || target.document.getText() || (active && active !== target)) {
                    throw new ToolkitError("Der neue SQL-Editor wurde geschlossen, gewechselt oder bearbeitet.");
                }
                if (active === target) {
                    let connection;
                    try {
                        connection = await Promise.all([api.getActiveEditorConnectionId(token), api.getActiveDatabase(token)]);
                    } catch (error) {
                        if (revision !== attempt) continue;
                        throw error;
                    }
                    if (revision !== attempt) continue;
                    if (connection[0] === database.profile && connection[1] === database.name) {
                        if (!await target.edit(builder => builder.insert(new vscode.Position(0, 0), sql))) {
                            throw new ToolkitError("Das Skript konnte nicht in den geprüften SQL-Editor eingefügt werden.");
                        }
                        return;
                    }
                }
                // MSSQL may connect an untitled document after VS Code has already shown it.
                await new Promise<void>(resolve => { wake = resolve; });
            }
        } finally { events.forEach(event => event.dispose()); }
    });
}
