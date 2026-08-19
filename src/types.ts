export type RawTool = Record<string, any>;

export interface GraphNode {
  id: string;
  service?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Field {
  name: string;
  description: string;
  parentDefName?: string;
}

export interface NormalizedTool {
  slug: string;
  service?: string;
  isDeprecated: boolean;
  tags: string[];
  requiredInputs: Field[];
  allInputs: Field[];
  primaryOutputs: Field[];
}
