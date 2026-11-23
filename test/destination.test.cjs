const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function event() {
    const listeners = new Set();
    return {
        subscribe(fn) { listeners.add(fn); return { dispose() { listeners.delete(fn); } }; },
        fire(value) { for (const fn of listeners) fn(value); },
        get size() { return listeners.size; }
    };
}

test("Query-Editor befüllen, sobald MSSQL Profil und Datenbank bestätigt", async t => {
    const mock = {};
    const load = Module._load;
    let deliver;
    try {
        Module._load = function(name, ...args) {
            return name === "vscode" ? mock : load.call(this, name, ...args);
        };
        ({ deliver } = require("../out/objektskripte/destination"));
    } finally { Module._load = load; }

    const db = { profile: "Demo-A", name: "Demo" };
    const sql = "USE [Demo];\nGO\nCREATE TABLE dbo.Buch (Id int);";
    for (const scenario of ["sofort", "Explorer", "verzögert", "anderes Profil", "andere Datenbank", "Profilwechsel während Prüfung",
        "Editor gewechselt", "Editor bearbeitet", "Editor geschlossen", "abgebrochen"]) {
        await t.test(scenario, async () => {
            const [connection, focus, edit, close, cancel] = Array.from({ length: 5 }, event);
            const previous = { document: { getText: () => "SELECT 1" } };
            const doc = { isUntitled: true, languageId: "sql", version: 1, getText: () => "" };
            const inserts = [];
            const target = { document: doc, edit: async cb => { cb({ insert: (_, value) => inserts.push(value) }); return true; } };
            const cancellation = { isCancellationRequested: false, onCancellationRequested: cancel.subscribe };
            let profile = ["sofort", "Explorer", "andere Datenbank", "Profilwechsel während Prüfung"].includes(scenario) ? db.profile : undefined;
            let name = scenario === "andere Datenbank" ? "Andere" : db.name;
            if (scenario === "anderes Profil") profile = "Demo-B";
            let race = scenario === "Profilwechsel während Prüfung";
            const api = { getActiveEditorConnectionId: async () => {
                const sampled = profile;
                if (race) { race = false; profile = "Demo-B"; connection.fire(); }
                return sampled;
            }, getActiveDatabase: async () => name, onDidChangeActiveEditorConnection: connection.subscribe };
            mock.extensions = { getExtension: () => ({ activate: async () => ({ getSharedConnectionsApi: () => api }) }) };
            mock.authentication = { getSession: async () => ({ accessToken: "fixture" }) };
            mock.Position = class {};
            mock.ProgressLocation = { Notification: 15 };
            mock.workspace = { textDocuments: [previous.document], onDidChangeTextDocument: edit.subscribe,
                onDidCloseTextDocument: close.subscribe, openTextDocument: async options => {
                    assert.deepEqual(options, { language: "sql" }); return doc;
                } };
            mock.window = { activeTextEditor: previous, showTextDocument: async () => (mock.window.activeTextEditor = target),
                onDidChangeActiveTextEditor: focus.subscribe, withProgress: (_, fn) => fn({}, cancellation) };
            const node = scenario === "Explorer" ? {} : undefined;
            mock.commands = { executeCommand: async (command, arg) => {
                assert.equal(command, "mssql.objectExplorerNewQuery"); assert.equal(arg, node); mock.window.activeTextEditor = target;
            } };
            const send = deliver("editor", sql, db, "Beispiel", node);
            await new Promise(resolve => setImmediate(resolve));
            if (!["sofort", "Explorer"].includes(scenario)) {
                assert.deepEqual(inserts, []);
                switch (scenario) {
                    case "Editor gewechselt": mock.window.activeTextEditor = previous; focus.fire(previous); break;
                    case "Editor bearbeitet": doc.version++; edit.fire({ document: doc }); break;
                    case "Editor geschlossen": doc.isClosed = true; close.fire(doc); break;
                    case "abgebrochen": cancellation.isCancellationRequested = true; cancel.fire(); break;
                    default: profile = db.profile; name = db.name; connection.fire();
                }
            }
            if (scenario.startsWith("Editor ")) await assert.rejects(send);
            else await send;
            assert.deepEqual(inserts, scenario.startsWith("Editor ") || scenario === "abgebrochen" ? [] : [sql]);
            for (const source of [connection, focus, edit, close, cancel]) assert.equal(source.size, 0);
        });
    }
});
