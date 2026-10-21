import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';

// A local module worker keeps this embeddable without a CDN or host configuration.
// Respect an environment supplied by an application already using Monaco.
const host = globalThis as typeof globalThis & {MonacoEnvironment?: monaco.Environment};
if (!host.MonacoEnvironment?.getWorker && !host.MonacoEnvironment?.getWorkerUrl) {
  host.MonacoEnvironment = {...host.MonacoEnvironment, getWorker: () => new Worker(new URL('./monaco-editor.worker.js', import.meta.url), {type: 'module', name: 'deepbench-editor'})};
}
if (!monaco.languages.getLanguages().some(language => language.id === 'json')) {
  monaco.languages.register({id: 'json', extensions: ['.json']});
  monaco.languages.setMonarchTokensProvider('json', {tokenizer: {root: [
    [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'key'], [/"(?:[^"\\]|\\.)*"/, 'string'],
    [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'], [/\b(?:true|false|null)\b/, 'keyword'],
    [/[{}\[\]]/, '@brackets'], [/[,:]/, 'delimiter'],
  ]}});
  monaco.languages.setLanguageConfiguration('json', {brackets: [['{', '}'], ['[', ']']], autoClosingPairs: [{open: '{', close: '}'}, {open: '[', close: ']'}, {open: '"', close: '"'}]});
}
export {monaco};
