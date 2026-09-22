# TouchDesigner WebSocket DAT Callbacks
#
# LOCAL TEST
#   Network Address: localhost/ws?role=touchdesigner
#   Network Port: 8080
#
# RENDER / PUBLIC TEST
#   Network Address: wss://YOUR-SERVICE.onrender.com/ws?role=touchdesigner
#   Network Port: 443
#
# TouchDesigner WebSocket DAT는 포트 443에서 secure WebSocket(wss)을 지원합니다.
# Active를 On으로 두고 이 파일 내용을 Callbacks DAT에 붙여 넣으세요.

import json


def onConnect(dat):
    # URL query에도 role이 들어 있지만, 재확인을 위해 등록 메시지를 한 번 더 보냅니다.
    dat.sendText(json.dumps({"type": "REGISTER", "role": "touchdesigner"}))
    print('[fish-websocket] connected')
    return


def onDisconnect(dat):
    print('[fish-websocket] disconnected')
    # Render 배포/재시작 등으로 연결이 끊기면 WebSocket DAT가 disconnected 상태가 될 수 있습니다.
    # 연결이 돌아오지 않는 경우 Active를 Off -> On 해 재접속하세요.
    return


def spawn_fish(fish_id, payload):
    print('[fish-websocket] SPAWN_FISH:', fish_id)

    # 범용 전달 지점: /project1/fish_spawn 테이블 DAT가 있으면
    # 최신 이벤트를 2열 표 형태로 기록합니다.
    table = op('/project1/fish_spawn')
    if table:
        table.clear()
        table.appendRow(['key', 'value'])
        table.appendRow(['fishId', fish_id])
        table.appendRow(['event', 'SPAWN_FISH'])
        table.appendRow(['serverTime', str(payload.get('serverTime', ''))])

    # --- 네 프로젝트에 맞춰 여기만 연결하면 됩니다. ---
    # 예시 1: 물고기별 Base COMP가 있고 display 파라미터로 켜는 경우
    # target = op('/project1/fishes/' + fish_id)
    # if target:
    #     target.par.display = True
    #
    # 예시 2: fishSpawner COMP에 커스텀 파라미터 Fishid/Spawn이 있는 경우
    # spawner = op('/project1/fishSpawner')
    # if spawner:
    #     spawner.par.Fishid = fish_id
    #     spawner.par.Spawn.pulse()


def onReceiveText(dat, rowIndex, message):
    try:
        payload = json.loads(message)
    except Exception as e:
        print('[fish-websocket] invalid json:', e, message)
        return

    if payload.get('type') == 'SPAWN_FISH':
        spawn_fish(payload.get('fishId', 'fish01'), payload)
    return


def onReceiveBinary(dat, contents):
    return


def onReceivePing(dat, contents):
    dat.sendPong(contents)
    return


def onReceivePong(dat, contents):
    return


def onMonitorMessage(dat, message):
    return
