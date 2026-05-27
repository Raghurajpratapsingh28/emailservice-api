import { describe, expect, it } from 'vitest';
import { ValidationError } from '@shared/errors/app-errors.js';
import { validateGraph } from '@modules/workflows/validators/graph-validator.js';
import type { WorkflowGraph } from '@shared/database/schema/workflows.js';

const validGraph: WorkflowGraph = {
  nodes: [
    { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'Trial Started' } },
    { id: 'email_1', type: 'email', config: { subject: 'Welcome!', fromEmail: 'hi@acme.com', html: '<h1>Hi</h1>' } },
    { id: 'delay_1', type: 'delay', config: { durationSeconds: 86400 } },
    { id: 'end_1', type: 'end' },
  ],
  edges: [
    { from: 'trigger_1', to: 'email_1' },
    { from: 'email_1', to: 'delay_1' },
    { from: 'delay_1', to: 'end_1' },
  ],
};

describe('validateGraph', () => {
  it('accepts a valid linear graph', () => {
    expect(() => validateGraph(validGraph)).not.toThrow();
  });

  it('rejects graph with no trigger node', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'email_1', type: 'email', config: { subject: 'Hi', fromEmail: 'a@b.com', html: '<p>x</p>' } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'email_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects graph with multiple trigger nodes', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 't1', type: 'trigger', config: { triggerType: 'event', eventName: 'A' } },
        { id: 't2', type: 'trigger', config: { triggerType: 'event', eventName: 'B' } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 't1', to: 'end_1' }, { from: 't2', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects graph with no end node', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'email_1', type: 'email', config: { subject: 'Hi', fromEmail: 'a@b.com', html: '<p>x</p>' } },
      ],
      edges: [{ from: 'trigger_1', to: 'email_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects graph with a cycle', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'email_1', type: 'email', config: { subject: 'Hi', fromEmail: 'a@b.com', html: '<p>x</p>' } },
        { id: 'delay_1', type: 'delay', config: { durationSeconds: 3600 } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [
        { from: 'trigger_1', to: 'email_1' },
        { from: 'email_1', to: 'delay_1' },
        { from: 'delay_1', to: 'email_1' }, // cycle
        { from: 'delay_1', to: 'end_1' },
      ],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects disconnected node', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'end_1', type: 'end' },
        { id: 'orphan', type: 'email', config: { subject: 'Hi', fromEmail: 'a@b.com', html: '<p>x</p>' } },
      ],
      edges: [{ from: 'trigger_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects edge referencing unknown node', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'nonexistent' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects trigger node missing triggerType', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: {} },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects event trigger missing eventName', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event' } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects email node missing subject', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'email_1', type: 'email', config: { fromEmail: 'a@b.com', html: '<p>x</p>' } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'email_1' }, { from: 'email_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects email node missing fromEmail', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'email_1', type: 'email', config: { subject: 'Hi', html: '<p>x</p>' } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'email_1' }, { from: 'email_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects email node missing html and templateId', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'email_1', type: 'email', config: { subject: 'Hi', fromEmail: 'a@b.com' } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'email_1' }, { from: 'email_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('accepts email node with templateId instead of html', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'email_1', type: 'email', config: { subject: 'Hi', fromEmail: 'a@b.com', templateId: 'tpl-1' } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'email_1' }, { from: 'email_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).not.toThrow();
  });

  it('rejects delay below minimum', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'delay_1', type: 'delay', config: { durationSeconds: 10 } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'delay_1' }, { from: 'delay_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects delay above maximum', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'delay_1', type: 'delay', config: { durationSeconds: 999999999 } },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'delay_1' }, { from: 'delay_1', to: 'end_1' }],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects unknown node type', () => {
    const g = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'sms_1', type: 'sms', config: {} },
        { id: 'end_1', type: 'end' },
      ],
      edges: [{ from: 'trigger_1', to: 'sms_1' }, { from: 'sms_1', to: 'end_1' }],
    } as unknown as WorkflowGraph;
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });

  it('rejects duplicate node ids', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
        { id: 'trigger_1', type: 'end' }, // duplicate
      ],
      edges: [],
    };
    expect(() => validateGraph(g)).toThrow(ValidationError);
  });
});
