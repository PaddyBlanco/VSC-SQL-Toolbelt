const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const turn = () => new Promise(resolve => setImmediate(resolve));

test("SQL aktiviert das Toolkit und folgt auch nach spätem Verbinden sicher dem aktiven Editor", async () => {
    assert.ok(require("../package.json").activationEvents.includes("onLanguage:sql"));
    let editorChanged, connectionChanged, sessionChanged, manual, active, profile, database;
    let prompts = 0, reads = 0, allow = false, delayed;
    const event = () => ({ dispose() {} });
    const tree = {};
    const api = {
        authenticationProviderId: "fixture",
        onDidChangeActiveEditorConnection: fn => { connectionChanged = fn; return event(); },
        getActiveDatabase: async () => database,
        getActiveEditorConnectionId: async () => { reads++; return delayed ?? profile; }
    };
    let answer;
    const vscode = {
        EventEmitter: class { fire() {} },
        window: { createTreeView: () => tree, onDidChangeActiveTextEditor: fn => { editorChanged = fn; return event(); } },
        authentication: {
            onDidChangeSessions: fn => { sessionChanged = fn; return event(); },
            getSession: async (_provider, _scopes, options) => {
                if (options.createIfNone) {
                    prompts++;
                    if (!allow) await new Promise(resolve => { answer = resolve; });
                    if (!allow) throw Error("Abgebrochen");
                }
                return allow ? { accessToken: "fixture" } : undefined;
            }
        },
        extensions: { getExtension: () => ({ activate: async () => ({ getSharedConnectionsApi: () => api }) }) },
        commands: { registerCommand: (_, fn) => { manual = fn; return event(); } }
    };
    const original = Module._load;
    let register;
    try {
        Module._load = function(name, ...args) { return name === "vscode" ? vscode : original.call(this, name, ...args); };
        ({ registerObjectView: register } = require("../out/objektskripte/view"));
    } finally { Module._load = original; }
    const isCurrent = register({ subscriptions: [] }, binding => { active = binding?.db; });
    function focus(languageId) {
        vscode.window.activeTextEditor = { document: { languageId } };
        editorChanged();
    }
    focus("plaintext");
    await turn();
    assert.equal(prompts, 0);
    focus("sql");
    await turn();
    connectionChanged();
    focus("sql");
    await turn();
    assert.equal(prompts, 1);
    answer();
    await turn();
    focus("sql");
    await turn();
    assert.equal(reads, 0);
    assert.equal(prompts, 1);
    allow = true;
    sessionChanged({ provider: { id: "fixture" } });
    await turn();
    assert.equal(active, undefined);
    profile = "Profil A";
    database = "Demo";
    connectionChanged();
    await turn();
    const entryA = { db: active };
    assert.deepEqual(active, { profile, name: database });
    assert.ok(isCurrent(entryA));

    let finish;
    delayed = new Promise(resolve => { finish = resolve; });
    focus("sql");
    await turn();
    delayed = undefined;
    profile = "Profil B";
    connectionChanged();
    assert.equal(active, undefined);
    assert.ok(!isCurrent(entryA));
    await turn();
    finish("Profil A");
    await turn();
    assert.deepEqual(active, { profile, name: database });
    database = "Weitere";
    connectionChanged();
    await turn();
    assert.equal(tree.description, database);
    assert.equal(prompts, 1);

    assert.ok(await manual());
    const pinned = { db: active };
    focus("sql");
    profile = "Profil A";
    await turn();
    assert.equal(active.profile, "Profil A");
    assert.ok(isCurrent(pinned));
    allow = false;
    sessionChanged({ provider: { id: "fixture" } });
    await turn();
    assert.equal(active, undefined);
    assert.ok(!isCurrent(pinned));
    assert.equal(tree.description, undefined);

    // A restored SQL editor is already open when VS Code activates the extension.
    allow = true;
    register({ subscriptions: [] }, binding => { active = binding?.db; });
    await turn();
    assert.deepEqual(active, { profile, name: database });
    database = undefined;
    connectionChanged();
    await turn();
    assert.equal(active, undefined);
});
