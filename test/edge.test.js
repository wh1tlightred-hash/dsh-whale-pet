import { test } from 'node:test';
import assert from 'node:assert/strict';
import edge from '../desktop/edge.cjs';
const pet = {x:380,y:800,width:120,height:160};
const area = {x:0,y:0,width:1920,height:1080};
test('dragging far beyond any corner keeps the pet in the work area and preserves side docking', () => {
  for (const monitor of [area,{x:-1920,y:-300,width:1920,height:1080}]) {
    for (const scale of [.6,1,1.6]) {
      const p={...pet,width:120*scale,height:160*scale};
      for (const x of [-10000,10000]) for (const y of [-10000,10000]) {
        const b=edge.clampPetBounds({x,y,width:536,height:1080},p,monitor);
        assert.ok(b.x+p.x>=monitor.x && b.y+p.y>=monitor.y);
        assert.ok(b.x+p.x+p.width<=monitor.x+monitor.width);
        assert.ok(b.y+p.y+p.height<=monitor.y+monitor.height);
        assert.equal(edge.sideAt(b,p,monitor),x<0?'left':'right');
      }
    }
  }
});
test('edge attraction strengthens toward the docking threshold on either side', () => {
  assert.equal(edge.hintAt({x:0,y:0,width:536,height:1080},pet,area), null);
  for (const x of [-340,-380,1380,1420]) {
    const b={x,y:0,width:536,height:1080};
    const hint=edge.hintAt(b,pet,area);
    assert.ok(hint);
    assert.equal(hint.ready, x===-380 || x===1420);
    assert.equal(hint.strength, hint.ready ? 1 : .56);
  }
});
test('edge detection uses pet position rather than transparent window edge', () => {
  assert.equal(edge.sideAt({x:0},pet,area),null);
  assert.equal(edge.sideAt({x:-380},pet,area),'left');
  assert.equal(edge.sideAt({x:1420},pet,area),'right');
});
test('dock keeps the head accessible on either edge and clamps its height', () => {
  for (const side of ['left','right']) {
    const b=edge.dockBounds({x:0,y:1000,width:536,height:1080},pet,area,side);
    assert.equal(edge.sideAt(b,pet,area),side);
    assert.ok(b.y+pet.y+pet.height<=1080);
    assert.ok(b.x+pet.x+pet.width>0 && b.x+pet.x<1920);
  }
});
test('negative origin and scaled pet sizes use the selected display coordinates', () => {
  const monitor={x:-1920,y:-200,width:1920,height:1080};
  const scaled={x:300,y:600,width:192,height:256};
  const b=edge.dockBounds({x:-2000,y:-800,width:600,height:1080},scaled,monitor,'left');
  assert.equal(edge.sideAt(b,scaled,monitor),'left');
  assert.equal(b.y+scaled.y,-200);
});

test('floor anticipation uses feet and strengthens near landing, with side priority', () => {
  for (const area of [{x:0,y:0,width:1920,height:1080},{x:-1920,y:-300,width:1920,height:1080}]) {
    for (const scale of [.6,1,1.6]) {
      const p={...pet,width:120*scale,height:160*scale};
      const snap=Math.max(48,p.height*.16+16);
      const bounds=gap=>({x:area.x+300-p.x,y:area.y+area.height-p.y-p.height*.84-gap});
      assert.equal(edge.hintAt(bounds(snap+33),p,area),null);
      const near=edge.hintAt(bounds(snap+20),p,area);
      assert.equal(near.side,'bottom'); assert.equal(near.ready,false);
      const ready=edge.hintAt(bounds(10),p,area);
      assert.equal(ready.ready,true); assert.ok(ready.strength>near.strength);
      assert.equal(edge.hintAt(bounds(0),p,area).strength,1);
      assert.equal(edge.hintAt({...bounds(0),x:area.x-p.x},p,area).side,'left');
    }
  }
});
