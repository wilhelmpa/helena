import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { smoke } from './runtime-smoke.mjs';

async function fixture(body, run) {
  const root = await mkdtemp(join(tmpdir(), 'volition-smoke-test-'));
  const file = join(root, 'runtime');
  await writeFile(file, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  try {
    await run(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const rpc = (failure = '') => `
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
 const r = JSON.parse(line);
 let result = {};
 if (r.method === 'initialize') result = {protocolVersion:1};
 if (r.method === 'session/new') result = {sessionId:'test',models:{availableModels:[{modelId:'gpt-6.1-sol[low]'}]},modes:{availableModes:[{id:'read-only'}]}};
 if (r.method === 'session/set_model' && r.params.modelId !== 'gpt-6.1-sol[low]') process.exit(2);
 if (r.method === 'session/prompt') {
   ${failure}
   console.log(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'VOLITION_UPDATE_OK'}}}}));
   result = {stopReason:'end_turn'};
 }
 console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));
});`;

test('ACP performs model selection and a completed prompt', async () => {
  await fixture(rpc(), async (program) => {
    assert.deepEqual(await smoke('codex-acp', program, 'gpt-6.1-sol', 2000), {
      smoke: 'passed',
      runtime: 'codex-acp',
      model: 'gpt-6.1-sol',
      protocol: 'acp',
      answer: 'VOLITION_UPDATE_OK',
    });
  });
});

test('ACP initialization without a usable model turn cannot pass', async () => {
  await fixture(
    rpc(
      "console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32602,message:'model unsupported'}})); return;",
    ),
    async (program) => {
      await assert.rejects(smoke('codex-acp', program, 'gpt-6.1-sol', 2000), /model unsupported/);
    },
  );
});

test('ACP cancels unexpected tool requests', async () => {
  await fixture(
    rpc(
      "console.log(JSON.stringify({jsonrpc:'2.0',id:100,method:'fs/write_text_file',params:{}})); return;",
    ),
    async (program) => {
      await assert.rejects(smoke('codex-acp', program, 'gpt-6.1-sol', 2000), /Werkzeug/);
    },
  );
});

test('CLI requires actual assistant output from the requested model', async () => {
  await fixture(
    `if (!process.argv.includes('gpt-6.1-sol')) process.exit(1); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'VOLITION_UPDATE_OK'}}));`,
    async (program) => {
      assert.equal((await smoke('codex', program, 'gpt-6.1-sol', 2000)).smoke, 'passed');
    },
  );
  await fixture(
    `console.log(JSON.stringify({type:'result',is_error:false,result:'VOLITION_UPDATE_OK'}));`,
    async (program) => {
      assert.equal((await smoke('claude', program, 'claude-sonnet-5-5', 2000)).smoke, 'passed');
    },
  );
});

test('version output, failed turns and hanging runtimes fail', async () => {
  for (const body of [
    `console.log('codex-cli 0.159.2');`,
    `console.log(JSON.stringify({type:'result',is_error:true,result:'VOLITION_UPDATE_OK'}));`,
    `setInterval(()=>{},1000);`,
  ]) {
    await fixture(body, async (program) => {
      await assert.rejects(smoke('claude', program, 'claude-sonnet-5-5', 500));
    });
  }
});

test('a failed native runtime retains its bounded diagnostic', async () => {
  await fixture(
    `console.error('model gpt-6.1-sol unsupported'); process.exit(1);`,
    async (program) => {
      await assert.rejects(
        smoke('codex', program, 'gpt-6.1-sol', 2000),
        /model gpt-6.1-sol unsupported/,
      );
    },
  );
});
