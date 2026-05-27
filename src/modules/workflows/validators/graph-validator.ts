import { ValidationError } from '@shared/errors/app-errors.js';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '@shared/database/schema/workflows.js';

export interface GraphValidationError {
  code: string;
  message: string;
  nodeId?: string;
}

const MIN_DELAY_SECONDS = 60;
const MAX_DELAY_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Validates an MVP workflow graph.
 * Throws ValidationError with code INVALID_WORKFLOW_GRAPH on failure.
 */
export function validateGraph(graph: WorkflowGraph): void {
  const errors: GraphValidationError[] = [];

  const { nodes, edges } = graph;

  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new ValidationError('Graph must have at least one node', { code: 'INVALID_WORKFLOW_GRAPH' });
  }
  if (!Array.isArray(edges)) {
    throw new ValidationError('Graph edges must be an array', { code: 'INVALID_WORKFLOW_GRAPH' });
  }

  // ─── Node id uniqueness ───────────────────────────────────────────────────
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node.id || typeof node.id !== 'string') {
      errors.push({ code: 'INVALID_NODE', message: 'Node missing id' });
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push({ code: 'INVALID_NODE', message: `Duplicate node id: ${node.id}`, nodeId: node.id });
    }
    nodeIds.add(node.id);
  }

  // ─── Node type validation ─────────────────────────────────────────────────
  const validTypes = new Set(['trigger', 'email', 'delay', 'end']);
  for (const node of nodes) {
    if (!validTypes.has(node.type)) {
      errors.push({ code: 'INVALID_NODE', message: `Unknown node type: ${node.type}`, nodeId: node.id });
    }
  }

  // ─── Exactly one trigger ──────────────────────────────────────────────────
  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) {
    errors.push({ code: 'INVALID_WORKFLOW_GRAPH', message: 'Workflow must have exactly one trigger node' });
  } else if (triggers.length > 1) {
    errors.push({ code: 'INVALID_WORKFLOW_GRAPH', message: 'Workflow must have exactly one trigger node' });
  }

  // ─── At least one end ─────────────────────────────────────────────────────
  const ends = nodes.filter((n) => n.type === 'end');
  if (ends.length === 0) {
    errors.push({ code: 'INVALID_WORKFLOW_GRAPH', message: 'Workflow must have at least one end node' });
  }

  // ─── Edge references ──────────────────────────────────────────────────────
  for (const edge of edges) {
    if (!edge.from || !edge.to) {
      errors.push({ code: 'INVALID_EDGE', message: 'Edge missing from/to' });
      continue;
    }
    if (!nodeIds.has(edge.from)) {
      errors.push({ code: 'INVALID_EDGE', message: `Edge references unknown node: ${edge.from}` });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({ code: 'INVALID_EDGE', message: `Edge references unknown node: ${edge.to}` });
    }
  }

  // ─── Node config validation ───────────────────────────────────────────────
  for (const node of nodes) {
    const nodeErrors = validateNodeConfig(node);
    errors.push(...nodeErrors);
  }

  // ─── Cycle detection (DFS) ────────────────────────────────────────────────
  if (errors.length === 0) {
    const adj = buildAdjacency(nodes, edges);
    if (hasCycle(adj, nodeIds)) {
      errors.push({ code: 'INVALID_WORKFLOW_GRAPH', message: 'Workflow graph contains a cycle' });
    }
  }

  // ─── Connectivity: all nodes reachable from trigger ───────────────────────
  if (errors.length === 0 && triggers.length === 1) {
    const adj = buildAdjacency(nodes, edges);
    const reachable = bfsReachable(triggers[0]!.id, adj);
    for (const id of nodeIds) {
      if (!reachable.has(id)) {
        errors.push({ code: 'INVALID_WORKFLOW_GRAPH', message: `Node ${id} is not reachable from trigger` });
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError('Invalid workflow graph', { code: 'INVALID_WORKFLOW_GRAPH', errors });
  }
}

function validateNodeConfig(node: WorkflowNode): GraphValidationError[] {
  const errs: GraphValidationError[] = [];
  const cfg = node.config ?? {};

  switch (node.type) {
    case 'trigger': {
      const validTriggerTypes = ['event', 'segment_enter', 'manual'];
      if (!cfg.triggerType || !validTriggerTypes.includes(cfg.triggerType as string)) {
        errs.push({ code: 'INVALID_NODE', message: `Trigger node requires valid triggerType`, nodeId: node.id });
      }
      if (cfg.triggerType === 'event' && !cfg.eventName) {
        errs.push({ code: 'INVALID_NODE', message: `Event trigger requires eventName`, nodeId: node.id });
      }
      break;
    }
    case 'email': {
      if (!cfg.subject || typeof cfg.subject !== 'string') {
        errs.push({ code: 'INVALID_NODE', message: `Email node requires subject`, nodeId: node.id });
      }
      if (!cfg.fromEmail || typeof cfg.fromEmail !== 'string') {
        errs.push({ code: 'INVALID_NODE', message: `Email node requires fromEmail`, nodeId: node.id });
      }
      if (!cfg.html && !cfg.templateId) {
        errs.push({ code: 'INVALID_NODE', message: `Email node requires html or templateId`, nodeId: node.id });
      }
      break;
    }
    case 'delay': {
      const dur = cfg.durationSeconds;
      if (typeof dur !== 'number' || !Number.isInteger(dur)) {
        errs.push({ code: 'INVALID_NODE', message: `Delay node requires integer durationSeconds`, nodeId: node.id });
      } else if (dur < MIN_DELAY_SECONDS) {
        errs.push({ code: 'INVALID_NODE', message: `Delay durationSeconds must be >= ${MIN_DELAY_SECONDS}`, nodeId: node.id });
      } else if (dur > MAX_DELAY_SECONDS) {
        errs.push({ code: 'INVALID_NODE', message: `Delay durationSeconds must be <= ${MAX_DELAY_SECONDS}`, nodeId: node.id });
      }
      break;
    }
    case 'end':
      // no config required
      break;
  }
  return errs;
}

function buildAdjacency(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) list.push(e.to);
  }
  return adj;
}

function hasCycle(adj: Map<string, string[]>, nodeIds: Set<string>): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) return true;
      if (color.get(v) === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE && dfs(id)) return true;
  }
  return false;
}

function bfsReachable(start: string, adj: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const u = queue.shift()!;
    if (visited.has(u)) continue;
    visited.add(u);
    for (const v of adj.get(u) ?? []) queue.push(v);
  }
  return visited;
}
