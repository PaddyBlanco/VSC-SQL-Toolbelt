import { sqlId, type CatalogObject } from "./catalog";
import { nameLiteral, unicodeBinary } from "./columns";
import { ToolkitError, type Database, type SharedConnections } from "./connection";

const levels = new Map([["Table", "TABLE"], ["View", "VIEW"], ["StoredProcedure", "PROCEDURE"], ["UserDefinedFunction", "FUNCTION"]]);

export async function saveDescription(api: SharedConnections, token: string, uri: string, db: Database,
    object: CatalogObject, expected: string, value: string) {
    if (value.length > 3750) throw new ToolkitError("Die Beschreibung darf höchstens 7.500 Byte in UTF-16 umfassen.");
    const level = levels.get(object.type);
    if (!level) throw new ToolkitError("Dieser Objekttyp unterstützt hier keine Beschreibung.");
    const result = await api.executeSimpleQuery(token, uri, `SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @id int=${sqlId(object.id)}, @schema sysname=${nameLiteral(object.schema)}, @name sysname=${nameLiteral(object.name)};
DECLARE @qualified nvarchar(517)=QUOTENAME(@schema)+N'.'+QUOTENAME(@name);
DECLARE @resource nvarchar(255)=CONCAT(N'SQL-Toolbelt:MS_Description:',@id), @rc int, @exists bit=0;
DECLARE @current nvarchar(max)=N'', @next nvarchar(3750)=CONVERT(nvarchar(3750),${unicodeBinary(value)});
DECLARE @expected varbinary(max)=${unicodeBinary(expected)};
IF ISNULL(DB_ID(${nameLiteral(db.name)}),-1)<>DB_ID() THROW 50000,'Database changed',1;
BEGIN TRY
 BEGIN TRANSACTION;
 EXEC @rc=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @rc<0 OR ISNULL(OBJECT_ID(@qualified),-1)<>@id THROW 50000,'Object unavailable',1;
 SELECT @exists=1,@current=COALESCE(CONVERT(nvarchar(max),value),N'') FROM sys.extended_properties
 WHERE class=1 AND major_id=@id AND minor_id=0 AND name=N'MS_Description';
 IF DATALENGTH(@current)<>DATALENGTH(@next) OR CONVERT(varbinary(max),@current)<>CONVERT(varbinary(max),@next)
 BEGIN
  IF DATALENGTH(@current)<>DATALENGTH(@expected) OR CONVERT(varbinary(max),@current)<>@expected
  BEGIN
   ROLLBACK;
   SELECT N'changed';
   RETURN;
  END;
  DECLARE @proc sysname=CASE WHEN @exists=1 THEN N'sys.sp_updateextendedproperty' ELSE N'sys.sp_addextendedproperty' END;
  EXEC @rc=@proc @name=N'MS_Description',@value=@next,@level0type=N'SCHEMA',@level0name=@schema,@level1type=N'${level}',@level1name=@name;
  IF @rc<>0 OR ISNULL(OBJECT_ID(@qualified),-1)<>@id THROW 50000,'Object changed',1;
 END;
 COMMIT;
 SELECT N'saved';
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH`);
    const status = result.rows[0]?.[0]?.displayValue;
    if (status === "changed") throw new ToolkitError("Die Beschreibung wurde inzwischen geändert. Entwurf bei Bedarf kopieren und Properties neu laden.");
    if (status !== "saved" || result.messages?.some(message => message.isError)) {
        throw new ToolkitError("Speichern fehlgeschlagen. Verbindung und Änderungsberechtigung am Objekt prüfen.");
    }
}
