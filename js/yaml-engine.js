/**
 * YAML Engine for ESPHome LVGL
 * Handles YAML generation from designer state, parsing YAML back to state,
 * validation against ESPHome LVGL schema, and CodeMirror editor integration.
 *
 * ESPHome YAML format requirements (per https://esphome.io/cookbook/lvgl/):
 * - Colors are UNQUOTED hex integers: bg_color: 0xFFAA44
 * - Opacity is UNQUOTED: bg_opa: 100%  or  bg_opa: COVER
 * - Icon text uses \uXXXX in DOUBLE QUOTES: text: "\uF077"
 * - !lambda tags: !lambda "return (int)x;"
 * - y key must not be interpreted as YAML boolean
 */

const YAMLEngine = (() => {

    let codeMirrorEditor = null;
    let isUpdatingFromDesigner = false;
    let isUpdatingFromEditor = false;
    let onApply = null;
    let validationTimer = null;

    // ---- Custom YAML Schema for ESPHome tags ----
    // Lambda placeholder: during generation we use __LAMBDA__code as a sentinel.
    // After js-yaml dump, we post-process to convert these to proper !lambda "code" tags.
    const LAMBDA_SENTINEL = '__LAMBDA__';

    const ESPHOME_TAGS = ['lambda', 'secret', 'include', 'extend', 'remove'];
    const customTypes = ESPHOME_TAGS.map(tag =>
        new jsyaml.Type('!' + tag, {
            kind: 'scalar',
            construct: (data) => {
                if (tag === 'lambda') {
                    // Preserve as sentinel so we can reconstruct the tag on dump
                    return LAMBDA_SENTINEL + data;
                }
                return `!${tag} ${data}`;
            },
            represent: (data) => data,
        })
    );
    // Handle !lambda with mapping kind (multi-line lambdas)
    customTypes.push(new jsyaml.Type('!lambda', {
        kind: 'mapping',
        construct: (data) => ({ __lambda: true, ...data }),
    }));

    const ESPHOME_SCHEMA = jsyaml.DEFAULT_SCHEMA.extend(customTypes);

    function yamlLoad(str) {
        return jsyaml.load(str, { schema: ESPHOME_SCHEMA });
    }

    function yamlDump(obj, opts) {
        return jsyaml.dump(obj, { schema: ESPHOME_SCHEMA, ...opts });
    }

    // ---- Post-processing for ESPHome YAML ----

    /**
     * Post-process YAML output to match ESPHome's expected format.
     * ESPHome's YAML loader differs from standard YAML 1.1 in several ways:
     * - Colors are bare hex integers: bg_color: 0xFFAA44
     * - Percentage values are unquoted: bg_opa: 100%
     * - The 'y' key is NOT treated as boolean true
     * - Icon text uses \uXXXX inside double quotes: text: "\uF077"
     */
    function postProcessYaml(yamlStr) {
        let result = yamlStr;

        // Fix lambda sentinels: convert "__LAMBDA__code" → !lambda "code"
        result = result.replace(/"__LAMBDA__((?:[^"\\]|\\.)*)"/g, (match, code) => {
            return '!lambda "' + code + '"';
        });
        result = result.replace(/'__LAMBDA__([^']*)'/g, (match, code) => {
            return '!lambda "' + code + '"';
        });
        result = result.replace(/:\s+__LAMBDA__(.+)$/gm, (match, code) => {
            return ': !lambda "' + code.trim() + '"';
        });

        // Fix !secret and !include tag representations
        for (const tag of ['secret', 'include', 'extend', 'remove']) {
            const pattern = new RegExp(`["']!${tag}\\s+([^"']+)["']`, 'g');
            result = result.replace(pattern, `!${tag} $1`);
        }

        // UNQUOTE hex color values: "0xFFAA44" → 0xFFAA44
        // ESPHome expects bare hex integers for colors, not quoted strings
        result = result.replace(/:\s+"(0x[0-9A-Fa-f]{6})"\s*$/gm, ': $1');
        result = result.replace(/:\s+'(0x[0-9A-Fa-f]{6})'\s*$/gm, ': $1');

        // UNQUOTE percentage values: "100%" → 100%
        // ESPHome expects bare percentage values for opacity etc.
        result = result.replace(/:\s+"(\d+%)"\s*$/gm, ': $1');
        result = result.replace(/:\s+'(\d+%)'\s*$/gm, ': $1');

        // UNQUOTE the 'y' key: "y": → y:
        // js-yaml quotes 'y' because YAML 1.1 treats it as boolean true,
        // but ESPHome's YAML loader handles 'y' as a key name correctly
        result = result.replace(/^(\s*)"y":/gm, '$1y:');
        result = result.replace(/^(\s*)'y':/gm, '$1y:');

        // Fix icon text sentinels: convert __ICON_TEXT__\uXXXX to "\uXXXX"
        // ESPHome requires icon escape sequences in double-quoted strings
        // js-yaml may have added its own quotes around the sentinel
        result = result.replace(/"__ICON_TEXT__([^"]*)"/g, (match, content) => {
            return '"' + content + '"';
        });
        result = result.replace(/'__ICON_TEXT__([^']*)'/g, (match, content) => {
            return '"' + content + '"';
        });
        result = result.replace(/:\s+__ICON_TEXT__(.+)$/gm, (match, content) => {
            return ': "' + content.trim() + '"';
        });

        // Fix glyph sentinels: convert __GLYPH__\UXXXXXXXX to "\UXXXXXXXX"
        // ESPHome convention: \U codepoints in double-quoted strings
        result = result.replace(/"?'?__GLYPH__(\\[Uu][0-9A-Fa-f]+)"?'?/g, (match, cp) => {
            return '"' + cp + '"';
        });
        // Also handle unquoted sentinel on its own line (list items)
        result = result.replace(/- __GLYPH__(\\[Uu][0-9A-Fa-f]+)/g, (match, cp) => {
            return '- "' + cp + '"';
        });

        return result;
    }

    // ---- Initialization ----
    function init(options = {}) {
        onApply = options.onApply || null;
        initCodeMirror();
    }

    function initCodeMirror() {
        const textarea = document.getElementById('yaml-editor');
        if (!textarea) return;

        codeMirrorEditor = CodeMirror.fromTextArea(textarea, {
            mode: 'yaml',
            theme: 'monokai',
            lineNumbers: true,
            tabSize: 2,
            indentWithTabs: false,
            lineWrapping: true,
            matchBrackets: true,
            foldGutter: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
            extraKeys: {
                Tab: (cm) => cm.replaceSelection('  ', 'end'),
            },
        });

        // Live validation on change
        codeMirrorEditor.on('change', () => {
            if (isUpdatingFromDesigner) return;
            clearTimeout(validationTimer);
            validationTimer = setTimeout(() => {
                validateEditorContent();
            }, 500);
        });
    }

    // ---- YAML Generation ----

    /**
     * Generate ESPHome LVGL YAML from designer state.
     * This produces the lvgl: and font: sections only.
     */
    function generateYAML(designerState) {
        const doc = {};

        // Font declarations
        if (typeof FontManager !== 'undefined') {
            const fontYaml = FontManager.toYAML();
            if (fontYaml && fontYaml.length > 0) {
                doc.font = fontYaml;
            }
        }

        doc.lvgl = { pages: [] };

        for (const page of designerState.pages) {
            const pageObj = {
                id: page.id,
                widgets: [],
            };

            for (const widget of page.widgets) {
                pageObj.widgets.push(widgetToYAML(widget));
            }

            doc.lvgl.pages.push(pageObj);
        }

        const rawYaml = yamlDump(doc, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
            quotingType: '"',
            forceQuotes: false,
        });

        return postProcessYaml(rawYaml);
    }

    /**
     * Generate full device-ready YAML including sensor blocks from entity bindings.
     * This is used for deployment — produces lvgl + font + sensor + binary_sensor sections.
     */
    function generateFullYAML(designerState) {
        let yaml = generateYAML(designerState);

        // Generate sensor blocks from entity bindings
        if (typeof EntityBinding !== 'undefined') {
            const sensorBlocks = EntityBinding.generateSensorBlocks(designerState);

            if (sensorBlocks.sensor && sensorBlocks.sensor.length > 0) {
                yaml += '\n' + generateSensorSectionYaml('sensor', sensorBlocks.sensor);
            }
            if (sensorBlocks.binary_sensor && sensorBlocks.binary_sensor.length > 0) {
                yaml += '\n' + generateSensorSectionYaml('binary_sensor', sensorBlocks.binary_sensor);
            }
        }

        return yaml;
    }

    /**
     * Generate YAML text for a sensor/binary_sensor section.
     */
    function generateSensorSectionYaml(sectionKey, entries) {
        let yaml = sectionKey + ':\n';
        for (const entry of entries) {
            yaml += '  - platform: homeassistant\n';
            if (entry.id) yaml += '    id: ' + entry.id + '\n';
            if (entry.entity_id) yaml += '    entity_id: ' + entry.entity_id + '\n';
            if (entry.attribute) yaml += '    attribute: ' + entry.attribute + '\n';

            const handler = entry.on_value || entry.on_state;
            const handlerKey = entry.on_value ? 'on_value' : 'on_state';
            if (handler) {
                yaml += '    ' + handlerKey + ':\n';
                for (const action of handler) {
                    const actionKey = Object.keys(action)[0];
                    const actionData = action[actionKey];
                    yaml += '      - ' + actionKey + ':\n';
                    for (const [key, val] of Object.entries(actionData)) {
                        if (typeof val === 'string' && val.startsWith(LAMBDA_SENTINEL)) {
                            yaml += '          ' + key + ': !lambda "' + val.slice(LAMBDA_SENTINEL.length) + '"\n';
                        } else {
                            yaml += '          ' + key + ': ' + val + '\n';
                        }
                    }
                }
            }
        }
        return yaml;
    }

    /**
     * Convert a widget instance to a YAML-compatible object.
     */
    function widgetToYAML(widget) {
        const obj = {};
        const inner = {};

        // ID
        inner.id = widget.id;

        // Position
        if (widget.x !== 0) inner.x = widget.x;
        if (widget.y !== 0) inner.y = widget.y;

        // Size
        inner.width = widget.width;
        inner.height = widget.height;

        // Widget-specific properties
        const def = LVGLWidgets.getWidgetDef(widget.type);
        if (def) {
            for (const [key, propDef] of Object.entries(def.properties)) {
                if (propDef.isStyle) {
                    const val = widget.properties[key];
                    if (val !== null && val !== undefined && val !== '' && val !== propDef.default) {
                        const part = propDef.stylePart || 'main';
                        if (part === 'main') {
                            // Main part styles go directly on the widget
                            inner[key] = formatStyleValue(key, val);
                        } else {
                            if (!inner[part]) inner[part] = {};
                            inner[part][key] = formatStyleValue(key, val);
                        }
                    }
                    continue;
                }
                if (propDef.yamlExclude) continue;
                if (propDef.childLabel) continue;

                const val = widget.properties[key];
                if (val !== null && val !== undefined && val !== '' && val !== propDef.default) {
                    if (propDef.yamlMap) {
                        const mappedVal = propDef.yamlInvert ? !val : val;
                        if (mappedVal) {
                            inner[propDef.yamlMap] = mappedVal;
                        }
                        continue;
                    }
                    // Format text values with icon codes
                    if (key === 'text' && typeof val === 'string') {
                        inner[key] = formatTextForYaml(val);
                    } else {
                        inner[key] = val;
                    }
                }
            }
        }

        // Styles for each part
        // ESPHome format: 'main' part styles go directly on the widget,
        // other parts (indicator, knob, scrollbar, etc.) are nested keys.
        // State-specific styles are nested under the state name (e.g. pressed:, checked:)
        if (widget.styles) {
            for (const [part, styles] of Object.entries(widget.styles)) {
                for (const [prop, val] of Object.entries(styles)) {
                    if (prop === '_states') continue; // Handle states separately below
                    if (val !== null && val !== undefined && val !== '') {
                        const formatted = formatStyleValue(prop, val);
                        if (part === 'main') {
                            inner[prop] = formatted;
                        } else {
                            if (!inner[part]) inner[part] = {};
                            inner[part][prop] = formatted;
                        }
                    }
                }
                // State-specific styles (pressed, checked, focused, disabled)
                if (styles._states) {
                    for (const [stateName, stateStyles] of Object.entries(styles._states)) {
                        const stateObj = {};
                        for (const [prop, val] of Object.entries(stateStyles)) {
                            if (val !== null && val !== undefined && val !== '') {
                                stateObj[prop] = formatStyleValue(prop, val);
                            }
                        }
                        if (Object.keys(stateObj).length > 0) {
                            if (part === 'main') {
                                // Main part states go directly on the widget: pressed: { ... }
                                inner[stateName] = stateObj;
                            } else {
                                // Sub-part states nest inside the part: indicator: { pressed: { ... } }
                                if (!inner[part]) inner[part] = {};
                                inner[part][stateName] = stateObj;
                            }
                        }
                    }
                }
            }
        }

        // Events/Actions
        if (widget.events) {
            for (const [eventName, actions] of Object.entries(widget.events)) {
                if (actions && actions.length > 0) {
                    // Check for conditional binding actions (switch on/off)
                    const hasConditional = actions.some(a => a._binding_conditional);
                    if (hasConditional && widget.binding) {
                        const conditionalActions = EntityBinding.generateConditionalActions(widget);
                        if (conditionalActions) {
                            inner[eventName] = conditionalActions;
                            continue;
                        }
                    }
                    inner[eventName] = actions.map(a => actionToYAML(a));
                }
            }
        }

        // Children
        if (widget.children && widget.children.length > 0) {
            inner.widgets = widget.children.map(c => widgetToYAML(c));
        }

        // Map widget types for ESPHome compatibility
        // ESPHome's canvas widget requires explicit draw commands (lvgl.canvas.fill, etc.)
        // If a canvas has no draw actions, it should be output as 'obj' (base container)
        let yamlType = widget.type;
        if (yamlType === 'canvas') {
            const hasDrawActions = widget.events && Object.values(widget.events).some(actions =>
                actions.some(a => a.type && a.type.startsWith('lvgl.canvas.'))
            );
            if (!hasDrawActions) {
                yamlType = 'obj';
            }
        }

        obj[yamlType] = inner;
        return obj;
    }

    /**
     * Convert an action instance to YAML-compatible object.
     */
    function actionToYAML(action) {
        if (action.type === 'lambda') {
            return { lambda: action.fields?.code || '' };
        }

        const obj = {};
        const actionObj = {};

        for (const [key, val] of Object.entries(action.fields || {})) {
            if (val !== null && val !== undefined && val !== '') {
                if (key === 'data' && typeof val === 'string') {
                    // Parse data as YAML map, handling !lambda within data values
                    try {
                        const parsed = yamlLoad(val);
                        if (parsed && typeof parsed === 'object') {
                            // Convert any lambda sentinels back to the right form
                            const processedData = {};
                            for (const [dk, dv] of Object.entries(parsed)) {
                                if (typeof dv === 'string' && dv.startsWith(LAMBDA_SENTINEL)) {
                                    // Keep as sentinel — postProcessYaml will convert to !lambda tag
                                    processedData[dk] = dv;
                                } else {
                                    processedData[dk] = dv;
                                }
                            }
                            actionObj[key] = processedData;
                        } else {
                            actionObj[key] = val;
                        }
                    } catch (e) {
                        // If parsing fails, output as-is (user may have typed raw YAML)
                        actionObj[key] = val;
                    }
                } else {
                    actionObj[key] = val;
                }
            }
        }

        obj[action.type] = actionObj;
        return obj;
    }

    // Sentinel prefix for icon text that needs special YAML quoting.
    // postProcessYaml converts __ICON_TEXT__... to properly double-quoted "\uXXXX" format.
    const ICON_SENTINEL = '__ICON_TEXT__';

    /**
     * Format a text value for YAML output.
     * Handles ESPHome LVGL icon escape sequences:
     *
     * For BMP codepoints (U+0000-U+FFFF), ESPHome uses: "\uXXXX" (double-quoted)
     * For codepoints > U+FFFF (MDI full set), ESPHome uses: "\U000FXXXX" (double-quoted, 8-digit)
     *
     * The built-in Montserrat fonts include FontAwesome at U+F000-U+F2FF.
     * Custom MDI fonts use codepoints at U+F0001+ (Supplementary PUA).
     *
     * This function marks icon text with a sentinel so postProcessYaml
     * wraps it in double quotes for ESPHome.
     */
    function formatTextForYaml(text) {
        if (!text || typeof text !== 'string') return text;

        // Check if text contains any icon escape sequences
        const hasEscapes = /\\U[0-9A-Fa-f]{8}|\\u[0-9A-Fa-f]{4}/.test(text);
        if (!hasEscapes) return text;

        let result = text;

        // Convert 8-digit \U to 4-digit \u WHERE POSSIBLE (BMP codepoints only)
        result = result.replace(/\\U([0-9A-Fa-f]{8})/g, (match, hex) => {
            const codePoint = parseInt(hex, 16);
            if (codePoint <= 0xFFFF) {
                // Fits in 4-digit \u format
                return '\\u' + codePoint.toString(16).toUpperCase().padStart(4, '0');
            }
            // Codepoint > U+FFFF: keep 8-digit format for ESPHome
            return '\\U' + hex.toUpperCase();
        });

        // Mark with sentinel so postProcessYaml wraps in double quotes
        return ICON_SENTINEL + result;
    }

    /**
     * Format a style value for YAML output.
     */
    function formatStyleValue(prop, val) {
        // Color values: convert #RRGGBB to integer for ESPHome
        // ESPHome expects bare hex integers: bg_color: 0xFFAA44 (not quoted)
        // We store as integer so js-yaml outputs it as a number, then
        // postProcessYaml isn't needed for colors since js-yaml outputs
        // numbers without quotes. We'll handle the 0x prefix in post-processing.
        if (prop.includes('color') && typeof val === 'string' && val.startsWith('#')) {
            // Return as string "0xRRGGBB" — postProcessYaml will unquote it
            return '0x' + val.slice(1).toUpperCase();
        }
        // Opacity values: format as percentage for ESPHome
        if (prop === 'opa' || prop.endsWith('_opa')) {
            return formatOpacityValue(val);
        }
        return val;
    }

    /**
     * Format opacity value for ESPHome YAML.
     * ESPHome expects percentage strings ("100%", "50%") or named constants (TRANSP, COVER).
     * The UI accepts 0-100 (percentage), 0%-100%, or TRANSP/COVER.
     * Plain numbers are treated as percentages (not 0-255 LVGL internal values).
     */
    function formatOpacityValue(val) {
        if (val === null || val === undefined || val === '') return val;
        const strVal = String(val).trim();
        // Named constants pass through as-is
        if (strVal.toUpperCase() === 'TRANSP' || strVal.toUpperCase() === 'COVER') {
            return strVal.toUpperCase();
        }
        // Already a percentage string — pass through
        if (strVal.endsWith('%')) {
            return strVal;
        }
        // Numeric value: treat as percentage (0-100 range)
        const num = parseFloat(strVal);
        if (!isNaN(num)) {
            // Clamp to 0-100 range
            const clamped = Math.max(0, Math.min(100, Math.round(num)));
            return clamped + '%';
        }
        return val;
    }

    // ---- YAML Parsing ----

    /**
     * Parse ESPHome LVGL YAML into designer state.
     */
    function parseYAML(yamlStr) {
        const doc = yamlLoad(yamlStr);
        if (!doc) throw new Error('Empty YAML document');

        const result = {
            pages: [],
        };

        // Parse font declarations
        if (doc.font && typeof FontManager !== 'undefined') {
            FontManager.fromYAML(doc.font);
        }

        // Handle different YAML structures
        let lvglConfig = doc;
        if (doc.lvgl) lvglConfig = doc.lvgl;

        if (lvglConfig.pages) {
            for (const pageYaml of lvglConfig.pages) {
                const page = {
                    id: pageYaml.id || 'page_' + (result.pages.length + 1),
                    name: pageYaml.id || 'Page ' + (result.pages.length + 1),
                    widgets: [],
                };

                if (pageYaml.widgets) {
                    for (const widgetYaml of pageYaml.widgets) {
                        const widget = parseWidgetYAML(widgetYaml);
                        if (widget) page.widgets.push(widget);
                    }
                }

                result.pages.push(page);
            }
        }

        // If no pages found, try parsing as flat widget list
        if (result.pages.length === 0) {
            const page = { id: 'main_page', name: 'Main', widgets: [] };
            if (lvglConfig.widgets) {
                for (const widgetYaml of lvglConfig.widgets) {
                    const widget = parseWidgetYAML(widgetYaml);
                    if (widget) page.widgets.push(widget);
                }
            }
            result.pages.push(page);
        }

        return result;
    }

    /**
     * Parse a single widget from YAML format.
     */
    function parseWidgetYAML(widgetYaml) {
        const type = Object.keys(widgetYaml)[0];
        const props = widgetYaml[type];

        if (!type || !props) return null;

        const def = LVGLWidgets.getWidgetDef(type);
        if (!def) {
            console.warn(`Unknown widget type: ${type}`);
            return null;
        }

        const widget = {
            id: props.id || type + '_' + Math.floor(Math.random() * 1000),
            type,
            x: props.x || 0,
            y: props.y || 0,
            width: props.width || def.defaultSize.width,
            height: props.height || def.defaultSize.height,
            properties: {},
            styles: {},
            children: [],
        };

        // Parse widget-specific properties
        for (const [key, propDef] of Object.entries(def.properties)) {
            if (propDef.childLabel) continue;
            if (propDef.yamlMap && props[propDef.yamlMap] !== undefined) {
                const val = props[propDef.yamlMap];
                widget.properties[key] = propDef.yamlInvert ? !val : val;
            } else if (props[key] !== undefined) {
                widget.properties[key] = props[key];
            } else if (propDef.default !== null && propDef.default !== undefined) {
                widget.properties[key] = propDef.default;
            }
        }

        // Parse styles for each part
        // ESPHome format: main part styles are directly on the widget,
        // other parts (indicator, knob, etc.) are nested keys.
        const knownWidgetKeys = new Set([
            'id', 'x', 'y', 'width', 'height', 'align', 'widgets',
            'layout', 'flex_flow', 'flex_align_main', 'flex_align_cross', 'flex_align_track',
            ...Object.keys(def.properties),
            ...Object.keys(LVGLWidgets.EVENTS || {}),
        ]);
        // Also exclude non-main part names from main style detection
        const partNames = new Set(def.parts || ['main']);

        const lvglStates = new Set(['pressed', 'focused', 'disabled', 'checked', 'default']);

        for (const part of (def.parts || ['main'])) {
            widget.styles[part] = {};
            if (part === 'main') {
                // Main part styles come directly from widget root properties
                // (any key that's a known style prop and not a widget/event/part key)
                for (const [prop, val] of Object.entries(props)) {
                    if (knownWidgetKeys.has(prop)) continue;
                    if (partNames.has(prop) && typeof val === 'object') continue;
                    // Check if this is a state key (pressed:, checked:, etc.) at widget root → main part state
                    if (lvglStates.has(prop) && typeof val === 'object') {
                        if (!widget.styles.main._states) widget.styles.main._states = {};
                        widget.styles.main._states[prop] = {};
                        for (const [sp, sv] of Object.entries(val)) {
                            widget.styles.main._states[prop][sp] = parseStyleValue(sp, sv);
                        }
                        continue;
                    }
                    if (LVGLWidgets.STYLE_PROPS && LVGLWidgets.STYLE_PROPS[prop]) {
                        widget.styles.main[prop] = parseStyleValue(prop, val);
                    }
                }
                // Also support legacy 'main:' key for backward compatibility
                if (props.main && typeof props.main === 'object') {
                    for (const [prop, val] of Object.entries(props.main)) {
                        widget.styles.main[prop] = parseStyleValue(prop, val);
                    }
                }
            } else if (props[part] && typeof props[part] === 'object') {
                for (const [prop, val] of Object.entries(props[part])) {
                    // Check if this is a state key inside a sub-part
                    if (lvglStates.has(prop) && typeof val === 'object') {
                        if (!widget.styles[part]._states) widget.styles[part]._states = {};
                        widget.styles[part]._states[prop] = {};
                        for (const [sp, sv] of Object.entries(val)) {
                            widget.styles[part]._states[prop][sp] = parseStyleValue(sp, sv);
                        }
                        continue;
                    }
                    widget.styles[part][prop] = parseStyleValue(prop, val);
                }
            }
        }

        // Parse events/actions
        widget.events = {};
        const eventNames = Object.keys(LVGLWidgets.EVENTS);
        for (const eventName of eventNames) {
            if (props[eventName]) {
                const rawActions = Array.isArray(props[eventName]) ? props[eventName] : [props[eventName]];
                widget.events[eventName] = rawActions.map(a => parseActionYAML(a)).filter(Boolean);
            }
        }

        // Parse children
        if (props.widgets && Array.isArray(props.widgets)) {
            for (const childYaml of props.widgets) {
                const child = parseWidgetYAML(childYaml);
                if (child) widget.children.push(child);
            }
        }

        return widget;
    }

    /**
     * Parse a single action from YAML format.
     */
    function parseActionYAML(actionYaml) {
        if (!actionYaml || typeof actionYaml !== 'object') return null;

        // Handle lambda shorthand
        if (actionYaml.lambda !== undefined) {
            let code = actionYaml.lambda;
            // Strip lambda sentinel if present from parsing
            if (typeof code === 'string' && code.startsWith(LAMBDA_SENTINEL)) {
                code = code.slice(LAMBDA_SENTINEL.length);
            }
            return { type: 'lambda', fields: { code } };
        }

        const type = Object.keys(actionYaml)[0];
        const fields = actionYaml[type] || {};

        const result = { type, fields: {} };
        for (const [key, val] of Object.entries(fields)) {
            if (key === 'data' && typeof val === 'object') {
                // Convert data object back to YAML string for the editor field
                // Preserve lambda sentinels as !lambda tags in the string
                const dataLines = [];
                for (const [dk, dv] of Object.entries(val)) {
                    if (typeof dv === 'string' && dv.startsWith(LAMBDA_SENTINEL)) {
                        dataLines.push(`${dk}: !lambda "${dv.slice(LAMBDA_SENTINEL.length)}"`);
                    } else {
                        dataLines.push(`${dk}: ${dv}`);
                    }
                }
                result.fields[key] = dataLines.join('\n');
            } else if (typeof val === 'string' && val.startsWith(LAMBDA_SENTINEL)) {
                // Preserve lambda sentinel display for the user
                result.fields[key] = '!lambda "' + val.slice(LAMBDA_SENTINEL.length) + '"';
            } else {
                result.fields[key] = val;
            }
        }
        return result;
    }

    /**
     * Parse a style value from YAML format.
     */
    function parseStyleValue(prop, val) {
        // Convert 0xRRGGBB to #RRGGBB
        if (prop.includes('color') && typeof val === 'string' && val.match(/^0x[0-9A-Fa-f]{6}$/)) {
            return '#' + val.slice(2).toLowerCase();
        }
        // Handle numeric 0xRRGGBB (if js-yaml parsed it as a number)
        if (prop.includes('color') && typeof val === 'number') {
            return '#' + val.toString(16).padStart(6, '0');
        }
        return val;
    }

    // ---- Validation ----

    function validate(yamlStr) {
        const results = [];

        let doc;
        try {
            doc = yamlLoad(yamlStr);
        } catch (e) {
            results.push({
                type: 'error',
                message: `YAML Syntax Error: ${e.message}`,
                line: e.mark ? e.mark.line + 1 : null,
            });
            return results;
        }

        if (!doc) {
            results.push({ type: 'error', message: 'Empty YAML document' });
            return results;
        }

        let lvglConfig = doc;
        if (doc.lvgl) {
            lvglConfig = doc.lvgl;
        } else {
            results.push({ type: 'warning', message: 'Missing top-level "lvgl:" key. ESPHome expects this.' });
        }

        // Track all IDs globally — ESPHome requires unique IDs across all pages
        const globalIds = new Set();

        if (lvglConfig.pages) {
            if (!Array.isArray(lvglConfig.pages)) {
                results.push({ type: 'error', message: '"pages" must be a list' });
            } else {
                const pageIds = new Set();
                for (let i = 0; i < lvglConfig.pages.length; i++) {
                    const page = lvglConfig.pages[i];
                    if (page.id) {
                        if (pageIds.has(page.id)) {
                            results.push({ type: 'error', message: `Duplicate page ID: "${page.id}"` });
                        }
                        pageIds.add(page.id);
                        if (globalIds.has(page.id)) {
                            results.push({ type: 'error', message: `Page ID "${page.id}" conflicts with a widget ID` });
                        }
                        globalIds.add(page.id);

                        if (!isValidId(page.id)) {
                            results.push({ type: 'error', message: `Invalid page ID "${page.id}": must be a valid C identifier` });
                        }
                    }

                    if (page.widgets) {
                        validateWidgets(page.widgets, results, `pages[${i}]`, globalIds);
                    }
                }
            }
        }

        if (lvglConfig.widgets) {
            validateWidgets(lvglConfig.widgets, results, 'root', globalIds);
        }

        if (results.length === 0) {
            results.push({ type: 'success', message: 'YAML is valid ESPHome LVGL configuration.' });
        }

        return results;
    }

    function validateWidgets(widgets, results, path, globalIds) {
        if (!Array.isArray(widgets)) {
            results.push({ type: 'error', message: `${path}.widgets must be a list` });
            return;
        }

        // Use global ID set if provided, otherwise create local one
        const widgetIds = globalIds || new Set();
        for (let i = 0; i < widgets.length; i++) {
            const widgetYaml = widgets[i];
            const type = Object.keys(widgetYaml)[0];
            const props = widgetYaml[type];
            const wPath = `${path}.widgets[${i}]`;

            const def = LVGLWidgets.getWidgetDef(type);
            if (!def) {
                results.push({ type: 'warning', message: `${wPath}: Unknown widget type "${type}"` });
                continue;
            }

            if (!props || typeof props !== 'object') {
                results.push({ type: 'error', message: `${wPath}: Widget "${type}" must have properties object` });
                continue;
            }

            if (props.id) {
                if (widgetIds.has(props.id)) {
                    results.push({ type: 'error', message: `${wPath}: Duplicate ID "${props.id}" (IDs must be globally unique across all pages)` });
                }
                widgetIds.add(props.id);
                if (!isValidId(props.id)) {
                    results.push({ type: 'error', message: `${wPath}: Invalid ID "${props.id}": must be a valid C identifier` });
                }
            }

            if (props.width !== undefined && typeof props.width === 'number' && props.width <= 0) {
                results.push({ type: 'warning', message: `${wPath}: Width should be positive` });
            }
            if (props.height !== undefined && typeof props.height === 'number' && props.height <= 0) {
                results.push({ type: 'warning', message: `${wPath}: Height should be positive` });
            }

            if (type === 'slider') {
                const min = props.min_value ?? 0;
                const max = props.max_value ?? 100;
                const val = props.value;
                if (min >= max) {
                    results.push({ type: 'error', message: `${wPath}: Slider min_value (${min}) must be less than max_value (${max})` });
                }
                if (val !== undefined && (val < min || val > max)) {
                    results.push({ type: 'warning', message: `${wPath}: Slider value (${val}) is outside range [${min}, ${max}]` });
                }
            }

            if (type === 'arc') {
                if (props.arc_width !== undefined && props.arc_width <= 0) {
                    results.push({ type: 'warning', message: `${wPath}: Arc width should be positive` });
                }
            }

            for (const [key, propDef] of Object.entries(def.properties)) {
                if (props[key] !== undefined) {
                    const val = props[key];
                    if (propDef.type === 'number' && typeof val !== 'number') {
                        results.push({ type: 'warning', message: `${wPath}: "${key}" should be a number, got ${typeof val}` });
                    }
                    if (propDef.type === 'boolean' && typeof val !== 'boolean') {
                        results.push({ type: 'warning', message: `${wPath}: "${key}" should be boolean, got ${typeof val}` });
                    }
                    if (propDef.type === 'enum' && propDef.options && !propDef.options.includes(val)) {
                        results.push({ type: 'warning', message: `${wPath}: "${key}" value "${val}" is not a valid option` });
                    }
                }
            }

            // Validate style properties on non-main parts (indicator, knob, etc.)
            const validStates = new Set(['pressed', 'focused', 'disabled', 'checked', 'default']);
            for (const part of (def.parts || [])) {
                if (part === 'main') continue; // main styles are on the widget root
                if (props[part] && typeof props[part] === 'object') {
                    for (const [styleProp] of Object.entries(props[part])) {
                        if (validStates.has(styleProp)) continue; // state keys are valid
                        if (!LVGLWidgets.STYLE_PROPS[styleProp]) {
                            results.push({ type: 'info', message: `${wPath}.${part}: Unknown style property "${styleProp}"` });
                        }
                    }
                }
            }

            // Warn about canvas widgets without draw actions
            if (type === 'canvas') {
                results.push({
                    type: 'warning',
                    message: `${wPath}: Canvas widget requires explicit draw actions (lvgl.canvas.fill, etc.). ` +
                        `For a simple colored panel, use "obj" instead. The designer will auto-convert canvas to obj in output.`
                });
            }

            if (props.widgets && !def.canContain) {
                results.push({ type: 'warning', message: `${wPath}: Widget type "${type}" does not support child widgets` });
            }

            if (props.widgets) {
                validateWidgets(props.widgets, results, wPath, widgetIds);
            }
        }
    }

    function isValidId(id) {
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id);
    }

    // ---- Editor Integration ----

    function updateEditorFromState(designerState) {
        if (!codeMirrorEditor || isUpdatingFromEditor) return;
        isUpdatingFromDesigner = true;
        const yaml = generateYAML(designerState);
        codeMirrorEditor.setValue(yaml);
        isUpdatingFromDesigner = false;
        updateValidationStatus(validate(yaml));
    }

    function getEditorContent() {
        return codeMirrorEditor ? codeMirrorEditor.getValue() : '';
    }

    function applyEditorToDesigner() {
        const yaml = getEditorContent();
        const validationResults = validate(yaml);
        const hasErrors = validationResults.some(r => r.type === 'error');

        if (hasErrors) {
            updateValidationStatus(validationResults);
            return { success: false, results: validationResults };
        }

        try {
            isUpdatingFromEditor = true;
            const newState = parseYAML(yaml);
            if (onApply) {
                onApply(newState);
            }
            isUpdatingFromEditor = false;
            updateValidationStatus(validationResults);
            return { success: true, results: validationResults };
        } catch (e) {
            isUpdatingFromEditor = false;
            return {
                success: false,
                results: [{ type: 'error', message: `Parse error: ${e.message}` }],
            };
        }
    }

    function validateEditorContent() {
        const yaml = getEditorContent();
        const results = validate(yaml);
        updateValidationStatus(results);
        return results;
    }

    function updateValidationStatus(results) {
        const iconEl = document.getElementById('yaml-status-icon');
        const textEl = document.getElementById('yaml-status-text');
        if (!iconEl || !textEl) return;

        const errors = results.filter(r => r.type === 'error');
        const warnings = results.filter(r => r.type === 'warning');

        if (errors.length > 0) {
            iconEl.textContent = '\u2717';
            iconEl.className = 'status-error';
            textEl.textContent = `${errors.length} error(s)`;
        } else if (warnings.length > 0) {
            iconEl.textContent = '!';
            iconEl.className = 'status-warn';
            textEl.textContent = `${warnings.length} warning(s)`;
        } else {
            iconEl.textContent = '\u2713';
            iconEl.className = 'status-ok';
            textEl.textContent = 'Valid';
        }
    }

    function formatEditor() {
        if (!codeMirrorEditor) return;
        try {
            const yaml = codeMirrorEditor.getValue();
            const doc = yamlLoad(yaml);
            const formatted = yamlDump(doc, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
                sortKeys: false,
            });
            isUpdatingFromDesigner = true;
            codeMirrorEditor.setValue(postProcessYaml(formatted));
            isUpdatingFromDesigner = false;
        } catch (e) {
            // If YAML is invalid, don't format
        }
    }

    function exportYAML(designerState) {
        const yaml = generateYAML(designerState);
        const blob = new Blob([yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lvgl_ui.yaml';
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Export full device YAML (LVGL + sensors + bindings) as downloadable file.
     */
    function exportFullYAML(designerState) {
        const yaml = generateFullYAML(designerState);
        const blob = new Blob([yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lvgl_device.yaml';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ---- Public API ----
    return {
        init,
        generateYAML,
        generateFullYAML,
        parseYAML,
        validate,
        updateEditorFromState,
        getEditorContent,
        applyEditorToDesigner,
        validateEditorContent,
        formatEditor,
        exportYAML,
        exportFullYAML,
        LAMBDA_SENTINEL,
    };
})();
