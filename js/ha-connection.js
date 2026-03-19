/**
 * Home Assistant Connection Module
 * Connects to HA via WebSocket API for real-time entity state updates.
 * Also provides REST API fallback for entity fetching and service calls.
 */

const HAConnection = (() => {
    let ws = null;
    let config = { url: '', token: '' };
    let connected = false;
    let authenticated = false;
    let msgId = 1;
    let pendingRequests = {};
    let entities = {};           // entity_id -> { state, attributes, last_changed }
    let stateListeners = {};     // entity_id -> [callback, ...]
    let globalListeners = [];    // [callback, ...] for any state change
    let connectionListeners = []; // [callback, ...] for connection state changes
    let reconnectTimer = null;
    let subscriptionId = null;

    const STORAGE_KEY = 'lvgl-ha-connection';

    // ---- Configuration ----

    function getConfig() {
        return { ...config };
    }

    function setConfig(url, token) {
        // Normalize URL: strip trailing slash, ensure no /api suffix for WS
        url = (url || '').replace(/\/+$/, '');
        config.url = url;
        config.token = token;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, token }));
    }

    function loadConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (saved.url) config.url = saved.url;
            if (saved.token) config.token = saved.token;
        } catch (e) { /* ignore */ }
    }

    // ---- WebSocket Connection ----

    function connect() {
        return new Promise((resolve, reject) => {
            if (!config.url || !config.token) {
                reject(new Error('HA URL and token are required'));
                return;
            }

            disconnect();

            // Convert http(s) URL to ws(s) URL
            let wsUrl = config.url
                .replace(/^http:/, 'ws:')
                .replace(/^https:/, 'wss:');
            wsUrl += '/api/websocket';

            try {
                ws = new WebSocket(wsUrl);
            } catch (e) {
                reject(new Error('Failed to create WebSocket: ' + e.message));
                return;
            }

            let resolved = false;

            ws.onopen = () => {
                // Wait for auth_required message
            };

            ws.onmessage = (event) => {
                let msg;
                try {
                    msg = JSON.parse(event.data);
                } catch (e) { return; }

                switch (msg.type) {
                    case 'auth_required':
                        ws.send(JSON.stringify({
                            type: 'auth',
                            access_token: config.token,
                        }));
                        break;

                    case 'auth_ok':
                        authenticated = true;
                        connected = true;
                        notifyConnectionChange(true);
                        // Fetch all states, then subscribe to changes
                        fetchAllStates().then(() => {
                            subscribeToStateChanges();
                            if (!resolved) { resolved = true; resolve(); }
                        });
                        break;

                    case 'auth_invalid':
                        authenticated = false;
                        connected = false;
                        notifyConnectionChange(false);
                        if (!resolved) { resolved = true; reject(new Error('Authentication failed: ' + (msg.message || 'Invalid token'))); }
                        ws.close();
                        break;

                    case 'result':
                        if (pendingRequests[msg.id]) {
                            if (msg.success) {
                                pendingRequests[msg.id].resolve(msg.result);
                            } else {
                                pendingRequests[msg.id].reject(new Error(msg.error?.message || 'Request failed'));
                            }
                            delete pendingRequests[msg.id];
                        }
                        break;

                    case 'event':
                        if (msg.event?.event_type === 'state_changed') {
                            handleStateChange(msg.event.data);
                        }
                        break;
                }
            };

            ws.onerror = (event) => {
                if (!resolved) { resolved = true; reject(new Error('WebSocket connection error')); }
            };

            ws.onclose = () => {
                const wasConnected = connected;
                connected = false;
                authenticated = false;
                subscriptionId = null;
                if (wasConnected) {
                    notifyConnectionChange(false);
                    // Auto-reconnect after 5 seconds
                    reconnectTimer = setTimeout(() => {
                        if (config.url && config.token) {
                            connect().catch(() => {});
                        }
                    }, 5000);
                }
            };
        });
    }

    function disconnect() {
        clearTimeout(reconnectTimer);
        if (ws) {
            ws.onclose = null; // Prevent reconnect
            ws.close();
            ws = null;
        }
        connected = false;
        authenticated = false;
        subscriptionId = null;
        pendingRequests = {};
        notifyConnectionChange(false);
    }

    function isConnected() {
        return connected && authenticated;
    }

    // ---- WebSocket Messaging ----

    function sendMessage(msg) {
        return new Promise((resolve, reject) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Not connected'));
                return;
            }
            const id = msgId++;
            msg.id = id;
            pendingRequests[id] = { resolve, reject };
            ws.send(JSON.stringify(msg));

            // Timeout after 10 seconds
            setTimeout(() => {
                if (pendingRequests[id]) {
                    pendingRequests[id].reject(new Error('Request timed out'));
                    delete pendingRequests[id];
                }
            }, 10000);
        });
    }

    function fetchAllStates() {
        return sendMessage({ type: 'get_states' }).then(states => {
            entities = {};
            for (const entity of states) {
                entities[entity.entity_id] = {
                    state: entity.state,
                    attributes: entity.attributes || {},
                    last_changed: entity.last_changed,
                    domain: entity.entity_id.split('.')[0],
                };
            }
            return entities;
        });
    }

    function subscribeToStateChanges() {
        sendMessage({
            type: 'subscribe_events',
            event_type: 'state_changed',
        }).then(result => {
            subscriptionId = result;
        }).catch(() => {});
    }

    function handleStateChange(data) {
        if (!data || !data.entity_id || !data.new_state) return;

        const entityId = data.entity_id;
        entities[entityId] = {
            state: data.new_state.state,
            attributes: data.new_state.attributes || {},
            last_changed: data.new_state.last_changed,
            domain: entityId.split('.')[0],
        };

        // Notify entity-specific listeners
        if (stateListeners[entityId]) {
            for (const cb of stateListeners[entityId]) {
                try { cb(entities[entityId], entityId); } catch (e) { console.error(e); }
            }
        }

        // Notify global listeners
        for (const cb of globalListeners) {
            try { cb(entities[entityId], entityId); } catch (e) { console.error(e); }
        }
    }

    // ---- Service Calls ----

    function callService(domain, service, data = {}) {
        return sendMessage({
            type: 'call_service',
            domain,
            service,
            service_data: data,
        });
    }

    /**
     * Execute a HA action (service call) from an action definition.
     * action string like "cover.set_cover_position" or "light.turn_on"
     */
    function executeAction(action, data = {}) {
        const parts = action.split('.');
        if (parts.length < 2) return Promise.reject(new Error('Invalid action: ' + action));
        const domain = parts[0];
        const service = parts.slice(1).join('.');
        return callService(domain, service, data);
    }

    // ---- Entity Access ----

    function getEntities() {
        return { ...entities };
    }

    function getEntity(entityId) {
        return entities[entityId] || null;
    }

    /**
     * Get entities filtered by domain(s).
     * @param {string|string[]} domains - e.g. 'light' or ['light', 'switch']
     */
    function getEntitiesByDomain(domains) {
        if (typeof domains === 'string') domains = [domains];
        const result = {};
        for (const [id, entity] of Object.entries(entities)) {
            if (domains.includes(entity.domain)) {
                result[id] = entity;
            }
        }
        return result;
    }

    /**
     * Get entity domains present in HA.
     */
    function getDomains() {
        const domains = new Set();
        for (const id of Object.keys(entities)) {
            domains.add(id.split('.')[0]);
        }
        return Array.from(domains).sort();
    }

    // ---- Event Listeners ----

    function onStateChange(entityId, callback) {
        if (!stateListeners[entityId]) stateListeners[entityId] = [];
        stateListeners[entityId].push(callback);
        return () => {
            stateListeners[entityId] = stateListeners[entityId].filter(cb => cb !== callback);
        };
    }

    function onAnyStateChange(callback) {
        globalListeners.push(callback);
        return () => {
            globalListeners = globalListeners.filter(cb => cb !== callback);
        };
    }

    function onConnectionChange(callback) {
        connectionListeners.push(callback);
        return () => {
            connectionListeners = connectionListeners.filter(cb => cb !== callback);
        };
    }

    function notifyConnectionChange(isConnected) {
        for (const cb of connectionListeners) {
            try { cb(isConnected); } catch (e) { console.error(e); }
        }
    }

    // ---- Initialization ----

    function init() {
        loadConfig();
    }

    // ---- Public API ----
    return {
        init,
        getConfig,
        setConfig,
        connect,
        disconnect,
        isConnected,
        getEntities,
        getEntity,
        getEntitiesByDomain,
        getDomains,
        callService,
        executeAction,
        onStateChange,
        onAnyStateChange,
        onConnectionChange,
    };
})();
