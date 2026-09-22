import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { Readable } from 'node:stream';
import { makePushAuthenticator, parsePushBody, readPushBody } from './push.mjs';

const route = {path:'/gmail', audience:'https://push.example.test/gmail', serviceAccount:'push@project.iam.gserviceaccount.com', subscription:'projects/project/subscriptions/inbox',accounts:['owner@example.test']};
const {privateKey,publicKey}=await generateKeyPair('RS256');
const auth=makePushAuthenticator(route,publicKey);
const jwt = (overrides={}) => new SignJWT({email:route.serviceAccount,email_verified:true,...overrides}).setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setAudience(route.audience).setSubject('service-account-id').setIssuedAt().setExpirationTime('1h').sign(privateKey);
const req = token => ({method:'POST',url:'/gmail',headers:{'content-type':'application/json',authorization:`Bearer ${token}`}});
test('only the configured Google service account can push',async()=>{
  assert.equal((await auth(req(await jwt()))).email,route.serviceAccount);
  await assert.rejects(auth(req(await jwt({email:'attacker@example.test'}))));
  await assert.rejects(auth(req(await jwt({email_verified:false}))));
  const browser=req(await jwt());browser.headers.origin='https://plan.example.test';await assert.rejects(auth(browser));
  const wrongPath=req(await jwt());wrongPath.url='/admin';await assert.rejects(auth(wrongPath));
});
const body=(data={emailAddress:'owner@example.test',historyId:'123'})=>({subscription:route.subscription,message:{messageId:'456',publishTime:'2026-09-21T00:00:00Z',data:Buffer.from(JSON.stringify(data)).toString('base64')}});
test('only bounded mailbox change metadata reaches the private receiver',()=>{
  assert.deepEqual(parsePushBody(body(),route),{emailAddress:'owner@example.test',historyId:'123',messageId:'456',publishedAt:'2026-09-21T00:00:00.000Z'});
  assert.equal(parsePushBody(body({emailAddress:'owner@example.test',historyId:123}),route).historyId,'123');
  assert.throws(()=>parsePushBody(body({emailAddress:'owner@example.test',historyId:Number.MAX_SAFE_INTEGER+1}),route));
  assert.throws(()=>parsePushBody(body({emailAddress:'other@example.test',historyId:'123'}),route));
  assert.throws(()=>parsePushBody(body({emailAddress:'owner@example.test',historyId:'123; curl evil'}),route));
  assert.throws(()=>parsePushBody({...body(),subscription:'other'},route));
});
test('oversized streams are rejected even without Content-Length',async()=>{
  const stream=Readable.from([Buffer.alloc(9000),Buffer.alloc(9000)]);stream.headers={};await assert.rejects(readPushBody(stream));
});

test('normalizes Google nanosecond timestamps for the strict receiver contract',()=>{ const event=body();event.message.publishTime='2026-09-21T00:00:00.123456789Z';assert.equal(parsePushBody(event,route).publishedAt,'2026-09-21T00:00:00.123Z'); });
