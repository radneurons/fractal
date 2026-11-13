import type { School } from '@/core/types';

export const SCHOOLS: School[] = [
  { id: 's1', num: 1, title: 'AI Foundations', tagline: 'What AI is, how LLMs work, where they fail', level: 'beginner', hue: 168, description: 'Plain-language foundations: machine learning, neural networks, tokens, context windows, and the honest limits of language models.' },
  { id: 's2', num: 2, title: 'Effective AI Communication', tagline: 'Prompts that produce verifiable results', level: 'beginner', hue: 190, description: 'Write clear requests, supply context and constraints, specify formats, use examples, decompose work and verify the answers you get.' },
  { id: 's3', num: 3, title: 'Claude Essentials', tagline: 'Using Claude well, day to day', level: 'beginner', hue: 28, description: 'Capabilities, long documents, structured instructions, model selection and verification habits for Claude.' },
  { id: 's4', num: 4, title: 'Claude Code', tagline: 'From first command to power user', level: 'intermediate', hue: 20, description: 'Agentic coding in your terminal: instructions, reviewing diffs, CLAUDE.md, permissions, plan-first workflows, extensions and automation.' },
  { id: 's5', num: 5, title: 'OpenAI Codex', tagline: 'Professional Codex workflows', level: 'intermediate', hue: 140, description: 'Codex CLI and app workflows, AGENTS.md, sandbox and approval modes, automation, and choosing the right coding agent for a job.' },
  { id: 's6', num: 6, title: 'Programming for AI Builders', tagline: 'Just enough code to build with AI', level: 'beginner', hue: 210, description: 'Command line, JavaScript fundamentals, functions and data, errors, JSON & HTTP, async code, Git and tests.' },
  { id: 's7', num: 7, title: 'AI APIs & App Development', tagline: 'Calling models from your own code', level: 'intermediate', hue: 230, description: 'Requests and responses, keys and proxies, structured outputs, streaming, resilience and cost tracking.' },
  { id: 's8', num: 8, title: 'Agent Engineering Fundamentals', tagline: 'Loops, actions and stopping', level: 'intermediate', hue: 265, description: 'What makes an agent, the agent loop, action selection, termination, error recovery — and when not to build one.' },
  { id: 's9', num: 9, title: 'Tool Calling, MCP & Integrations', tagline: 'Connecting models to the world safely', level: 'intermediate', hue: 285, description: 'Function calling, schemas and validation, tool results, the Model Context Protocol and untrusted-content boundaries.' },
  { id: 's10', num: 10, title: 'Context, Memory & RAG', tagline: 'Grounding answers in real sources', level: 'advanced', hue: 305, description: 'Chunking, embeddings, retrieval strategies, grounding with citations, memory, and retrieval evaluation.' },
  { id: 's11', num: 11, title: 'Advanced Agent Architecture', tagline: 'Orchestration that terminates', level: 'advanced', hue: 325, description: 'Deterministic workflows, delegation, parallelism, durable state and termination guarantees.' },
  { id: 's12', num: 12, title: 'Evals, Debugging & Reliability', tagline: 'Measure before you trust', level: 'advanced', hue: 50, description: 'Why evals matter, datasets, graders, metrics and trace analysis.' },
  { id: 's13', num: 13, title: 'AI Security & Trust', tagline: 'Defend the trust boundary', level: 'advanced', hue: 0, description: 'Prompt injection, least privilege, secrets, sandboxing and confirmation before high-impact actions.' },
  { id: 's14', num: 14, title: 'AI Product Engineering', tagline: 'From user problem to shipped product', level: 'advanced', hue: 95, description: 'Requirements, MVP scoping, UX for AI including failure states, and monitoring in production.' },
  { id: 's15', num: 15, title: 'Professional AI Engineering', tagline: 'Operating AI systems at scale', level: 'expert', hue: 75, description: 'Observability, durable execution, CI/CD for AI systems and incident response.' },
  { id: 's16', num: 16, title: 'Frontier & Specialized Topics', tagline: 'Clearly-labelled electives', level: 'expert', hue: 245, description: 'Multimodal and computer-use agents, research agents and emerging standards. Fast-moving: always check primary docs.' },
];

export const schoolById = (id: string) => SCHOOLS.find((s) => s.id === id)!;
