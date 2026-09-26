import { Injectable } from '@nestjs/common';import { Client } from '@modelcontextprotocol/sdk/client/index.js';import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';import type { BrowserActionResult,BrowserIntakePort } from './ports.js';
type Session={client:Client;transport:StreamableHTTPClientTransport};
@Injectable() export class ConduitBrowserAdapter implements BrowserIntakePort {private readonly sessions=new Map<string,Session>();
 async initSession(id:string){if(this.sessions.has(id))return;const raw=process.env.CONDUIT_MCP_URL;if(!raw)throw new Error('CONDUIT_MCP_URL is not configured');const token=process.env.CONDUIT_MCP_BEARER_TOKEN;const transport=new StreamableHTTPClientTransport(new URL(raw),{requestInit:token?{headers:{Authorization:`Bearer ${token}`}}:undefined});const client=new Client({name:'chain-verify',version:'0.1.0'});await client.connect(transport);this.sessions.set(id,{client,transport});}
 private async call(id:string,name:string,args:Record<string,unknown>):Promise<BrowserActionResult>{const s=this.sessions.get(id);if(!s)throw new Error('Conduit session is not initialized');const r=await s.client.callTool({name,arguments:args});const text=(r.content as Array<any>|undefined)?.filter(x=>x.type==='text').map(x=>String(x.text)).join('\n')||'';let data:unknown=text;try{data=JSON.parse(text);}catch{}return {success:!r.isError,data};}
 navigate(id:string,url:string){return this.call(id,'conduit_navigate',{url});}
 extractMain(id:string){return this.call(id,'conduit_extract',{});}
 accessibilitySnapshot(id:string){return this.call(id,'conduit_extract',{});}
 async closeSession(id:string){const s=this.sessions.get(id);if(!s)return;this.sessions.delete(id);await s.transport.close();}
}
