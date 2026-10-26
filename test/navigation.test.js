import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { apply } from '../lib/index.js';

async function harness(gateway) {
  const session = { id: 'target-session', header: { cwd:'C:/work/demo' } };
  const agent = { id: session.id, session, status: 'idle' };
  const cleanups = [];
  let options, plugin;
  const ctx = {
    sessions: { list: () => [session] }, agents: { get: () => agent }, on() {},
    effect: fn => cleanups.push(fn()),
    inject: (names, fn) => {
      if (gateway && names.length === 1 && names[0] === 'typertGateway') fn({typertGateway:gateway,effect: f => cleanups.push(f())});
    },
  };
  await apply(ctx, {}, {
    startCompanion: async config => { options=config; return {isReady:()=>true,send(){},close(){}}; },
    observe: value => { plugin=value; },
  });
  return {options, state:plugin.state, session, dispose:()=>cleanups.forEach(fn=>fn())};
}

test('opening a listed conversation dispatches navigation only, rejects stale targets and unavailable clients', async t => {
  const frames=[];let live=true;
  const h=await harness({hasLiveClient:()=>live,broadcastRemoteEvent:frame=>frames.push(frame)});
  t.after(h.dispose);
  assert.equal(h.options.onOpenSession(h.session.id).ok,false, 'historical unlisted session cannot be opened through the pet');
  h.state.event(h.session,{type:'turn/start',data:{}});
  const before=h.state.snapshot();
  assert.deepEqual(h.options.onOpenSession(h.session.id),{ok:true});
  assert.deepEqual(frames,[{event:'whale-pet/open-session',args:[h.session.id]}]);
  assert.deepEqual(h.state.snapshot(),before,'navigation does not mutate a task or create a message');
  for(const id of ['missing',null,{},''])assert.equal(h.options.onOpenSession(id).ok,false);
  live=false;assert.equal(h.options.onOpenSession(h.session.id).ok,false);
  assert.equal(frames.length,1);
});

test('old hosts without a navigation gateway fail clearly', async t => {
  const h=await harness();t.after(h.dispose);
  h.state.event(h.session,{type:'turn/start',data:{}});
  assert.match(h.options.onOpenSession(h.session.id).error,/尚未就绪/);
});

test('client uses the Remote event subscription and native workspace navigation, and disposes it', () => {
  let plugin,listener,unsubscribed=false;
  const opened=[],cleanups=[];
  const sandbox={window:{__ModuleLoader__:{load(entry){plugin=entry.factory(()=>({}));}}}};
  vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),sandbox);
  plugin.apply({
    inject(names,fn){assert.deepEqual(Array.from(names),['uiWorkspace','remote']);fn({
      effect:fn=>cleanups.push(fn()),
      remote:{$on(event,fn){assert.equal(event,'whale-pet/open-session');listener=fn;return()=>{unsubscribed=true;};}},
      uiWorkspace:{openSession:id=>opened.push(id)},
    });},
    effect:fn=>cleanups.push(fn()),
    locale:{register:()=>()=>{},bind:()=>()=>''},
    configForms:{get:()=>({}),whileServed:()=>()=>{}},
  });
  listener('target-session');listener('another-session');listener(null);listener('');
  assert.deepEqual(opened,['target-session','another-session']);
  cleanups.forEach(fn=>fn());assert.equal(unsubscribed,true);
});
