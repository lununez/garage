/**
 * Entity Binding Module
 * Maps HA entities to LVGL widgets with bidirectional sync.
 * Generates ESPHome sensor blocks (HA → widget) and event actions (widget → HA).
 *
 * Binding model per the user's shade controller YAML pattern:
 *   sensor:
 *     - platform: homeassistant
 *       entity_id: cover.right_window_shade
 *       attribute: current_position
 *       on_value:
 *         - lvgl.slider.update:
 *             id: shade_slider
 *             value: !lambda "return (int)x;"
 *   lvgl slider on_release:
 *     - homeassistant.action:
 *         action: cover.set_cover_position
 *         data:
 *           entity_id: cover.right_window_shade
 *           position: !lambda "return int(x);"
 */

const EntityBinding = (() => {

    // ---- Domain → Widget binding templates ----
    // Each template defines how to sync HA state to an LVGL widget and back.

    const BINDING_TEMPLATES = {
        cover: {
            position: {
                label: 'Position (slider)',
                widgetTypes: ['slider'],
                syncFrom: {
                    platform: 'sensor',
                    attribute: 'current_position',
                    updateAction: 'lvgl.slider.update',
                    valueLambda: 'return (int)x;',
                },
                syncTo: {
                    event: 'on_release',
                    haAction: 'cover.set_cover_position',
                    dataTemplate: { position: '__LAMBDA__return int(x);' },
                },
                widgetDefaults: { min_value: 0, max_value: 100, value: 0 },
            },
            open: {
                label: 'Open (button)',
                widgetTypes: ['button'],
                syncTo: {
                    event: 'on_press',
                    haAction: 'cover.open_cover',
                    dataTemplate: {},
                },
            },
            close: {
                label: 'Close (button)',
                widgetTypes: ['button'],
                syncTo: {
                    event: 'on_press',
                    haAction: 'cover.close_cover',
                    dataTemplate: {},
                },
            },
            stop: {
                label: 'Stop (button)',
                widgetTypes: ['button'],
                syncTo: {
                    event: 'on_press',
                    haAction: 'cover.stop_cover',
                    dataTemplate: {},
                },
            },
        },
        light: {
            toggle: {
                label: 'Toggle (switch)',
                widgetTypes: ['switch'],
                syncFrom: {
                    platform: 'binary_sensor',
                    updateAction: 'lvgl.widget.update',
                    stateMapping: 'state',
                },
                syncTo: {
                    event: 'on_value_change',
                    haActionOn: 'light.turn_on',
                    haActionOff: 'light.turn_off',
                    conditional: true,
                },
            },
            brightness: {
                label: 'Brightness (slider)',
                widgetTypes: ['slider', 'arc'],
                syncFrom: {
                    platform: 'sensor',
                    attribute: 'brightness',
                    updateAction: 'lvgl.slider.update',
                    valueLambda: 'return (int)(x / 255.0 * 100);',
                },
                syncTo: {
                    event: 'on_release',
                    haAction: 'light.turn_on',
                    dataTemplate: { brightness: '__LAMBDA__return (int)(x / 100.0 * 255);' },
                },
                widgetDefaults: { min_value: 0, max_value: 100, value: 0 },
            },
            color_temp: {
                label: 'Color Temp (slider)',
                widgetTypes: ['slider', 'arc'],
                syncFrom: {
                    platform: 'sensor',
                    attribute: 'color_temp',
                    updateAction: 'lvgl.slider.update',
                    valueLambda: 'return (int)x;',
                },
                syncTo: {
                    event: 'on_release',
                    haAction: 'light.turn_on',
                    dataTemplate: { color_temp: '__LAMBDA__return (int)x;' },
                },
                widgetDefaults: { min_value: 153, max_value: 500, value: 250 },
            },
        },
        switch: {
            toggle: {
                label: 'Toggle (switch)',
                widgetTypes: ['switch'],
                syncFrom: {
                    platform: 'binary_sensor',
                    updateAction: 'lvgl.widget.update',
                    stateMapping: 'state',
                },
                syncTo: {
                    event: 'on_value_change',
                    haActionOn: 'switch.turn_on',
                    haActionOff: 'switch.turn_off',
                    conditional: true,
                },
            },
        },
        fan: {
            toggle: {
                label: 'Toggle (switch)',
                widgetTypes: ['switch'],
                syncFrom: {
                    platform: 'binary_sensor',
                    updateAction: 'lvgl.widget.update',
                    stateMapping: 'state',
                },
                syncTo: {
                    event: 'on_value_change',
                    haActionOn: 'fan.turn_on',
                    haActionOff: 'fan.turn_off',
                    conditional: true,
                },
            },
            speed: {
                label: 'Speed (slider)',
                widgetTypes: ['slider', 'arc'],
                syncFrom: {
                    platform: 'sensor',
                    attribute: 'percentage',
                    updateAction: 'lvgl.slider.update',
                    valueLambda: 'return (int)x;',
                },
                syncTo: {
                    event: 'on_release',
                    haAction: 'fan.set_percentage',
                    dataTemplate: { percentage: '__LAMBDA__return (int)x;' },
                },
                widgetDefaults: { min_value: 0, max_value: 100, value: 0 },
            },
        },
        climate: {
            temperature: {
                label: 'Target Temp (slider/arc)',
                widgetTypes: ['slider', 'arc'],
                syncFrom: {
                    platform: 'sensor',
                    attribute: 'temperature',
                    updateAction: 'lvgl.slider.update',
                    valueLambda: 'return (int)x;',
                },
                syncTo: {
                    event: 'on_release',
                    haAction: 'climate.set_temperature',
                    dataTemplate: { temperature: '__LAMBDA__return (int)x;' },
                },
                widgetDefaults: { min_value: 60, max_value: 90, value: 72 },
            },
        },
        sensor: {
            display: {
                label: 'Display value (label)',
                widgetTypes: ['label'],
                syncFrom: {
                    platform: 'sensor',
                    updateAction: 'lvgl.label.update',
                    valueLambda: null,  // uses text format
                    textFormat: 'return str_sprintf("%.1f %s", x, id(${sensorId}).get_unit_of_measurement().c_str());',
                },
            },
            bar: {
                label: 'Level bar',
                widgetTypes: ['bar'],
                syncFrom: {
                    platform: 'sensor',
                    updateAction: 'lvgl.bar.update',
                    valueLambda: 'return (int)x;',
                },
                widgetDefaults: { min_value: 0, max_value: 100, value: 0 },
            },
        },
        media_player: {
            volume: {
                label: 'Volume (slider)',
                widgetTypes: ['slider', 'arc'],
                syncFrom: {
                    platform: 'sensor',
                    attribute: 'volume_level',
                    updateAction: 'lvgl.slider.update',
                    valueLambda: 'return (int)(x * 100);',
                },
                syncTo: {
                    event: 'on_release',
                    haAction: 'media_player.volume_set',
                    dataTemplate: { volume_level: '__LAMBDA__return x / 100.0;' },
                },
                widgetDefaults: { min_value: 0, max_value: 100, value: 0 },
            },
            play_pause: {
                label: 'Play/Pause (button)',
                widgetTypes: ['button'],
                syncTo: {
                    event: 'on_press',
                    haAction: 'media_player.media_play_pause',
                    dataTemplate: {},
                },
            },
        },
        input_boolean: {
            toggle: {
                label: 'Toggle (switch)',
                widgetTypes: ['switch', 'checkbox'],
                syncFrom: {
                    platform: 'binary_sensor',
                    updateAction: 'lvgl.widget.update',
                    stateMapping: 'state',
                },
                syncTo: {
                    event: 'on_value_change',
                    haActionOn: 'input_boolean.turn_on',
                    haActionOff: 'input_boolean.turn_off',
                    conditional: true,
                },
            },
        },
        input_number: {
            value: {
                label: 'Value (slider)',
                widgetTypes: ['slider', 'arc', 'spinbox'],
                syncFrom: {
                    platform: 'sensor',
                    updateAction: 'lvgl.slider.update',
                    valueLambda: 'return (int)x;',
                },
                syncTo: {
                    event: 'on_release',
                    haAction: 'input_number.set_value',
                    dataTemplate: { value: '__LAMBDA__return (int)x;' },
                },
            },
        },
    };

    // ---- Binding Management ----

    /**
     * Get available binding roles for an entity domain + widget type.
     */
    function getAvailableRoles(entityDomain, widgetType) {
        const domainTemplates = BINDING_TEMPLATES[entityDomain];
        if (!domainTemplates) return [];

        const roles = [];
        for (const [role, template] of Object.entries(domainTemplates)) {
            if (!template.widgetTypes || template.widgetTypes.includes(widgetType)) {
                roles.push({ role, label: template.label });
            }
        }
        return roles;
    }

    /**
     * Get supported entity domains.
     */
    function getSupportedDomains() {
        return Object.keys(BINDING_TEMPLATES);
    }

    /**
     * Get the binding template for a domain + role.
     */
    function getTemplate(entityDomain, role) {
        return BINDING_TEMPLATES[entityDomain]?.[role] || null;
    }

    /**
     * Create a binding object for a widget.
     * @param {string} entityId - e.g. 'cover.right_window_shade'
     * @param {string} role - e.g. 'position'
     * @param {object} widget - the widget object
     * @returns {object} binding config to store on widget.binding
     */
    function createBinding(entityId, role, widget) {
        const domain = entityId.split('.')[0];
        const template = getTemplate(domain, role);
        if (!template) return null;

        const binding = {
            entity_id: entityId,
            domain,
            role,
            sync_from_ha: !!template.syncFrom,
            sync_to_ha: !!template.syncTo,
        };

        // Apply widget defaults from template
        if (template.widgetDefaults) {
            for (const [key, val] of Object.entries(template.widgetDefaults)) {
                widget.properties[key] = val;
            }
        }

        // Auto-generate event actions for sync to HA
        if (template.syncTo) {
            applyEventActions(widget, entityId, template.syncTo);
        }

        return binding;
    }

    /**
     * Apply event actions from a binding template to a widget.
     */
    function applyEventActions(widget, entityId, syncTo) {
        if (!widget.events) widget.events = {};
        const event = syncTo.event;
        if (!widget.events[event]) widget.events[event] = [];

        if (syncTo.conditional) {
            // On/off conditional actions (for switches/toggles)
            // For ESPHome, we generate two actions with if/then conditions
            // Simplified: just generate a single homeassistant.action that toggles
            widget.events[event] = [
                {
                    type: 'homeassistant.action',
                    fields: {
                        action: syncTo.haActionOn,
                        data: `entity_id: ${entityId}`,
                    },
                    _binding_conditional: 'on',
                },
                {
                    type: 'homeassistant.action',
                    fields: {
                        action: syncTo.haActionOff,
                        data: `entity_id: ${entityId}`,
                    },
                    _binding_conditional: 'off',
                },
            ];
        } else {
            // Simple action
            const dataEntries = { entity_id: entityId };
            if (syncTo.dataTemplate) {
                Object.assign(dataEntries, syncTo.dataTemplate);
            }

            // Convert data entries to YAML string
            const dataLines = [];
            for (const [key, val] of Object.entries(dataEntries)) {
                if (typeof val === 'string' && val.startsWith('__LAMBDA__')) {
                    dataLines.push(`${key}: !lambda "${val.slice(10)}"`);
                } else {
                    dataLines.push(`${key}: ${val}`);
                }
            }

            widget.events[event] = [
                {
                    type: 'homeassistant.action',
                    fields: {
                        action: syncTo.haAction,
                        data: dataLines.join('\n'),
                    },
                },
            ];
        }
    }

    /**
     * Remove binding from a widget.
     */
    function removeBinding(widget) {
        if (!widget.binding) return;

        // Remove auto-generated event actions
        const domain = widget.binding.domain;
        const role = widget.binding.role;
        const template = getTemplate(domain, role);
        if (template?.syncTo?.event) {
            delete widget.events[template.syncTo.event];
        }

        delete widget.binding;
    }

    // ---- ESPHome YAML Generation for Bindings ----

    /**
     * Generate sensor/binary_sensor YAML blocks from all widget bindings.
     * Returns { sensor: [...], binary_sensor: [...] }
     */
    function generateSensorBlocks(designerState) {
        const sensors = [];
        const binarySensors = [];

        for (const page of designerState.pages) {
            collectBindingSensors(page.widgets, sensors, binarySensors);
        }

        return { sensor: sensors, binary_sensor: binarySensors };
    }

    function collectBindingSensors(widgets, sensors, binarySensors) {
        for (const widget of widgets) {
            if (widget.binding && widget.binding.sync_from_ha) {
                const template = getTemplate(widget.binding.domain, widget.binding.role);
                if (template?.syncFrom) {
                    const sensorBlock = generateSensorBlock(widget, template.syncFrom);
                    if (template.syncFrom.platform === 'binary_sensor') {
                        binarySensors.push(sensorBlock);
                    } else {
                        sensors.push(sensorBlock);
                    }
                }
            }
            if (widget.children) {
                collectBindingSensors(widget.children, sensors, binarySensors);
            }
        }
    }

    function generateSensorBlock(widget, syncFrom) {
        const entityId = widget.binding.entity_id;
        const sensorId = 'ha_' + entityId.replace(/\./g, '_');
        const widgetType = widget.type;

        const block = {
            platform: 'homeassistant',
            id: sensorId,
            entity_id: entityId,
        };

        if (syncFrom.attribute) {
            block.attribute = syncFrom.attribute;
        }

        // Generate on_value / on_state handler
        if (syncFrom.platform === 'binary_sensor') {
            // Binary sensor: on_state updates widget state
            block.on_state = generateSyncAction(widget, syncFrom, sensorId);
        } else {
            block.on_value = generateSyncAction(widget, syncFrom, sensorId);
        }

        return block;
    }

    function generateSyncAction(widget, syncFrom, sensorId) {
        const updateAction = syncFrom.updateAction;

        // Determine the correct update action for the widget type
        let actualAction = updateAction;
        if (updateAction === 'lvgl.slider.update' && widget.type === 'arc') {
            actualAction = 'lvgl.arc.update';
        } else if (updateAction === 'lvgl.slider.update' && widget.type === 'bar') {
            actualAction = 'lvgl.bar.update';
        } else if (updateAction === 'lvgl.widget.update' && widget.type === 'switch') {
            actualAction = 'lvgl.widget.update';
        }

        const action = {};
        const inner = { id: widget.id };

        if (syncFrom.stateMapping === 'state') {
            // Binary on/off mapping for switches
            inner.state = '__LAMBDA__return x;';
        } else if (syncFrom.textFormat) {
            // Text formatting for labels
            const fmt = syncFrom.textFormat.replace('${sensorId}', sensorId);
            inner.text = '__LAMBDA__' + fmt;
        } else if (syncFrom.valueLambda) {
            inner.value = '__LAMBDA__' + syncFrom.valueLambda;
        }

        action[actualAction] = inner;
        return [action];
    }

    /**
     * Generate the conditional YAML for switch-style bindings.
     * Returns an array of YAML action objects with if/then structure.
     */
    function generateConditionalActions(widget) {
        if (!widget.binding) return null;
        const template = getTemplate(widget.binding.domain, widget.binding.role);
        if (!template?.syncTo?.conditional) return null;

        return [
            {
                if: {
                    condition: 'lambda',
                    lambda: 'return id(' + widget.id + ').is_checked();',
                },
                then: [{
                    'homeassistant.action': {
                        action: template.syncTo.haActionOn,
                        data: { entity_id: widget.binding.entity_id },
                    },
                }],
                else: [{
                    'homeassistant.action': {
                        action: template.syncTo.haActionOff,
                        data: { entity_id: widget.binding.entity_id },
                    },
                }],
            },
        ];
    }

    // ---- Entity Picker Helpers ----

    /**
     * Get a friendly name for an entity from HA state.
     */
    function getEntityName(entityId) {
        if (!HAConnection.isConnected()) return entityId;
        const entity = HAConnection.getEntity(entityId);
        return entity?.attributes?.friendly_name || entityId;
    }

    /**
     * Get compatible roles for a widget given an entity.
     */
    function getCompatibleRoles(entityId, widgetType) {
        const domain = entityId.split('.')[0];
        return getAvailableRoles(domain, widgetType);
    }

    // ---- Public API ----
    return {
        BINDING_TEMPLATES,
        getAvailableRoles,
        getSupportedDomains,
        getTemplate,
        createBinding,
        removeBinding,
        generateSensorBlocks,
        generateConditionalActions,
        getEntityName,
        getCompatibleRoles,
    };
})();
