import * as vscode from "vscode";
import { report, session } from "./mssql/session";
import { objectScript } from "./objektskripte/objectScript";
import { registerObjectView } from "./objektskripte/view";
import type { Entry } from "./objektskripte/view";
import { registerInspector } from "./editor/inspector";
import { registerEditor } from "./editor/actions";
import { registerTableMenu } from "./objektskripte/tableMenu";
import { deliver } from "./objektskripte/destination";

export function activate(context: vscode.ExtensionContext) {
    const bindEditor = registerEditor(context);
    const bindInspector = registerInspector(context);
    const isCurrent = registerObjectView(context, binding => { bindEditor(binding); bindInspector(binding); });
    registerTableMenu(context);
    async function output(operation: "script" | "insert" | "update", entry?: Entry) {
        if (!entry || entry.kind !== "object") return;
        const current = () => isCurrent(entry);
        if (!current()) return;
        try {
            const destination = await vscode.window.showQuickPick(["Neues SQL-Dokument", "Zwischenablage"], {
                title: `${operation === "script" ? "DROP and CREATE" : operation.toUpperCase()} · ${entry.db.name} · ${entry.object.schema}.${entry.label}`
            });
            if (!destination || !current()) return;
            const { api, token } = await session();
            const sql = await objectScript(api, token, entry.db, entry.object, operation === "script" ? "dropAndCreate" : operation);
            if (!current()) return;
            await deliver(destination === "Zwischenablage" ? "clipboard" : "editor", sql, entry.db, entry.label);
        } catch (error) { report(error); }
    }
    for (const operation of ["script", "insert", "update"] as const) {
        context.subscriptions.push(vscode.commands.registerCommand("sqlToolbelt." + operation, entry => output(operation, entry)));
    }
}
