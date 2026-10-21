import {describe,it,expect} from 'vitest';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {createProjectStore,createStudioProject,validateProject,conversationWorkspacePath} from '../src/index';

describe('project validation',()=>{
  it('rejects malformed data, invalid references and nonfinite time',()=>{
    expect(validateProject(null)).not.toHaveLength(0);
    const project=createStudioProject();
    project.tracks[0].clips.push({id:'clip',kind:'video',assetId:'missing',startSeconds:NaN,durationSeconds:3,sourceStartSeconds:0});
    expect(validateProject(project).map(i=>i.path)).toContain('tracks.0.clips.0.assetId');
    expect(validateProject(project).map(i=>i.path)).toContain('tracks.0.clips.0.startSeconds');
  });
  it('checks source and project bounds, kinds and fade overlap',()=>{
    const p=createStudioProject({durationSeconds:5});
    p.assets.push({id:'a',kind:'audio',path:'assets/a.wav',mimeType:'audio/wav',durationSeconds:4});
    p.tracks[1].clips.push({id:'clip',kind:'audio',assetId:'a',startSeconds:3,sourceStartSeconds:2,durationSeconds:3,fadeInSeconds:2,fadeOutSeconds:2});
    const messages=validateProject(p).map(i=>i.message);
    expect(messages).toContain('Extends beyond project duration');
    expect(messages).toContain('Extends beyond source duration');
    expect(messages).toContain('Audio fades must not overlap');
    p.assets[0].kind='video';
    expect(validateProject(p).map(i=>i.message)).toContain('Missing or mismatched media asset');
  });
  it('rejects unsafe assets paths and duplicate clip IDs',()=>{
    const p=createStudioProject();
    p.assets.push({id:'bad',kind:'image',path:'assets/../project.json',mimeType:'image/png'});
    p.tracks[3].clips.push({id:'same',kind:'text',text:'a',startSeconds:0,durationSeconds:1},{id:'same',kind:'text',text:'b',startSeconds:1,durationSeconds:1});
    expect(validateProject(p).map(i=>i.path)).toContain('assets.0.path');
    expect(validateProject(p).some(i=>i.message.includes('Duplicate'))).toBe(true);
  });
});
describe('conversation workspaces',()=>{
  it('seeds once, isolates paths and survives a new store instance',async()=>{
    const fs=new MemoryFileSystem();
    const a=createProjectStore(fs,'../one'); const b=createProjectStore(fs,'one');
    const project=await a.seed({title:'First'}); await b.seed({title:'Second'});
    project.title='Edited'; await a.save(project);
    await a.filesystem.writeFile('/brief.md','Keep me');
    expect((await a.seed({title:'Do not reset'})).title).toBe('Edited');
    expect((await b.load()).title).toBe('Second');
    expect((await createProjectStore(fs,'../one').load()).title).toBe('Edited');
    expect(new TextDecoder().decode(await a.filesystem.readFile('/brief.md'))).toBe('Keep me');
    expect((await a.filesystem.list('/')).every(f=>!f.path.startsWith('/conversations'))).toBe(true);
    await expect(a.filesystem.readFile('/../../one/project.json')).rejects.toThrow();
    expect(conversationWorkspacePath('a/b')).not.toBe(conversationWorkspacePath('a%2Fb'));
  });
  it('does not replace corrupt project JSON',async()=>{
    const store=createProjectStore(new MemoryFileSystem(),'corrupt'); await store.seed();
    await store.filesystem.writeFile('/project.json','{"schemaVersion":900}');
    await expect(store.seed()).rejects.toThrow('Invalid studio project');
    expect(new TextDecoder().decode(await store.filesystem.readFile('/project.json'))).toContain('900');
  });
  it('serializes concurrent read-modify-write operations and rejects stale snapshots',async()=>{
    const store=createProjectStore(new MemoryFileSystem(),'updates'); await store.seed();
    const stale=await store.load(); const token=JSON.stringify(stale);
    await Promise.all([
      store.update(async p=>{ await Promise.resolve(); p.title='New title'; }),
      store.update(p=>{ p.durationSeconds=60; }),
    ]);
    expect((await store.load()).title).toBe('New title');
    expect((await store.load()).durationSeconds).toBe(60);
    await expect(store.save(stale,{expectedProjectJson:token})).rejects.toThrow('Project changed');
    await expect(store.update(p=>{ p.durationSeconds=-1; })).rejects.toThrow('Invalid studio project');
    expect((await store.load()).durationSeconds).toBe(60);
    const latest=await store.load();
    await expect(store.save({...latest,title:'Safe edit'},{expectedProjectJson:JSON.stringify(latest)})).resolves.toHaveProperty('id');
  });
  it('captures queued snapshots and leaves current project intact when publication fails',async()=>{
    const fs=new MemoryFileSystem(); const store=createProjectStore(fs,'snapshot'); await store.seed();
    const project=await store.load(); project.title='Captured';
    const pending=store.save(project); project.title='Changed after save';
    const revision=await pending;
    expect(revision.title).toBe('Captured');
    expect((await store.load()).title).toBe('Captured');
    const failingFs={
      readFile:fs.readFile.bind(fs),stat:fs.stat.bind(fs),list:fs.list.bind(fs),mkdir:fs.mkdir.bind(fs),remove:fs.remove.bind(fs),
      writeFile:async (...args:Parameters<typeof fs.writeFile>)=>{
        if(args[0].endsWith('/project.json')) throw new Error('Storage failed');
        return fs.writeFile(...args);
      },
    };
    await expect(createProjectStore(failingFs,'snapshot').save(project)).rejects.toThrow('Storage failed');
    expect((await store.load()).title).toBe('Captured');
    // The immutable attempted revision remains recoverable after partial multi-file failure.
    expect(await store.listRevisions()).toHaveLength(2);
  });
  it('supports concurrent seeding, immutable assets, and revision restore',async()=>{
    const fs=new MemoryFileSystem(); const store=createProjectStore(fs,'test');
    await Promise.all([store.seed(),createProjectStore(fs,'test').seed()]);
    const asset=await store.writeAsset({id:'voice',kind:'audio',mimeType:'audio/wav'},new Uint8Array([1,2]));
    await expect(store.writeAsset({id:'voice',kind:'audio',mimeType:'audio/wav'},new Uint8Array([3]))).rejects.toThrow('EEXIST');
    const project=await store.load(); project.assets.push(asset); project.title='First';
    const first=await store.save(project); project.title='Second'; await store.save(project);
    expect((await store.restoreRevision(first.id)).title).toBe('First');
    expect((await store.load()).title).toBe('First');
    expect(await store.listRevisions()).toHaveLength(3);
  });
});
