import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { useLearner } from '@/store/learner';

export default function CodeEditor({ value, onChange, height = '260px', label, readOnly, language = 'javascript' }: { value: string; onChange?: (v: string) => void; height?: string; label: string; readOnly?: boolean; language?: 'javascript' | 'python' }) {
  const theme = useLearner((s) => s.settings.theme);
  const isLight = theme === 'light' || (theme !== 'contrast' && theme !== 'dark' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  return (
    <div className="editor-wrap">
      <CodeMirror
        value={value}
        height={height}
        theme={isLight ? 'light' : 'dark'}
        extensions={[language === 'python' ? python() : javascript({ typescript: false })]}
        onChange={onChange}
        readOnly={readOnly}
        aria-label={label}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true, tabSize: language === 'python' ? 4 : 2 }}
      />
    </div>
  );
}
