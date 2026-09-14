from typing import Any, Awaitable, Callable, Optional, TypedDict


class DocumentAnalysisState(TypedDict, total=False):
    """Shared state threaded through every node of the graph."""

    text: str
    summary: str
    entities: dict
    keywords: list
    topics: list
    language: str
    document_type: str
    confidence: float
    result: dict
    error: Optional[str]

    # Internal — per-run callback: on_token(node_name, token_text) for
    # every raw token streamed from Ollama, used to relay live "thinking"
    # output. Must be declared here: LangGraph builds its channel schema
    # from this TypedDict's keys, so an undeclared key is silently
    # dropped when state passes between nodes.
    _on_token: Optional[Callable[[str, str], Awaitable[Any]]]
