import type { DemoId } from '@/core/types';
import { ContextWindowDemo, LlmPipelineDemo, NeuralNetDemo, RuleVsModelDemo, TokenizerDemo } from './basic';
import { AgentLoopDemo, EvalDemo, InjectionDemo, MultiAgentDemo, RagDemo } from './systems';
import { TerminalDemo } from './Terminal';

export default function Demo({ id }: { id: DemoId }) {
  switch (id) {
    case 'tokenizer': return <TokenizerDemo />;
    case 'rule-vs-model': return <RuleVsModelDemo />;
    case 'neural-net': return <NeuralNetDemo />;
    case 'llm-pipeline': return <LlmPipelineDemo />;
    case 'context-window': return <ContextWindowDemo />;
    case 'agent-loop': return <AgentLoopDemo />;
    case 'rag': return <RagDemo />;
    case 'terminal': return <TerminalDemo />;
    case 'injection': return <InjectionDemo />;
    case 'multi-agent': return <MultiAgentDemo />;
    case 'eval': return <EvalDemo />;
  }
}
