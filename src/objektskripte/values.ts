import { ToolkitError } from "../mssql/connection";
import { parameterizedType, type Column } from "../mssql/columns";

export function valueFor(c: Column): string {
    if (c.nullable) return "NULL";
    switch (c.type) {
        case "char": case "varchar": case "nchar": case "nvarchar": case "text": case "ntext": {
            const unicode = c.type.startsWith("n");
            const limit = c.bytes < 0 || c.type.endsWith("text") ? 128 : c.bytes / (unicode ? 2 : 1);
            // ASCII also fits varchar columns under UTF-8 collations.
            const label = /^[A-Za-z0-9_]+$/.test(c.name) || unicode ? c.name : "X";
            const text = ("<" + label + ">").slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "");
            return (unicode ? "N'" : "'") + text.replaceAll("'", "''") + "'";
        }
        case "bit": case "tinyint": case "smallint": case "int": case "bigint": case "money":
        case "smallmoney": case "numeric": case "decimal": case "float": case "real": return "0";
        case "uniqueidentifier": return "NEWID()";
        case "datetime": case "smalldatetime": return "GETUTCDATE()";
        case "datetime2": return "SYSUTCDATETIME()";
        case "datetimeoffset": return "SYSDATETIMEOFFSET()";
        case "time": case "date": return `CONVERT(${c.type}, SYSUTCDATETIME())`;
        case "binary": case "varbinary": case "image": return "0x00";
        case "xml": return "CONVERT(xml, N'<x/>')";
        default: throw new ToolkitError(`Für ${c.name} (${c.type}) fehlt ein geeigneter Testwert.`);
    }
}

export function columnType(c: Column): string {
    if (c.declaredType && c.declaredType !== c.type) return c.declaredType;
    return parameterizedType(c) ?? c.type;
}

export function keyType(c: Column): string {
    const type = parameterizedType(c);
    if (type) return type;
    switch (c.type) {
        case "timestamp": case "rowversion": return "binary(8)";
        case "uniqueidentifier": case "tinyint": case "smallint": case "int": case "bigint":
        case "money": case "smallmoney": case "float": case "real": case "bit": case "date":
        case "datetime": case "smalldatetime": return c.type;
        default: throw new ToolkitError(`Schlüsseltyp ${c.type} wird nicht unterstützt.`);
    }
}
