/**
 * ESPHome Device Manager
 * Handles fetching device YAML from ESPHome dashboard, merging LVGL sections,
 * and deploying updated YAML back to the device.
 *
 * Workflow:
 * 1. User provides ESPHome dashboard URL and device config filename
 * 2. Fetch current device YAML
 * 3. Parse it, identify sections (lvgl, sensor, binary_sensor, globals, font)
 * 4. Merge only our managed sections (preserving all non-LVGL config)
 * 5. Upload the merged YAML
 * 6. Optionally trigger compile + OTA upload
 */

const DeviceManager = (() => {
    let config = { dashboardUrl: '', deviceFile: '' };
    let deviceYaml = '';          // Raw YAML text from device
    let connectionListeners = [];

    const STORAGE_KEY = 'lvgl-esphome-device';

    // Sections we manage (merge into device YAML)
    const MANAGED_SECTIONS = ['lvgl', 'font'];
    // Sections we append to (add our entries alongside existing)
    const APPENDABLE_SECTIONS = ['sensor', 'binary_sensor', 'globals'];
    // Marker comment to identify designer-managed entries
    const MARKER = '# [LVGL-Designer]';

    // ---- Configuration ----

    function getConfig() {
        return { ...config };
    }

    function setConfig(dashboardUrl, deviceFile) {
        config.dashboardUrl = (dashboardUrl || '').replace(/\/+$/, '');
        config.deviceFile = deviceFile || '';
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }

    function loadConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (saved.dashboardUrl) config.dashboardUrl = saved.dashboardUrl;
            if (saved.deviceFile) config.deviceFile = saved.deviceFile;
        } catch (e) { /* ignore */ }
    }

    // ---- ESPHome Dashboard API ----

    /**
     * Fetch the current device YAML from ESPHome dashboard.
     */
    async function fetchDeviceYaml() {
        if (!config.dashboardUrl || !config.deviceFile) {
            throw new Error('Dashboard URL and device file are required');
        }

        const url = `${config.dashboardUrl}/edit?configuration=${encodeURIComponent(config.deviceFile)}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'text/plain' },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch device YAML: ${response.status} ${response.statusText}`);
        }

        deviceYaml = await response.text();
        return deviceYaml;
    }

    /**
     * Upload merged YAML to ESPHome dashboard.
     */
    async function uploadDeviceYaml(yamlContent) {
        if (!config.dashboardUrl || !config.deviceFile) {
            throw new Error('Dashboard URL and device file are required');
        }

        const url = `${config.dashboardUrl}/edit?configuration=${encodeURIComponent(config.deviceFile)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: yamlContent,
        });

        if (!response.ok) {
            throw new Error(`Failed to upload YAML: ${response.status} ${response.statusText}`);
        }

        return true;
    }

    /**
     * Trigger compile and OTA upload on ESPHome dashboard.
     * This opens a WebSocket connection for streaming logs.
     * @returns {object} { ws, close } - WebSocket and close function
     */
    function triggerCompileUpload(onLog, onDone) {
        const wsUrl = config.dashboardUrl
            .replace(/^http:/, 'ws:')
            .replace(/^https:/, 'wss:');
        const url = `${wsUrl}/run?configuration=${encodeURIComponent(config.deviceFile)}`;

        const ws = new WebSocket(url);

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.event === 'line' && onLog) {
                    onLog(msg.data || '');
                } else if (msg.event === 'exit' && onDone) {
                    onDone(msg.code === 0);
                }
            } catch (e) {
                if (onLog) onLog(event.data);
            }
        };

        ws.onerror = () => {
            if (onDone) onDone(false);
        };

        ws.onclose = () => {
            if (onDone) onDone(null); // null = connection closed without exit event
        };

        return {
            ws,
            close: () => ws.close(),
        };
    }

    // ---- YAML Merging ----

    /**
     * Merge designer output into existing device YAML.
     * Replaces managed sections, appends to appendable sections.
     *
     * @param {string} existingYaml - Current device YAML text
     * @param {string} designerLvglYaml - Generated LVGL YAML (lvgl: + font:)
     * @param {object} sensorBlocks - { sensor: [...], binary_sensor: [...] }
     * @returns {string} Merged YAML text
     */
    function mergeYaml(existingYaml, designerLvglYaml, sensorBlocks) {
        // Strategy: work with the raw YAML text to preserve comments, formatting,
        // and non-LVGL sections exactly as they are.
        //
        // 1. Remove existing managed sections (lvgl:, font:)
        // 2. Remove existing designer-marked entries from appendable sections
        // 3. Append new managed sections
        // 4. Append new sensor/binary_sensor entries

        let result = existingYaml;

        // Remove existing managed sections
        for (const section of MANAGED_SECTIONS) {
            result = removeTopLevelSection(result, section);
        }

        // Remove existing designer-marked entries from appendable sections
        result = removeMarkedEntries(result);

        // Trim trailing whitespace/newlines
        result = result.replace(/\n{3,}/g, '\n\n').trimEnd();

        // Append the designer's LVGL YAML
        result += '\n\n' + MARKER + ' -- Begin managed sections --\n';
        result += designerLvglYaml.trim();

        // Append sensor blocks
        if (sensorBlocks.sensor && sensorBlocks.sensor.length > 0) {
            result += '\n\n' + generateSensorYaml('sensor', sensorBlocks.sensor);
        }
        if (sensorBlocks.binary_sensor && sensorBlocks.binary_sensor.length > 0) {
            result += '\n\n' + generateSensorYaml('binary_sensor', sensorBlocks.binary_sensor);
        }

        result += '\n' + MARKER + ' -- End managed sections --\n';

        return result;
    }

    /**
     * Remove a top-level YAML section by key.
     * Handles the section and all its indented content.
     */
    function removeTopLevelSection(yaml, sectionKey) {
        const lines = yaml.split('\n');
        const result = [];
        let inSection = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trimStart();

            // Check if this line starts a top-level section
            if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.startsWith(sectionKey + ':')) {
                inSection = true;
                continue;
            }

            if (inSection) {
                // Still in section if line is indented or empty
                if (line === '' || line.startsWith(' ') || line.startsWith('\t')) {
                    continue;
                }
                // Line is not indented and not empty — section ended
                inSection = false;
            }

            result.push(line);
        }

        return result.join('\n');
    }

    /**
     * Remove all lines between designer marker comments.
     */
    function removeMarkedEntries(yaml) {
        const lines = yaml.split('\n');
        const result = [];
        let inMarked = false;

        for (const line of lines) {
            if (line.trim().startsWith(MARKER) && line.includes('Begin')) {
                inMarked = true;
                continue;
            }
            if (line.trim().startsWith(MARKER) && line.includes('End')) {
                inMarked = false;
                continue;
            }
            if (!inMarked) {
                result.push(line);
            }
        }

        return result.join('\n');
    }

    /**
     * Generate YAML text for sensor/binary_sensor entries with marker comments.
     */
    function generateSensorYaml(sectionKey, entries) {
        let yaml = sectionKey + ':\n';
        for (const entry of entries) {
            yaml += generateSensorEntryYaml(entry);
        }
        return yaml;
    }

    /**
     * Generate YAML for a single sensor entry.
     */
    function generateSensorEntryYaml(entry) {
        let yaml = '  - platform: ' + entry.platform + '\n';
        if (entry.id) yaml += '    id: ' + entry.id + '\n';
        if (entry.entity_id) yaml += '    entity_id: ' + entry.entity_id + '\n';
        if (entry.attribute) yaml += '    attribute: ' + entry.attribute + '\n';

        // on_value or on_state handlers
        const handler = entry.on_value || entry.on_state;
        const handlerKey = entry.on_value ? 'on_value' : 'on_state';
        if (handler) {
            yaml += '    ' + handlerKey + ':\n';
            for (const action of handler) {
                const actionKey = Object.keys(action)[0];
                const actionData = action[actionKey];
                yaml += '      - ' + actionKey + ':\n';
                for (const [key, val] of Object.entries(actionData)) {
                    if (typeof val === 'string' && val.startsWith('__LAMBDA__')) {
                        yaml += '          ' + key + ': !lambda "' + val.slice(10) + '"\n';
                    } else {
                        yaml += '          ' + key + ': ' + val + '\n';
                    }
                }
            }
        }

        return yaml;
    }

    // ---- Diff Preview ----

    /**
     * Generate a diff showing what will change.
     * Returns array of { type: 'add'|'remove'|'context', text }
     */
    function generateDiff(existingYaml, mergedYaml) {
        const existLines = existingYaml.split('\n');
        const mergedLines = mergedYaml.split('\n');
        const diff = [];

        // Simple line-by-line diff (not full Myers, but good enough for review)
        const existSet = new Set(existLines);
        const mergedSet = new Set(mergedLines);

        // Show removed lines (in existing but not in merged)
        let inRemoved = false;
        for (const line of existLines) {
            if (!mergedSet.has(line) && line.trim() !== '') {
                if (!inRemoved) {
                    diff.push({ type: 'header', text: '--- Removed ---' });
                    inRemoved = true;
                }
                diff.push({ type: 'remove', text: line });
            }
        }

        // Show added lines (in merged but not in existing)
        let inAdded = false;
        for (const line of mergedLines) {
            if (!existSet.has(line) && line.trim() !== '') {
                if (!inAdded) {
                    diff.push({ type: 'header', text: '+++ Added +++' });
                    inAdded = true;
                }
                diff.push({ type: 'add', text: line });
            }
        }

        if (diff.length === 0) {
            diff.push({ type: 'context', text: 'No changes detected' });
        }

        return diff;
    }

    // ---- Public API ----

    function init() {
        loadConfig();
    }

    return {
        init,
        getConfig,
        setConfig,
        fetchDeviceYaml,
        uploadDeviceYaml,
        triggerCompileUpload,
        mergeYaml,
        generateDiff,
        MARKER,
    };
})();
