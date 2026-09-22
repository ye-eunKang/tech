(() => {
  class FishSocket {
    constructor({ role, fishId = '', onMessage, onStatus, onOpen }) {
      this.role = role;
      this.fishId = fishId;
      this.onMessage = onMessage || (() => {});
      this.onStatus = onStatus || (() => {});
      this.onOpen = onOpen || (() => {});
      this.socket = null;
      this.queue = [];
      this.closedByUser = false;
      this.reconnectAttempt = 0;
      this.reconnectTimer = null;
      this.connect();
    }

    get url() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({ role: this.role });
      if (this.fishId) params.set('fish', this.fishId);
      return `${protocol}//${location.host}/ws?${params.toString()}`;
    }

    connect() {
      if (this.closedByUser) return;
      clearTimeout(this.reconnectTimer);
      this.onStatus('connecting');

      try {
        this.socket = new WebSocket(this.url);
      } catch (_) {
        this.scheduleReconnect();
        return;
      }

      this.socket.addEventListener('open', () => {
        this.reconnectAttempt = 0;
        this.onStatus('open');
        this.flush();
        this.onOpen();
      });

      this.socket.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        this.onMessage(msg);
      });

      this.socket.addEventListener('close', () => {
        this.onStatus('closed');
        if (!this.closedByUser) this.scheduleReconnect();
      });

      this.socket.addEventListener('error', () => {
        this.onStatus('error');
        // close 이벤트에서 재연결을 예약한다.
      });
    }

    scheduleReconnect() {
      if (this.closedByUser || this.reconnectTimer) return;
      const delay = Math.min(10000, 1000 * (2 ** this.reconnectAttempt));
      this.reconnectAttempt += 1;
      this.onStatus('reconnecting', delay);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }

    send(payload, { volatile = false } = {}) {
      const text = JSON.stringify(payload);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(text);
        return true;
      }
      if (!volatile) {
        // 중요한 이벤트만 보관. 과도한 중복은 방지한다.
        if (this.queue.length >= 50) this.queue.shift();
        this.queue.push(text);
      }
      return false;
    }

    flush() {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      while (this.queue.length) this.socket.send(this.queue.shift());
    }

    close() {
      this.closedByUser = true;
      clearTimeout(this.reconnectTimer);
      if (this.socket) this.socket.close();
    }
  }

  window.FishSocket = FishSocket;
})();
