import * as vscode from "vscode";
import type { CatalogObject } from "../mssql/catalog";
import { ToolkitError, withConnection, type Database, type EditorBinding, type SharedConnections } from "../mssql/connection";
import { saveDescription } from "../mssql/description";
import { detailRows, resolveObject, tabs, type Tab } from "../mssql/details";
import { report } from "../mssql/session";
import { ddlScript } from "../objektskripte/script";
import { deliver } from "../objektskripte/destination";
import { hoverTarget } from "./hoverTarget";
import { withEditorDatabase } from "./metadata";
import { inspectorPage } from "./inspectorPage";

function showDetails(db: Database, api: SharedConnections, object: CatalogObject) {
    const panel = vscode.window.createWebviewPanel("sqlToolbelt.details", object.schema + "." + object.name,
        vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
    let revision = 0;
    let script: { sql: string; request: number } | undefined;
    let description: { value: string; request: number } | undefined;
    const receive = panel.webview.onDidReceiveMessage(async message => {
        if (!message || !tabs.includes(message.tab) || !Number.isSafeInteger(message.request)) return;
        const { action, request }: { action: unknown; request: number } = message;
        const tab: Tab = message.tab;
        if (action === "open") {
            if (tab === "create" && script?.request === request) {
                try { await deliver("editor", script.sql, db, object.name); } catch (error) { report(error); }
            }
            return;
        }
        if (action === "saveDescription") {
            const original = description;
            if (tab !== "properties" || original?.request !== request || typeof message.value !== "string") return;
            const id = revision;
            description = undefined;
            try {
                const auth = await vscode.authentication.getSession(api.authenticationProviderId, [], { silent: true });
                if (!auth) throw new Error();
                await withConnection(api, auth.accessToken, db, async uri => {
                    if (id === revision) await saveDescription(api, auth.accessToken, uri, db, object, original.value, message.value);
                });
                if (id === revision) {
                    description = { value: message.value, request };
                    await panel.webview.postMessage({ tab, request, saved: true, value: message.value });
                }
            } catch (error) {
                if (id === revision) {
                    description = original;
                    await panel.webview.postMessage({ tab, request, saveError: error instanceof ToolkitError
                        ? error.message : "Speichern fehlgeschlagen. Verbindung und Änderungsberechtigung am Objekt prüfen." });
                }
            }
            return;
        }
        if (action !== "load") return;
        const id = ++revision;
        script = undefined;
        description = undefined;
        try {
            const auth = await vscode.authentication.getSession(api.authenticationProviderId, [], { silent: true });
            if (!auth) throw new Error();
            const token = auth.accessToken;
            const data = tab === "create"
                ? { sql: await ddlScript(api, token, db, object, "create") }
                : { rows: await withConnection(api, token, db, uri => detailRows(api, token, uri, db, object, tab)) };
            if (revision !== id) return;
            if (data.sql !== undefined) script = { sql: data.sql, request };
            if (tab === "properties") {
                const row = data.rows?.find(([label]) => label === "Beschreibung");
                if (row) description = { value: row[1], request };
            }
            await panel.webview.postMessage({ tab, request, ...data });
        } catch {
            if (id === revision) void panel.webview.postMessage({ tab, request, error: "Metadaten nicht verfügbar. Verbindung, Objekt und Leserechte prüfen." });
        }
    });
    panel.onDidDispose(() => { revision++; script = undefined; description = undefined; receive.dispose(); });
    panel.webview.html = inspectorPage();
    return panel;
}

export function registerInspector(context: vscode.ExtensionContext) {
    let binding: EditorBinding | undefined;
    let revision = 0;
    let panelProvider: string | undefined;
    let panel: vscode.WebviewPanel | undefined;
    let ticket: { key: string; open: () => Promise<void> } | undefined;
    const command = "sqlToolbelt.showDetails";
    const invalidate = () => { revision++; ticket = undefined; };
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(invalidate),
        vscode.authentication.onDidChangeSessions(e => {
            if (e.provider.id === panelProvider) panel?.dispose();
        }),
        vscode.commands.registerCommand(command, async key => {
            if (ticket && key === ticket.key) {
                const action = ticket.open;
                ticket = undefined;
                try { await action(); } catch (error) { report(error); }
            }
        }),
        vscode.languages.registerHoverProvider("sql", {
            async provideHover(document, position, cancellation) {
                const bound = binding;
                if (!bound || vscode.window.activeTextEditor?.document !== document ||
                    document.offsetAt(document.lineAt(document.lineCount - 1).range.end) > 131072) return;
                const target = hoverTarget(document.getText(), document.offsetAt(position));
                if (!target) return;
                const id = ++revision;
                ticket = undefined;
                const version = document.version;
                const current = () => id === revision && version === document.version && vscode.window.activeTextEditor?.document === document;
                const { api, db } = bound;
                async function connected(token: string) {
                    const [profile, name] = await Promise.all([api.getActiveEditorConnectionId(token), api.getActiveDatabase(token)]);
                    return current() && profile === db.profile && name === db.name;
                }
                try {
                    const auth = await vscode.authentication.getSession(api.authenticationProviderId, [], { silent: true });
                    if (!auth || cancellation.isCancellationRequested || !await connected(auth.accessToken)) return;
                    const { object, objectDb } = await withEditorDatabase(api, auth.accessToken, db, target.database, async (uri, objectDb) => ({
                        object: await resolveObject(api, auth.accessToken, uri, objectDb, target.source), objectDb
                    }));
                    if (!current() || cancellation.isCancellationRequested) return;
                    const key = crypto.randomUUID();
                    const expires = Date.now() + 60_000;
                    ticket = { key, open: async () => {
                        if (Date.now() > expires || !await connected(auth.accessToken)) return;
                        panel?.dispose();
                        const next = showDetails(objectDb, api, object);
                        panel = next;
                        panelProvider = api.authenticationProviderId;
                        next.onDidDispose(() => { if (panel === next) { panel = undefined; panelProvider = undefined; } });
                    } };
                    const link = new vscode.MarkdownString("[Details öffnen](command:" + command + "?" + encodeURIComponent(JSON.stringify([key])) + ")");
                    link.isTrusted = { enabledCommands: [command] };
                    const summary = { language: "sql", value: object.type + " · " + object.schema + "." + object.name };
                    const contents = object.description ? [summary, new vscode.MarkdownString().appendText(object.description), link] : [summary, link];
                    return new vscode.Hover(contents,
                        new vscode.Range(document.positionAt(target.start), document.positionAt(target.end)));
                } catch { return; }
            }
        }), { dispose() { invalidate(); panel?.dispose(); } }
    );
    return (next?: EditorBinding) => {
        invalidate();
        binding = next;
    };
}
