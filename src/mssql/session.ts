import * as vscode from "vscode";
import { ToolkitError } from "./connection";
import type { SharedConnections } from "./connection";

export async function sharedConnections() {
    const extension = vscode.extensions.getExtension<{
        getSharedConnectionsApi(version: 1): SharedConnections;
    }>("ms-mssql.mssql");
    const exports = await extension?.activate();
    if (!exports?.getSharedConnectionsApi) throw new ToolkitError("MSSQL mit Shared Connections v1 wird benötigt.");
    return exports.getSharedConnectionsApi(1);
}

export async function session() {
    const api = await sharedConnections();
    const { accessToken } = await vscode.authentication.getSession(api.authenticationProviderId, [], { createIfNone: true });
    return { api, token: accessToken };
}

export function report(error: unknown) {
    // Provider errors can contain connection details. Keep diagnostics local to the failing operation.
    const message = error instanceof ToolkitError ? error.message : "MSSQL-Zugriff fehlgeschlagen. Verbindung, Objekt und Freigabe prüfen.";
    void vscode.window.showErrorMessage(message);
}
