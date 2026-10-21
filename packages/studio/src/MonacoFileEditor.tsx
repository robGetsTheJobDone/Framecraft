import {useEffect, useRef, useState} from 'react';
import type {editor} from 'monaco-editor';
import './monaco.css';

type Props = {path: string; value: string; readOnly: boolean; onChange(value: string): void; onSave(): void};
const languageFor = (path: string) => {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return ({ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', md: 'markdown', json: 'json', css: 'css', html: 'html', yaml: 'yaml', yml: 'yaml'} as Record<string, string>)[extension ?? ''] ?? 'plaintext';
};

export function MonacoFileEditor(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | undefined>(undefined);
  const latest = useRef(props); latest.current = props;
  const [status, setStatus] = useState('Loading code editor…');
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    setStatus('Loading code editor…');
    void import('./monaco-runtime.js').then(({monaco}) => {
      if (disposed || !container.current) return;
      const model = monaco.editor.createModel(latest.current.value, languageFor(props.path));
      const editor = monaco.editor.create(container.current, {
        model, theme: 'vs-dark', automaticLayout: true, readOnly: latest.current.readOnly,
        ariaLabel: 'File contents', accessibilitySupport: 'on',
        minimap: {enabled: false}, fontSize: 13, lineHeight: 20, tabSize: 2,
        scrollBeyondLastLine: false, wordWrap: 'on', padding: {top: 12, bottom: 12},
        fixedOverflowWidgets: true, renderWhitespace: 'selection',
      });
      instance.current = editor;
      const change = editor.onDidChangeModelContent(() => latest.current.onChange(editor.getValue()));
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.onSave());
      cleanup = () => {change.dispose(); editor.dispose(); model.dispose(); if (instance.current === editor) instance.current = undefined;};
      setStatus('');
    }).catch(error => {if (!disposed) setStatus(`Code editor could not load: ${error instanceof Error ? error.message : String(error)}`);});
    return () => {disposed = true; cleanup?.();};
  }, [props.path]);
  useEffect(() => {
    const editor = instance.current;
    if (editor && editor.getValue() !== props.value) {
      const view = editor.saveViewState();
      editor.setValue(props.value);
      editor.restoreViewState(view);
    }
  }, [props.value]);
  useEffect(() => {instance.current?.updateOptions({readOnly: props.readOnly});}, [props.readOnly]);
  return <div className="studio-code-editor">
    {status && <p role="status">{status}</p>}
    <div ref={container} className="studio-monaco-surface" />
  </div>;
}
