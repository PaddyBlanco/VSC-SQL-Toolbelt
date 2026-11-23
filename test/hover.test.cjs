const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("Hover öffnet nur das aufgelöste Objekt und lädt jeden Tab auf seinem ursprünglichen Profil", async () => {
    const db = { profile: "Demo A", name: "Katalog" };
    const sql = "SELECT * FROM dbo.Buch";
    const document = { version: 1, lineCount: 1, getText: () => sql, offsetAt: x => x, positionAt: x => x,
        lineAt: () => ({ range: { end: sql.length } }) };
    const editor = { document };
    const event = () => ({ dispose() {} });
    const messages = [];
    const tabs = [];
    let hover, command, receive, disposed, sessionChanged;
    const panel = { webview: { onDidReceiveMessage: fn => { receive = fn; return event(); },
        postMessage: async m => { messages.push(m); return true; } },
        onDidDispose: event, dispose: () => { disposed = true; } };
    let panels = 0, profile = db.profile;
    const api = { authenticationProviderId: "fixture", onDidChangeActiveEditorConnection: event,
        getActiveEditorConnectionId: async () => profile, getActiveDatabase: async () => db.name,
        connect: async (_, p, name) => { assert.equal(p, db.profile); assert.equal(name, db.name); return "temp"; },
        disconnect: async () => {}, executeSimpleQuery: async (_, uri, q) => {
            assert.equal(uri, "temp");
            let values;
            if (q.startsWith("SELECT DB_NAME(), o.object_id")) values = [db.name, "12", "dbo", "Buch", "Table"];
            else if (q.startsWith("SELECT DB_NAME(), SCHEMA_NAME")) values = [db.name, "dbo", "Buch"];
            else { tabs.push(q); values = ["Test", "<Beispiel>"]; }
            return { rows: [values.map(displayValue => ({ displayValue }))] };
        }, scriptObject: async (_t, _u, operation) => { assert.equal(operation, 1); return "CREATE TABLE [dbo].[Buch](Id int);"; } };
    const vscode = {
        window: { activeTextEditor: editor, onDidChangeActiveTextEditor: event,
            createWebviewPanel: (_type, title, _col, options) => {
                assert.equal(title, "dbo.Buch"); assert.deepEqual(options.localResourceRoots, []);
                panels++; return panel;
            } },
        authentication: { onDidChangeSessions: fn => { sessionChanged = fn; return event(); }, getSession: async () => ({ accessToken: "fixture" }) },
        languages: { registerHoverProvider: (_selector, fn) => { hover = fn.provideHover; return event(); } },
        commands: { registerCommand: (_name, fn) => { command = fn; return event(); } },
        Hover: class { constructor(contents) { this.contents = contents; } },
        Range: class {}, MarkdownString: class { constructor(value) { this.value = value; } }, ViewColumn: { Beside: 2 }
    };
    const original = Module._load;
    let registerInspector;
    try {
        Module._load = function(name, ...args) { return name === "vscode" ? vscode : original.call(this, name, ...args); };
        ({ registerInspector } = require("../out/editor/inspector"));
    } finally { Module._load = original; }
    const bind = registerInspector({ subscriptions: [] });
    bind({ db, api });
    const get = async () => {
        const h = await hover(document, sql.indexOf("Buch"), { isCancellationRequested: false });
        const link = h.contents[1];
        assert.deepEqual(link.isTrusted.enabledCommands, ["sqlToolbelt.showDetails"]);
        return JSON.parse(decodeURIComponent(link.value.match(/\?([^)]*)\)$/)[1]))[0];
    };
    const first = await get();
    await command("unbekannt");
    profile = "Demo B";
    await command(first);
    assert.equal(panels, 0);
    profile = db.profile;
    const second = await get();
    document.version++;
    await command(second);
    assert.equal(panels, 0);
    await command(await get());
    assert.equal(panels, 1);
    for (const [i, tab] of ["properties", "indexes", "dependencies", "create"].entries()) {
        await receive({ action: "load", tab, request: i + 1 });
        assert.equal(messages.at(-1).tab, tab);
        assert.equal(messages.at(-1).error, undefined);
    }
    assert.match(messages.at(-1).sql, /CREATE TABLE/);
    assert.equal(tabs.length, 3);
    await receive({ action: "load", tab: "other", request: 10 });
    assert.equal(messages.length, 4);
    bind();
    assert.ok(!disposed);
    sessionChanged({ provider: { id: api.authenticationProviderId } });
    assert.ok(disposed);
});
