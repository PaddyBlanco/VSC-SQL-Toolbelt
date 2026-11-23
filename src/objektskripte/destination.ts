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
    function emptyTarget() {
        return vscode.window.activeTextEditor === target && target.document.version === version && !target.document.getText();
    }
    async function verified() {
        if (!emptyTarget()) return false;
        let changed = false;
        const events = [api.onDidChangeActiveEditorConnection(() => { changed = true; }),
            vscode.window.onDidChangeActiveTextEditor(() => { changed = true; })];
        try {
            const [profile, name] = await Promise.all([api.getActiveEditorConnectionId(token), api.getActiveDatabase(token)]);
            return !changed && emptyTarget() && profile === database.profile && name === database.name;
        } finally { events.forEach(event => event.dispose()); }
    }
    if (!await verified()) {
        if (!emptyTarget()) throw new ToolkitError("Der neue SQL-Editor wurde gewechselt oder bearbeitet.");
        const check = "Verbindung prüfen und einfügen";
        const answer = await vscode.window.showInformationMessage(
            "Im neuen, leeren SQL-Editor über MSSQL mit dem ursprünglichen Profil und der Datenbank " + database.name + " verbinden.", check);
        if (answer !== check) return;
        if (!await verified()) throw new ToolkitError("Profil, Datenbank oder SQL-Editor stimmen nicht mit dem Skriptziel überein.");
    }
    if (!emptyTarget() || !await target.edit(builder => builder.insert(new vscode.Position(0, 0), sql))) {
        throw new ToolkitError("Das Skript konnte nicht in den geprüften SQL-Editor eingefügt werden.");
    }
}
