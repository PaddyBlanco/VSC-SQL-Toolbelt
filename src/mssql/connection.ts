import type { SqlObject } from "./catalog";

export class ToolkitError extends Error {}

export interface SharedConnections {
    authenticationProviderId: string;
    onDidChangeActiveEditorConnection(listener: () => void): { dispose(): void };
    getActiveEditorConnectionId(token: string): Promise<string | undefined>;
    getActiveDatabase(token: string): Promise<string | undefined>;
    connect(token: string, profile: string, database: string): Promise<string>;
    disconnect(token: string, uri: string): Promise<void>;
    executeSimpleQuery(token: string, uri: string, query: string): Promise<{
        rows: { displayValue: string }[][];
        messages?: { isError: boolean }[];
    }>;
    scriptObject(token: string, uri: string, operation: 1 | 4, object: SqlObject): Promise<string | undefined>;
}

export interface Database {
    profile: string;
    name: string;
}

export async function withConnection<T>(api: SharedConnections, token: string, db: Database,
    work: (uri: string) => Promise<T>): Promise<T> {
    const uri = await api.connect(token, db.profile, db.name);
    try {
        return await work(uri);
    } finally {
        await api.disconnect(token, uri);
    }
}
