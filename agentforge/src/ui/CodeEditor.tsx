import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { useLearner } from '@/store/learner';

export default function CodeEditor({ value, onChange, height = '260px', label, readOnly }: { value: string; onChange?: (v: string) => void; height?: string; label: string; readOnly?: boolean }) {
  const theme = useLearner((s) => s.settings.theme);
  const isLight = theme === 'light' || (theme !== 'contrast' && theme !== 'dark' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  return (
    <div className="editor-wrap">
      <CodeMirror
        value={value}
        height={height}
        theme={isLight ? 'light' : 'dark'}
        extensions={[javascript({ typescript: false })]}
        onChange={onChange}
        readOnly={readOnly}
        aria-label={label}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true, tabSize: 2 }}
      />
    </div>
  );
}
