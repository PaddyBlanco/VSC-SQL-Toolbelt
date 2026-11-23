import * as vscode from "vscode";
import { ToolkitError, type Database, type SharedConnections } from "../mssql/connection";
import { report } from "../mssql/session";
import { Metadata } from "./metadata";
import { prepare, stillCurrent, type Prepared } from "./prepare";

export function registerEditor(context: vscode.ExtensionContext) {
    let metadata: Metadata | undefined;
    let connectionListener: { dispose(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    let ready: Prepared | undefined;
    const key = "sqlToolbelt.canExpand";
    const hint = vscode.window.createTextEditorDecorationType({
        after: { margin: "0 0 0 1em", fontStyle: "italic", color: new vscode.ThemeColor("editorCodeLens.foreground") },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });

    function reset() {
        revision++;
        clearTimeout(timer);
        if (!ready) return;
        ready.editor.setDecorations(hint, []);
        ready = undefined;
        void vscode.commands.executeCommand("setContext", key, false);
    }

    function schedule() {
        reset();
        const store = metadata;
        if (!store || vscode.window.activeTextEditor?.document.languageId !== "sql") return;
        const id = revision;
        timer = setTimeout(async () => {
            try {
                const edit = await prepare(store);
                if (!edit || id !== revision || !stillCurrent(edit, metadata)) return;
                ready = edit;
                await vscode.commands.executeCommand("setContext", key, true);
                if (ready !== edit) return;
                const contentText = { exec: "Tab · Prozedurparameter einfügen", insert: "Tab · Spalten und VALUES", select: "Tab · Spalten einfügen" }[edit.kind];
                edit.editor.setDecorations(hint, [{
                    range: new vscode.Range(edit.position, edit.position),
                    renderOptions: { after: { contentText } }
                }]);
                timer = setTimeout(reset, Math.max(0, edit.until - Date.now()));
            } catch { /* Background lookups stay quiet. The palette command reports the reason. */ }
        }, 150);
    }

    async function apply(explicit: boolean) {
        try {
            if (!metadata && explicit) {
                const bound = await vscode.commands.executeCommand<boolean>("sqlToolbelt.bind");
                if (!bound) return; // The binding command reports its own failure.
            }
            if (!metadata) return;
            const edit = ready && stillCurrent(ready, metadata) ? ready : explicit ? await prepare(metadata, true) : undefined;
            if (!edit) return;
            if (!stillCurrent(edit, metadata)) {
                if (explicit) throw new ToolkitError("SQL-Editor, Cursor oder Verbindung hat sich während der Auflösung geändert. Bitte erneut ergänzen.");
                return;
            }
            reset();
            const doc = edit.editor.document;
            const range = new vscode.Range(doc.positionAt(edit.change.start), doc.positionAt(edit.change.end));
            const applied = await edit.editor.edit(builder => builder.replace(range, edit.change.value));
            if (!applied) throw new ToolkitError("VS Code konnte die Änderung im SQL-Dokument nicht einfügen.");
        } catch (error) { report(error); }
    }

    context.subscriptions.push(hint,
        vscode.commands.registerCommand("sqlToolbelt.tab", () => apply(false)),
        vscode.commands.registerCommand("sqlToolbelt.expand", () => apply(true)),
        vscode.window.onDidChangeActiveTextEditor(schedule),
        vscode.window.onDidChangeTextEditorSelection(e => { if (e.textEditor === vscode.window.activeTextEditor) schedule(); }),
        vscode.workspace.onDidChangeTextDocument(e => { if (e.document === vscode.window.activeTextEditor?.document) schedule(); }),
        vscode.authentication.onDidChangeSessions(e => {
            if (metadata && e.provider.id === metadata.api.authenticationProviderId) {
                metadata = new Metadata(metadata.api, metadata.db);
                schedule();
            }
        }),
        { dispose() { clearTimeout(timer); connectionListener?.dispose(); } }
    );
    return (db: Database, api: SharedConnections) => {
        connectionListener?.dispose();
        metadata = new Metadata(api, db);
        connectionListener = api.onDidChangeActiveEditorConnection(() => {
            metadata = new Metadata(api, db);
            schedule();
        });
        schedule();
    };
}
