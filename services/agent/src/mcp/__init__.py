"""MCP (Model Context Protocol) support for external tool integration."""

from src.mcp.client import MCPClient, MCPTransport
from src.mcp.registry import MCPTool, MCPToolRegistry

__all__ = [
    "MCPClient",
    "MCPTool",
    "MCPToolRegistry",
    "MCPTransport",
]
