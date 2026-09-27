import os
import asyncio
import time
import re
from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler
from dotenv import load_dotenv

# Antigravity SDK 임포트
from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig, policy

# .env 로드
load_dotenv()

SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN")
SLACK_APP_TOKEN = os.environ.get("SLACK_APP_TOKEN")

# 비동기 슬랙 앱 초기화
app = AsyncApp(token=SLACK_BOT_TOKEN)

# 슬랙 스레드(대화 컨텍스트)별로 에이전트 큐 관리
agent_queues = {}

async def agent_task(thread_ts, channel_id):
    """특정 스레드를 전담하는 백그라운드 Antigravity 에이전트 태스크"""
    # 에이전트 설정 (파일 읽고 쓰기, 터미널 실행 등 모든 권한 부여)
    config = LocalAgentConfig(
        system_instructions="You are an expert Antigravity AI assistant managing the auction_agent project. You can run commands, edit files, and analyze code. Please answer in Korean.",
        capabilities=CapabilitiesConfig(),
        policies=[policy.allow_all()], # 터미널 실행 사전 승인(confirm_run_command) 해제
    )
    
    # async with 로 에이전트 생명주기 관리 (스레드가 이어지는 한 컨텍스트 유지)
    async with Agent(config) as agent:
        queue = agent_queues[thread_ts]
        while True:
            text, say = await queue.get()
            
            # 처리 시작 알림 메시지
            msg = await say(text="⏳ `agy` 에이전트가 작업을 시작했습니다... (코드 분석 및 툴 실행 중)", thread_ts=thread_ts)
            ts_to_update = msg["ts"]
            
            try:
                # 에이전트에게 메시지 전달 (비동기)
                response = await agent.chat(text)
                
                full_text = ""
                last_update_time = time.time()
                
                # 스트리밍으로 텍스트 수신 (슬랙 API Rate Limit 방지를 위해 1.5초마다 갱신)
                async for token in response:
                    full_text += token
                    
                    if time.time() - last_update_time > 1.5 and full_text.strip():
                        try:
                            await app.client.chat_update(
                                channel=channel_id,
                                ts=ts_to_update,
                                text=full_text + " ✍️..."
                            )
                            last_update_time = time.time()
                        except Exception:
                            pass # Rate Limit 등 에러 무시하고 다음 루프 진행
                
                # 최종 응답 업데이트
                final_text = full_text.strip() if full_text.strip() else "✅ 작업이 완료되었습니다. (반환 텍스트 없음)"
                await app.client.chat_update(
                    channel=channel_id,
                    ts=ts_to_update,
                    text=final_text
                )
                
            except Exception as e:
                await app.client.chat_update(
                    channel=channel_id,
                    ts=ts_to_update,
                    text=f"❌ 작업 중 오류가 발생했습니다:\n```{str(e)}```"
                )

async def process_message(event, say):
    text = event.get("text", "")
    channel_id = event["channel"]
    # 스레드가 있으면 해당 스레드 TS 유지, 없으면 현재 메시지를 스레드 시작점(TS)으로 사용
    thread_ts = event.get("thread_ts", event["ts"]) 
    
    # 멘션 아이디(<@U...>) 치환 (순수 텍스트만 에이전트에게 전달하기 위함)
    text = re.sub(r'<@U[A-Z0-9]+>', '', text).strip()
    
    if not text:
        return

    # 스레드별 에이전트 큐가 없으면 새로 생성 후 백그라운드 태스크 시작
    if thread_ts not in agent_queues:
        agent_queues[thread_ts] = asyncio.Queue()
        asyncio.create_task(agent_task(thread_ts, channel_id))
        
    await agent_queues[thread_ts].put((text, say))

@app.event("app_mention")
async def handle_app_mention(event, say):
    """채널에서 봇을 멘션했을 때"""
    await process_message(event, say)

@app.event("message")
async def handle_message_events(event, say):
    """DM으로 메시지를 보냈을 때"""
    # 봇 자신의 메시지는 무시
    if "bot_id" in event:
        return
    # DM 채널인 경우에만 기본 텍스트 응답 (채널은 멘션으로 처리)
    if event.get("channel_type") == "im":
        await process_message(event, say)

async def main():
    if not SLACK_BOT_TOKEN or not SLACK_APP_TOKEN:
        print("❌ 에러: .env 파일에 SLACK_BOT_TOKEN과 SLACK_APP_TOKEN 설정이 필요합니다.")
        return
        
    handler = AsyncSocketModeHandler(app, SLACK_APP_TOKEN)
    print("🚀 Antigravity Slack Bot (Socket Mode) 시작됨!")
    print("슬랙에서 봇을 멘션(@봇이름)하거나 DM으로 코딩 지시를 내려보세요.")
    
    await handler.start_async()

if __name__ == "__main__":
    asyncio.run(main())
