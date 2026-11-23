import * as vscode from "vscode";
import type { CatalogObject } from "../mssql/catalog";
import { withConnection, type Database, type SharedConnections } from "../mssql/connection";
import { detailRows, resolveObject, tabs, type Tab } from "../mssql/details";
import { report } from "../mssql/session";
import { ddlScript } from "../objektskripte/script";
import { deliver } from "../objektskripte/destination";
import { hoverTarget } from "./hoverTarget";
import { inspectorPage } from "./inspectorPage";

function showDetails(db: Database, api: SharedConnections, object: CatalogObject) {
    const panel = vscode.window.createWebviewPanel("sqlToolbelt.details", object.schema + "." + object.name,
        vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
    let revision = 0;
    let script: { sql: string; request: number } | undefined;
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
        if (action !== "load") return;
        const id = ++revision;
        script = undefined;
        try {
            const auth = await vscode.authentication.getSession(api.authenticationProviderId, [], { silent: true });
            if (!auth) throw new Error();
            const token = auth.accessToken;
            const data = tab === "create"
                ? { sql: await ddlScript(api, token, db, object, "create") }
                : { rows: await withConnection(api, token, db, uri => detailRows(api, token, uri, db, object, tab)) };
            if (revision !== id) return;
            if (data.sql !== undefined) script = { sql: data.sql, request };
            await panel.webview.postMessage({ tab, request, ...data });
        } catch {
            if (id === revision) void panel.webview.postMessage({ tab, request, error: "Metadaten nicht verfügbar. Verbindung, Objekt und Leserechte prüfen." });
        }
    });
    panel.onDidDispose(() => { revision++; script = undefined; receive.dispose(); });
    panel.webview.html = inspectorPage();
    return panel;
}

export function registerInspector(context: vscode.ExtensionContext) {
    let binding: { db: Database; api: SharedConnections } | undefined;
    let revision = 0;
    let listener: vscode.Disposable | undefined;
    let panel: vscode.WebviewPanel | undefined;
    let ticket: { key: string; open: () => Promise<void> } | undefined;
    const command = "sqlToolbelt.showDetails";
    const invalidate = () => { revision++; ticket = undefined; };
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(invalidate),
        vscode.authentication.onDidChangeSessions(e => {
            if (e.provider.id === binding?.api.authenticationProviderId) { invalidate(); panel?.dispose(); }
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
                const target = hoverTarget(document.getText(), document.offsetAt(position), bound.db.name);
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
                    const object = await withConnection(api, auth.accessToken, db, uri => resolveObject(api, auth.accessToken, uri, db, target.source));
                    if (!current() || cancellation.isCancellationRequested) return;
                    const key = crypto.randomUUID();
                    const expires = Date.now() + 60_000;
                    ticket = { key, open: async () => {
                        if (Date.now() > expires || !await connected(auth.accessToken)) return;
                        panel?.dispose();
                        const next = showDetails(db, api, object);
                        panel = next;
                        next.onDidDispose(() => { if (panel === next) panel = undefined; });
                    } };
                    const link = new vscode.MarkdownString("[Details öffnen](command:" + command + "?" + encodeURIComponent(JSON.stringify([key])) + ")");
                    link.isTrusted = { enabledCommands: [command] };
                    return new vscode.Hover([{ language: "sql", value: object.type + " · " + object.schema + "." + object.name }, link],
                        new vscode.Range(document.positionAt(target.start), document.positionAt(target.end)));
                } catch { return; }
            }
        }), { dispose() { invalidate(); listener?.dispose(); panel?.dispose(); } }
    );
    return (db: Database, api: SharedConnections) => {
        invalidate();
        panel?.dispose();
        listener?.dispose();
        binding = { db, api };
        listener = api.onDidChangeActiveEditorConnection(invalidate);
    };
}