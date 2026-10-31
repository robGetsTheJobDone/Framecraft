import {useEffect,useRef,useState} from 'react';
import {prepareVoiceoverRecording} from '@deepbench/browser-studio';
import type {StudioClip} from '@deepbench/studio-project';

type Take={text:string;blob:Blob;duration:number;url:string};
type Props={clip:Extract<StudioClip,{kind:'voiceover'}>;onApply(takes:Array<{text:string;blob:Blob}>,expectedClip:string):Promise<void>};
export function VoiceoverRecorder({clip,onApply}:Props){
 const [script,setScript]=useState(clip.script);
 const expectedClip=useRef(JSON.stringify(clip));
 const [lines,setLines]=useState<string[]>();
 const [takes,setTakes]=useState<Record<number,Take>>({});
 const [line,setLine]=useState(0);
 const [phase,setPhase]=useState<'idle'|'permission'|'recording'|'processing'|'saving'>('idle');
 const [elapsed,setElapsed]=useState(0);
 const [error,setError]=useState('');
 const recorder=useRef<MediaRecorder | undefined>(undefined);const stream=useRef<MediaStream | undefined>(undefined);const alive=useRef(true);const urls=useRef(new Set<string>());const timer=useRef<ReturnType<typeof setInterval> | undefined>(undefined);
 const cleanup=()=>{clearInterval(timer.current);stream.current?.getTracks().forEach(track=>track.stop());stream.current=undefined;};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;const current=recorder.current;if(current?.state==='recording')current.stop();cleanup();urls.current.forEach(url=>URL.revokeObjectURL(url));};},[]);
 const total=Object.values(takes).reduce((sum,take)=>sum+take.duration,0);
 const stop=()=>{if(recorder.current?.state==='recording'){setPhase('processing');recorder.current.stop();clearInterval(timer.current);}};
 const record=async()=>{
  if(phase!=='idle'||!lines)return;
  setError('');setPhase('permission');
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Microphone recording is unavailable in this browser. Open the studio on HTTPS or localhost.');
   const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   if(!alive.current){microphone.getTracks().forEach(track=>track.stop());return;}
   stream.current=microphone;
   const mimeType=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
   const current=new MediaRecorder(microphone,mimeType?{mimeType}:undefined);recorder.current=current;
   const chunks:Blob[]=[];const index=line;const text=lines[index];
   current.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
   current.onerror=()=>{cleanup();if(alive.current){setError('Recording failed. Please try this line again.');setPhase('idle');}};
   current.onstop=()=>{cleanup();if(!alive.current)return;setPhase('processing');void (async()=>{
    const audio=await prepareVoiceoverRecording(new Blob(chunks,{type:current.mimeType}));
    if(!alive.current)return;
    if(audio.durationSeconds<=0)throw new Error('No audio captured. Please record this line again.');
    const blob=audio.blob,url=URL.createObjectURL(blob);urls.current.add(url);
    const previous=takes[index];if(previous){URL.revokeObjectURL(previous.url);urls.current.delete(previous.url);}
    setTakes(old=>({...old,[index]:{text,blob,duration:audio.durationSeconds,url}}));
   })().catch(error=>{if(alive.current)setError(String(error));}).finally(()=>{if(alive.current)setPhase('idle');});};
   current.start();setElapsed(0);setPhase('recording');const started=performance.now();
   timer.current=setInterval(()=>{const seconds=(performance.now()-started)/1000;setElapsed(seconds);if(seconds>=clip.durationSeconds)stop();},100);
  }catch(error){cleanup();if(alive.current){setError(error instanceof DOMException&&error.name==='NotAllowedError'?'Microphone access was denied. Allow it in your browser, then try again.':String(error));setPhase('idle');}}
 };
 const busy=phase!=='idle';const complete=!!lines?.length&&lines.every((_,index)=>takes[index]);
 return <div className="voiceover-recorder"><span className="eyebrow">RECORD YOUR VOICE</span><h2>{clip.title}</h2><p>{clip.startSeconds.toFixed(1)}s–{(clip.startSeconds+clip.durationSeconds).toFixed(1)}s · {clip.durationSeconds.toFixed(1)} seconds available</p>
 {error&&<p role="alert">{error}</p>}
 {!lines?<><p>Put each spoken line on its own line. The teleprompter records one line at a time using your microphone. Pause the video preview or use headphones while recording.</p><textarea aria-label="Voiceover script" placeholder="One spoken line per row" rows={8} maxLength={4096} value={script} onChange={event=>setScript(event.target.value)}/><button type="button" className="primary" disabled={!script.trim()} onClick={()=>{const parts=script.split(/\n+/).map(line=>line.trim()).filter(Boolean);setLines(parts.length>1?parts:script.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(line=>line.trim()).filter(Boolean)??[script.trim()]);}}>Open teleprompter</button></>:<>
 <p>Line {line+1} of {lines.length} · {phase==='recording'?`Recording ${elapsed.toFixed(1)}s`:phase==='permission'?'Waiting for microphone permission…':phase==='processing'?'Preparing playback…':'Read at your own pace, then stop.'}</p>
 <div className="teleprompter-line" aria-live="polite">{lines[line]}</div>
 <div className="settings-actions" role="group" aria-label="Recording controls"><button type="button" disabled={busy||line===0} onClick={()=>setLine(line-1)}>Previous line</button>{phase==='recording'?<button type="button" className="primary" onClick={stop}>Stop recording</button>:<button type="button" className="primary" disabled={busy} aria-label={takes[line]?`Retake line ${line+1}`:`Record line ${line+1}`} onClick={()=>void record()}>{takes[line]?'Retake line':'Record line'}</button>}<button type="button" disabled={busy||!takes[line]||line===lines.length-1} onClick={()=>setLine(line+1)}>Next line</button></div>
 {takes[line]&&<audio aria-label="Recorded line playback" src={takes[line].url} controls/>}
 <p>{Object.keys(takes).length}/{lines.length} lines recorded · {total.toFixed(1)}s / {clip.durationSeconds.toFixed(1)}s. Takes are placed consecutively from {clip.startSeconds.toFixed(1)}s.</p>
 {total>clip.durationSeconds&&<p role="alert">These takes exceed the voiceover slot. Retake shorter lines or extend the slot in the timeline before recording again. Nothing will be cut off.</p>}
 <p className="muted">Listen to each take and retake as needed. Closing this window discards unapplied recordings.</p>
 <button type="button" disabled={busy||!complete||total>clip.durationSeconds} onClick={()=>{setPhase('saving');setError('');void onApply(lines.map((_,index)=>({text:takes[index].text,blob:takes[index].blob})),expectedClip.current).catch(error=>setError(String(error))).finally(()=>{if(alive.current)setPhase('idle');});}} className="primary">Add recordings to timeline</button>
 </>}
 </div>;
}
