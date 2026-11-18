import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { useMemo } from 'react';
import { useLearner } from '@/store/learner';

// Lifts the two dark-theme token colours that fall just under WCAG AA 4.5:1 on the editor background.
const darkContrast = Prec.highest(syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: '#d59ae8' },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: '#ec8c93' },
])));

export default function CodeEditor({ value, onChange, height = '260px', label, readOnly, language = 'javascript' }: { value: string; onChange?: (v: string) => void; height?: string; label: string; readOnly?: boolean; language?: 'javascript' | 'python' }) {
  const theme = useLearner((s) => s.settings.theme);
  const isLight = theme === 'light' || (theme !== 'contrast' && theme !== 'dark' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  const extensions = useMemo(() => [
    language === 'python' ? python() : javascript({ typescript: false }),
    EditorView.contentAttributes.of({ 'aria-label': label, tabindex: '0' }),
    ...(isLight ? [] : [darkContrast]),
  ], [language, label, isLight]);
  return (
    <div className="editor-wrap">
      <CodeMirror
        value={value}
        height={height}
        theme={isLight ? 'light' : 'dark'}
        extensions={extensions}
        onChange={onChange}
        readOnly={readOnly}
        aria-label={label}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true, tabSize: language === 'python' ? 4 : 2 }}
      />
    </div>
  );
}
