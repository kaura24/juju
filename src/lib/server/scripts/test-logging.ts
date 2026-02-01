
import { initRunLog, addAgentLog } from '../src/lib/server/agentLogger.ts';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';

async function testLogging() {
    console.log('Starting Logging Test...');
    const runId = 'test-run-logging-' + Date.now();

    // 1. Init Run
    await initRunLog(runId);
    console.log('Run initialized');

    // 2. Add INFO log (Should not be in server_error.log)
    await addAgentLog(runId, 'Orchestrator', 'INFO', 'Test Info', 'This is a test info message');
    console.log('INFO log added');

    // 3. Add ERROR log (Should be in server_error.log)
    const errorDetail = 'This is a critical test error';
    await addAgentLog(runId, 'Orchestrator', 'ERROR', 'Test Error', errorDetail);
    console.log('ERROR log added');

    // 4. Verify server_error.log
    const errorLogPath = join(process.cwd(), 'logs', 'server_error.log');
    try {
        const content = await readFile(errorLogPath, 'utf-8');
        if (content.includes(runId) && content.includes(errorDetail)) {
            console.log('SUCCESS: Error log verification passed!');
            console.log('Log content snippet:', content.trim().split('\n').pop());
        } else {
            console.error('FAILURE: Error log content mismatch');
            console.error('Content:', content);
            process.exit(1);
        }
    } catch (e) {
        console.error('FAILURE: content read error', e);
        process.exit(1);
    }
}

testLogging();
