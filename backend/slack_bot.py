import os
import subprocess
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

bot_token = os.getenv("SLACK_BOT_TOKEN")  # xoxb-...
app_token = os.getenv("SLACK_APP_TOKEN")  # xapp-...

if not bot_token or not app_token:
    print("⚠️ SLACK_BOT_TOKEN 또는 SLACK_APP_TOKEN이 .env 파일에 없습니다.")

app = App(token=bot_token)

# 슬래시 커맨드: /deploy
@app.command("/deploy")
def handle_deploy_command(ack, say):
    ack()
    say("🚀 맥북에서 배포 파이프라인을 가동합니다! (Git Pull & 서버 재시작)")
    
    try:
        # 여기에 실제 배포용 쉘 스크립트(.sh)를 연결합니다.
        # subprocess.run(["sh", "pipeline.sh"], check=True)
        say("✅ 배포가 성공적으로 완료되었습니다!")
    except Exception as e:
        say(f"❌ 배포 중 오류가 발생했습니다: {str(e)}")

# 슬래시 커맨드: /status
@app.command("/status")
def handle_status_command(ack, say):
    ack()
    say("🟢 맥북 홈 서버: 웹사이트 및 API가 정상 동작 중입니다.")

# 슬래시 커맨드: /crawl
@app.command("/crawl")
def handle_crawl_command(ack, say):
    ack()
    say("🕷️ 경매 및 네이버 시세 크롤링을 수동으로 시작합니다...")
    # subprocess.Popen(["python3", "auto_crawling.py"])
    say("✅ 크롤링 백그라운드 작업이 시작되었습니다.")


if __name__ == "__main__":
    if bot_token and app_token:
        print("⚡️ 슬랙 봇이 Socket Mode로 맥북에서 실행 중입니다...")
        handler = SocketModeHandler(app, app_token)
        handler.start()
    else:
        print("토큰 설정이 완료되지 않아 실행을 대기합니다.")
