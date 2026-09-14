#!/usr/bin/env python3
"""작업일지 MCP Server — auction_agent"""

import json
import sys
from datetime import datetime
from pathlib import Path

WIKI_PATH = Path("/Users/seonjin/vscode_project/wiki/작업일지/auction_agent")

TOOLS = [
    {
        "name": "read_today",
        "description": "오늘 날짜의 작업일지를 읽습니다.",
        "inputSchema": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "read_entry",
        "description": "특정 날짜의 작업일지를 읽습니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "날짜 (YYYY-MM-DD 형식)"}
            },
            "required": ["date"]
        }
    },
    {
        "name": "list_entries",
        "description": "작업일지 전체 목록을 날짜 역순으로 반환합니다.",
        "inputSchema": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "write_today",
        "description": "오늘 작업일지를 새로 작성하거나 덮어씁니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "마크다운 형식의 일지 내용"}
            },
            "required": ["content"]
        }
    },
    {
        "name": "append_today",
        "description": "오늘 작업일지 하단에 내용을 추가합니다. 없으면 새로 만듭니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "추가할 마크다운 내용"}
            },
            "required": ["content"]
        }
    }
]


def handle_tool(name: str, args: dict) -> str:
    today = datetime.now().strftime("%Y-%m-%d")

    if name == "read_today":
        path = WIKI_PATH / f"{today}.md"
        return path.read_text(encoding="utf-8") if path.exists() else f"오늘({today}) 작업일지가 없습니다."

    elif name == "read_entry":
        date = args.get("date", today)
        path = WIKI_PATH / f"{date}.md"
        return path.read_text(encoding="utf-8") if path.exists() else f"{date} 일지가 없습니다."

    elif name == "list_entries":
        entries = sorted(WIKI_PATH.glob("*.md"), reverse=True)
        return "\n".join(e.stem for e in entries) if entries else "작업일지가 없습니다."

    elif name == "write_today":
        content = args.get("content", "")
        path = WIKI_PATH / f"{today}.md"
        path.write_text(content, encoding="utf-8")
        return f"{today}.md 저장 완료"

    elif name == "append_today":
        content = args.get("content", "")
        path = WIKI_PATH / f"{today}.md"
        if path.exists():
            existing = path.read_text(encoding="utf-8")
            path.write_text(existing + "\n" + content, encoding="utf-8")
        else:
            path.write_text(content, encoding="utf-8")
        return f"{today}.md 추가 완료"

    return f"알 수 없는 도구: {name}"


def send(obj: dict):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = req.get("method", "")
        req_id = req.get("id")

        if method == "initialize":
            send({
                "jsonrpc": "2.0", "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "wiki-mcp", "version": "1.0.0"}
                }
            })

        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}})

        elif method == "tools/call":
            params = req.get("params", {})
            try:
                result = handle_tool(params.get("name", ""), params.get("arguments", {}))
                send({
                    "jsonrpc": "2.0", "id": req_id,
                    "result": {"content": [{"type": "text", "text": result}]}
                })
            except Exception as e:
                send({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}})

        elif method == "notifications/initialized":
            pass

        elif req_id is not None:
            send({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}})


if __name__ == "__main__":
    main()
