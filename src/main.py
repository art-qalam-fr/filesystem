import asyncio
import json
import os
import pathlib
from typing import Dict, List, Optional, Tuple

from .config import load_config, ServerConfig, GatewayConfig
from .server_manager import ManagedProcess

EXCLUDES = {'.git','.venv','__pycache__','logs','node_modules'}

def _cleanup_llm_context(base_dir: str) -> None:
    root = pathlib.Path(base_dir)
    ctx_dir = root/'.llm-context'
    cfg = ctx_dir/'config.json'
    if not ctx_dir.exists():
        ctx_dir.mkdir(parents=True, exist_ok=True)
    if cfg.exists():
        try:
            data = json.loads(cfg.read_text(encoding='utf-8'))
            if 'profiles' not in data:
                cfg.unlink(missing_ok=True)
        except Exception:
            cfg.unlink(missing_ok=True)

def _discover_workspace_roots(base_dir: str) -> List[str]:
    roots: List[str] = []
    base = pathlib.Path(base_dir)
    for ws in base.glob('*.code-workspace'):
        try:
            data = json.loads(ws.read_text(encoding='utf-8'))
            folders = data.get('folders', [])
            for f in folders:
                p = f.get('path')
                if not p:
                    continue
                abs_p = pathlib.Path(base_dir)/p if not pathlib.Path(p).is_absolute() else pathlib.Path(p)
                if abs_p.exists():
                    roots.append(str(abs_p.resolve()))
        except Exception:
            pass
    for child in base.iterdir():
        if child.is_dir() and child.name not in EXCLUDES:
            roots.append(str(child.resolve()))
    dedup = []
    seen = set()
    for r in roots:
        if r not in seen:
            dedup.append(r)
            seen.add(r)
    return dedup

def _default_profile_payload(base_dir: str) -> Dict:
    full_files = []
    for name in ['.env','.gitignore','pyproject.toml','requirements.txt']:
        p = pathlib.Path(base_dir)/name
        if p.exists():
            full_files.append(name)
    outline_files = []
    src_dir = pathlib.Path(base_dir)/'src'
    if src_dir.exists():
        for py in src_dir.rglob('*.py'):
            outline_files.append(str(py.relative_to(base_dir)))
    return {
        'profile_name': 'code',
        'excluded': list(EXCLUDES),
        'full_files': full_files,
        'outline_files': outline_files,
    }

def _init_file_context_instance(base_dir: str) -> None:
    _cleanup_llm_context(base_dir)
    ctx_dir = pathlib.Path(base_dir)/'.llm-context'
    cfg = ctx_dir/'config.json'
    payload = {
        'profiles': {
            'code': _default_profile_payload(base_dir)
        },
        'root': base_dir,
    }
    cfg.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

def _duplicate_file_context(base_cfg: ServerConfig, roots: List[str]) -> Dict[str, ServerConfig]:
    clones: Dict[str, ServerConfig] = {}
    for i, r in enumerate(roots):
        name = f'file-context:{i}'
        args = list(base_cfg.get('args', []))
        if '--project-root' in args:
            idx = args.index('--project-root')
            if idx+1 < len(args):
                args[idx+1] = r
        else:
            args = args + ['--project-root', r]
        clone: ServerConfig = {
            'command': base_cfg.get('command', 'node'),
            'args': args,
            'env': base_cfg.get('env', {}),
            'cwd': r,
            'enabled': True,
        }
        clones[name] = clone
    return clones

async def _start_clones(clones: Dict[str, ServerConfig]) -> List[ManagedProcess]:
    tasks: List[ManagedProcess] = []
    for name, cfg in clones.items():
        mp = ManagedProcess(name, cfg['command'], cfg.get('args', []), cwd=cfg.get('cwd'), env=cfg.get('env'))
        await mp.start()
        tasks.append(mp)
    return tasks

async def _init_all_file_context(roots: List[str]) -> None:
    for r in roots:
        _init_file_context_instance(r)

async def main(config_path: str, base_dir: Optional[str] = None) -> None:
    cfg = load_config(config_path)
    servers = cfg.get('servers', {})
    fc_base = servers.get('file-context')
    if not fc_base:
        return
    scan_base = base_dir or fc_base.get('cwd') or os.getcwd()
    roots = _discover_workspace_roots(scan_base)
    clones = _duplicate_file_context(fc_base, roots)
    await _start_clones(clones)
    await _init_all_file_context(roots)

if __name__ == '__main__':
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.json')
    base = sys.argv[2] if len(sys.argv) > 2 else None
    asyncio.run(main(path, base))

