function literal(value: string) {
    return "N'" + value.replaceAll("'", "''") + "'";
}

// The generated text is opened for review. SQL Server Agent creates the job only on manual execution.
export function agentJobScript(name: string, database: string, command: string) {
    return `USE [msdb];
GO
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @job uniqueidentifier, @result int;
    EXEC @result = dbo.sp_add_job
        @job_name = ${literal(name)}, @enabled = 0, @job_id = @job OUTPUT;
    IF @result <> 0 THROW 50001, 'sp_add_job failed.', 1;

    EXEC @result = dbo.sp_add_jobstep
        @job_id = @job, @step_name = N'T-SQL', @subsystem = N'TSQL',
        @database_name = ${literal(database)}, @command = ${literal(command)};
    IF @result <> 0 THROW 50002, 'sp_add_jobstep failed.', 1;

    EXEC @result = dbo.sp_add_jobserver @job_id = @job;
    IF @result <> 0 THROW 50003, 'sp_add_jobserver failed.', 1;
    COMMIT;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK;
    THROW;
END CATCH;
`;
}
