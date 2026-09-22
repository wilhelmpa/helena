// Operator smoke probe: metadata and exact links only; no credentials or text in output.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client=new Client({name:'volition-workspace-smoke',version:'1.0.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../server.mjs',import.meta.url))],stderr:'pipe'}));
try{
 const catalog=await client.listTools();
 const projects=await client.callTool({name:'projects_list',arguments:{}});
 if(projects.isError)throw Error('Project inventory failed');
 const rows=projects.structuredContent.projects;
 const results=[];
 for(const p of rows){
  const result=await client.callTool({name:'files_list',arguments:{projectKey:p.projectKey,maxResults:5}});
  if(result.isError)throw Error('Project files failed');
  results.push({projectKey:p.projectKey,entries:result.structuredContent.entries.length,exactLinks:result.structuredContent.entries.every(x=>Number.isInteger(x.fileId)&&x.url===`https://cloud.volition.one/f/${x.fileId}`)});
 }
 const denied=await client.callTool({name:'file_read_text',arguments:{projectKey:'PRIV',path:'../../secret.md'}});
 if(!denied.isError)throw Error('Traversal unexpectedly accepted');
 console.log(JSON.stringify({tools:catalog.tools.map(t=>({name:t.name,readOnly:t.annotations.readOnlyHint})),projects:results,traversalDenied:true}));
}finally{await client.close();}
