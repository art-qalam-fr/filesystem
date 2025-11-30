import json
import os
from typing import Any, Dict, List, Optional, TypedDict

class ServerConfig(TypedDict, total=False):
    command: str
    args: List[str]
    env: Dict[str, str]
    cwd: Optional[str]
    enabled: bool

class GatewayConfig(TypedDict):
    servers: Dict[str, ServerConfig]

def load_config(path: str) -> GatewayConfig:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if 'servers' in data:
        return data  # legacy format
    if 'mcpServers' in data:
        return {'servers': data['mcpServers']}
    return {'servers': {}}

