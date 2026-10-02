import os
from typing import Dict, Any

def should_show_clone(name: str) -> bool:
    flag = os.environ.get('GATEWAY_FC_SHOW_CLONES', '0')
    if flag == '1':
        return True
    return not name.startswith('file-context:')

