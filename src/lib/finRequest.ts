/** Questions are read-only; document proposals still go through their separate review. */
export function isFinQuestion(command:string) {
  return /^(?:fin[, :]*)?(?:who|what|when|where|why|how|which|show|tell|do|does|is|are|can|could|would|give|have)\b|\?\s*$/i.test(command) || !/\b(?:create|make|draft|prepare|write|generate|start|schedule|record|add|convert|cancel|delete|send|mark|update)\b/i.test(command)
}
