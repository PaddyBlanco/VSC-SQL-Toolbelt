import * as vscode from "vscode";
import { ToolkitError } from "../mssql/connection";
import { candidate } from "./candidate";
import { Metadata } from "./metadata";
import { replacement } from "./replacement";

export async function prepare(store: Metadata, explicit = false) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "sql") throw new ToolkitError("Einen verbundenen SQL-Editor öffnen.");
    if (editor.selections.length !== 1 || !editor.selection.isEmpty) throw new ToolkitError("Einen einzelnen Cursor ohne Textauswahl setzen.");
    const doc = editor.document;
    if (doc.offsetAt(doc.lineAt(doc.lineCount - 1).range.end) > 131072) throw new ToolkitError("Für die Ergänzung einen SQL-Ausschnitt unter 128 Ki Zeichen öffnen.");
    const text = doc.getText();
    const position = editor.selection.active;
    const offset = doc.offsetAt(position);
    const match = candidate(text, offset, store.db.name);
    if (!match) {
        if (explicit) throw new ToolkitError(`Kein passendes SQL-Ziel am Cursor. Cursor hinter * oder hinter INSERT INTO [Schema].[Tabelle] setzen. Ein vorausgehendes USE muss auf ${store.db.name} verweisen.`);
        return;
    }
    if (match.sources.length > 16) throw new ToolkitError("Pro SELECT werden maximal 16 Quellen unterstützt.");
    const version = doc.version;
    const auth = await vscode.authentication.getSession(store.api.authenticationProviderId, [], { silent: true });
    if (!auth) throw new ToolkitError("MSSQL-Freigabe fehlt. Datenbank aus SQL-Editor erneut übernehmen.");
    const relations = await store.resolve(auth.accessToken, match.sources);
    const indent = editor.options.insertSpaces === false ? "\t" : " ".repeat(Number(editor.options.tabSize) || 4);
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    return { editor, version, position, kind: match.kind, store,
        change: replacement(text, match, relations, indent, eol), until: Date.now() + 30_000 };
}

export type Prepared = NonNullable<Awaited<ReturnType<typeof prepare>>>;

export function stillCurrent(edit: Prepared, store?: Metadata) {
    const { editor } = edit;
    return edit.store === store && vscode.window.activeTextEditor === editor &&
        editor.document.version === edit.version && editor.selections.length === 1 && editor.selection.isEmpty &&
        editor.selection.active.isEqual(edit.position) && Date.now() < edit.until;
}
