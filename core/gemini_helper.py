import os
import json
import urllib.request
import urllib.error
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

# Gemini 모델 우선순위 (가장 빠르고 안정적인 무료 티어부터 순차 시도)
GEMINI_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
]

def get_gemini_key(api_key: Optional[str] = None) -> Optional[str]:
    k = api_key or os.getenv("GEMINI_API_KEY")
    return k if k and k.strip() else None

def call_gemini_json(
    prompt: str,
    system_prompt: Optional[str] = None,
    api_key: Optional[str] = None,
    temperature: float = 0.2,
    timeout: int = 25
) -> Optional[Dict[str, Any]]:
    """
    Gemini API를 호출하여 JSON 객체를 반환합니다.
    모든 지원 모델을 순차 시도하며, 실패 시 None을 반환합니다.
    """
    key = get_gemini_key(api_key)
    if not key:
        return None

    for model_name in GEMINI_MODELS:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={key}"
            payload: Dict[str, Any] = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": temperature
                }
            }
            if system_prompt:
                payload["system_instruction"] = {
                    "parts": [{"text": system_prompt}]
                }

            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                candidate = body.get("candidates", [{}])[0]
                text = candidate.get("content", {}).get("parts", [{}])[0].get("text", "")
                if text:
                    res = json.loads(text)
                    if isinstance(res, dict):
                        res["ai_model"] = f"gemini/{model_name}"
                        return res
                    elif isinstance(res, list):
                        return {"items": res, "ai_model": f"gemini/{model_name}"}
        except Exception as e:
            # 다음 모델로 자동 폴백 시도
            continue

    return None

def call_gemini_chat(
    user_message: str,
    system_prompt: Optional[str] = None,
    chat_history: Optional[List[Dict[str, str]]] = None,
    api_key: Optional[str] = None,
    temperature: float = 0.3,
    timeout: int = 25
) -> Optional[Dict[str, Any]]:
    """
    Gemini API를 호출하여 대화형 텍스트 응답을 반환합니다.
    chat_history(role: 'user' | 'assistant')를 Gemini 형식('user' | 'model')으로 자동 변환합니다.
    """
    key = get_gemini_key(api_key)
    if not key:
        return None

    for model_name in GEMINI_MODELS:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={key}"
            contents = []

            if chat_history and isinstance(chat_history, list):
                for msg in chat_history[-6:]:
                    if isinstance(msg, dict) and msg.get("content"):
                        role = "model" if msg.get("role") in ("assistant", "model") else "user"
                        contents.append({
                            "role": role,
                            "parts": [{"text": str(msg.get("content"))}]
                        })

            contents.append({
                "role": "user",
                "parts": [{"text": user_message}]
            })

            payload: Dict[str, Any] = {
                "contents": contents,
                "generationConfig": {
                    "temperature": temperature
                }
            }
            if system_prompt:
                payload["system_instruction"] = {
                    "parts": [{"text": system_prompt}]
                }

            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                candidate = body.get("candidates", [{}])[0]
                text = candidate.get("content", {}).get("parts", [{}])[0].get("text", "")
                if text:
                    return {
                        "reply": text,
                        "ai_model": f"gemini/{model_name}"
                    }
        except Exception as e:
            continue

    return None
