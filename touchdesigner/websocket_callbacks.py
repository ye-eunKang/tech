# TouchDesigner WebSocket DAT Callbacks
#
# RENDER / PUBLIC TEST
#   Network Address: tech-tv33.onrender.com/ws?role=touchdesigner
#   Network Port: 443
#   Active: On
#
# Port 443 implies a secure WebSocket connection in TouchDesigner.
# The WebSocket DAT callbacks below follow Derivative's documented callback signatures.

import json


def onConnect(dat):
    print('[fish-websocket] connected')

    # URL query에 role이 들어가 있지만 서버에서 확실히 등록되도록 한 번 더 보냅니다.
    result = dat.sendText(json.dumps({
        "type": "REGISTER",
        "role": "touchdesigner"
    }))

    print('[fish-websocket] REGISTER sent bytes:', result)
    return


def onDisconnect(dat):
    print('[fish-websocket] disconnected')
    return


def spawn_fish(fish_id, payload):
    print('====================================')
    print('[fish-websocket] SPAWN_FISH RECEIVED')
    print('[fish-websocket] fishId:', fish_id)
    print('[fish-websocket] payload:', payload)
    print('====================================')

    # /project1/fish_spawn Table DAT가 있으면 최신 이벤트를 기록합니다.
    table = op('/project1/fish_spawn')
    if table:
        table.clear()
        table.appendRow(['key', 'value'])
        table.appendRow(['fishId', fish_id])
        table.appendRow(['event', 'SPAWN_FISH'])
        table.appendRow(['serverTime', str(payload.get('serverTime', ''))])

    # 실제 물고기 등장 연결 예시:
    #
    # if fish_id == 'fish01':
    #     sw = op('/project1/spawn_switch')
    #     if sw:
    #         sw.par.index = 1


def onReceiveText(dat, rowIndex, message):
    print('[fish-websocket] received:', message)

    try:
        payload = json.loads(message)
    except Exception as e:
        print('[fish-websocket] invalid json:', e, message)
        return

    msg_type = payload.get('type')

    if msg_type == 'CONNECTED':
        print('[fish-websocket] server connection confirmed')

    elif msg_type == 'REGISTERED':
        print(
            '[fish-websocket] role registered:',
            payload.get('role')
        )

    elif msg_type == 'SPAWN_FISH':
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
    print('[fish-websocket] monitor:', message)
    return
