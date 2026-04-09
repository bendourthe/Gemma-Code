/**
 * Tool call parsing and formatting for the Gemma 4 native protocol.
 *
 * This module re-exports from Gemma4ToolFormat to maintain a single import
 * point for consumers (AgentLoop, StreamingPipeline). The underlying
 * implementation uses Gemma 4's native `<|tool_call>` / `<|tool_result>`
 * tokens instead of the legacy XML protocol.
 */
export {
  parseToolCalls,
  hasToolCall,
  stripToolCalls,
  formatToolResult,
  type ParseResult,
} from "./Gemma4ToolFormat.js";
