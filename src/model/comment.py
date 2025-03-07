"""
Public API for notes/comments
"""

from dataclasses import dataclass, field


@dataclass
class Comment:
    id: int
    date: str
    text: str
    tags: list[str] = field(default_factory=lambda: [])
