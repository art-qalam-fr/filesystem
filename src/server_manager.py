import asyncio
import os
import sys
import subprocess
from typing import Dict, List, Optional

class ManagedProcess:
    def __init__(self, name: str, command: str, args: List[str], cwd: Optional[str] = None, env: Optional[Dict[str,str]] = None):
        self.name = name
        self.command = command
        self.args = args
        self.cwd = cwd
        self.env = env or {}
        self.proc: Optional[subprocess.Popen] = None

    async def start(self):
        merged_env = os.environ.copy()
        merged_env.update(self.env)
        self.proc = subprocess.Popen([self.command] + self.args, cwd=self.cwd or None, env=merged_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    async def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                await asyncio.sleep(0.2)
            except Exception:
                pass

